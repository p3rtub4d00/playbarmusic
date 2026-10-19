import express from "express";
import http from "http";
import { Server } from "socket.io";
import dotenv from "dotenv";
import youtubeSearchApi from "youtube-search-api";
import mongoose from "mongoose";
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import {
  buildMercadoPagoAuthorizationUrl,
  decryptSecret,
  encryptSecret,
  randomIdempotencyKey,
  sha256Base64Url,
  validateMercadoPagoWebhookSignature,
} from "./lib/mercadopago-utils.js";

dotenv.config();
const scrypt = promisify(scryptCallback);

// --- Configuração das Variáveis do QG Mestre ---
const RAW_MASTER_URL = process.env.MASTER_URL || '';
const MASTER_URL = RAW_MASTER_URL.replace(/\/+$/, ''); // Remove barra dupla do final se houver
const CLIENT_ID = process.env.CLIENT_ID || '';
const QG_COMMISSION_PERCENT = Number(process.env.QG_COMMISSION_PERCENT);

// --- Mercado Pago OAuth (conta do estabelecimento) ---
const MP_CLIENT_ID = String(process.env.MERCADOPAGO_CLIENT_ID || process.env.MP_CLIENT_ID || '').trim();
const MP_CLIENT_SECRET = String(process.env.MERCADOPAGO_CLIENT_SECRET || process.env.MP_CLIENT_SECRET || '').trim();
const MP_REDIRECT_URI = String(process.env.MERCADOPAGO_REDIRECT_URI || process.env.MP_REDIRECT_URI || '').trim();
const MP_TOKEN_SECRET = String(
  process.env.MERCADOPAGO_TOKEN_ENCRYPTION_KEY ||
  process.env.MP_TOKEN_SECRET ||
  MP_CLIENT_SECRET ||
  ''
).trim();
const MP_WEBHOOK_SECRET = String(process.env.MERCADOPAGO_WEBHOOK_SECRET || '').trim();
const MP_TOKEN_URL = 'https://api.mercadopago.com/oauth/token';
const MP_API_BASE_URL = 'https://api.mercadopago.com';

if (!MASTER_URL || !CLIENT_ID) {
  console.warn("⚠️ ATENÇÃO: MASTER_URL ou CLIENT_ID não configurados nas variáveis de ambiente!");
} else {
  console.log(`🔗 Sincronizado com o QG Mestre: ${MASTER_URL} [Client ID: ${CLIENT_ID}]`);
}

// --- Conexão MongoDB ---
console.log('[System] Iniciando conexão com MongoDB...');
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Conectado ao MongoDB com sucesso!'))
  .catch((err) => console.error('❌ Erro CRÍTICO ao conectar ao MongoDB:', err));

// --- Schemas ---
const ConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'main_config', unique: true },
  dailyRevenue: { type: Number, default: 0.0 },
  totalSales: { type: Number, default: 0.0 }, // NOVO: Faturamento acumulado
  currentPromoText: { type: String, default: "Bem-vindo ao PlayBar!" },
  currentVolume: { type: Number, default: 50 },
  isMuted: { type: Boolean, default: true },
  adminPasswordHash: String,
  adminPasswordChangedAt: Date,
  maxPlaybackMinutes: { type: Number, default: 5 },
  autoplayMode: { type: String, default: 'manual' },
  playlistLink: { type: String, default: '' },
  blockedKeywords: { type: [String], default: [] },
  mpAccessTokenEnc: { type: String, default: null },
  mpRefreshTokenEnc: { type: String, default: null },
  mpTokenExpiresAt: { type: Date, default: null },
  mpUserId: { type: String, default: null },
  mpPublicKey: { type: String, default: null },
  mpScope: { type: String, default: null },
  mpLiveMode: { type: Boolean, default: null },
  mpConnectedAt: { type: Date, default: null },
  mpUpdatedAt: { type: Date, default: null }
});
const ConfigModel = mongoose.model('Config', ConfigSchema);

const MpOAuthStateSchema = new mongoose.Schema({
  stateHash: { type: String, required: true, unique: true, index: true },
  verifierEncrypted: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 }
}, { timestamps: true });
const MpOAuthStateModel = mongoose.model('MpOAuthState', MpOAuthStateSchema);

const InactivitySongSchema = new mongoose.Schema({
  title: String,
  videoId: String,
  channel: String
});
const InactivityModel = mongoose.model('InactivitySong', InactivitySongSchema);

const PaymentSchema = new mongoose.Schema({
  mpPaymentId: { type: String, unique: true },
  socketId: String,
  userPhone: String,
  amount: Number,
  description: String,
  message: String,
  status: { type: String, default: 'pending' },
  videos: [{
      id: String,
      title: String,
      channel: String,
      thumbnail: String
  }],
  createdAt: { type: Date, default: Date.now }
});
const PaymentModel = mongoose.model('Payment', PaymentSchema);

const SearchCacheSchema = new mongoose.Schema({
  term: { type: String, unique: true },
  results: Array, 
  createdAt: { type: Date, default: Date.now, expires: 86400 }
});
const SearchCacheModel = mongoose.model('SearchCache', SearchCacheSchema);

const QueueSchema = new mongoose.Schema({
  videoId: String,
  title: String,
  isCustomer: { type: Boolean, default: false },
  message: String,
  userPhone: String,
  mpPaymentId: String,
  priority: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now }
});
const QueueModel = mongoose.model('Queue', QueueSchema);

const PlayHistorySchema = new mongoose.Schema({
  videoId: String,
  title: String,
  message: String,
  source: { type: String, enum: ['customer', 'admin', 'inactivity'], default: 'customer' },
  userPhone: String,
  mpPaymentId: String,
  playedAt: { type: Date, default: Date.now }
});
const PlayHistoryModel = mongoose.model('PlayHistory', PlayHistorySchema);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());

function safeTextEquals(value, expected) {
  const valueBuffer = Buffer.from(String(value));
  const expectedBuffer = Buffer.from(String(expected));
  return valueBuffer.length === expectedBuffer.length && timingSafeEqual(valueBuffer, expectedBuffer);
}

function mpOAuthConfigured() {
  return Boolean(MP_CLIENT_ID && MP_CLIENT_SECRET && MP_REDIRECT_URI && MP_TOKEN_SECRET);
}

async function exchangeMercadoPagoToken(body) {
  const response = await fetch(MP_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    const detail = data.message || data.error_description || data.error || 'Falha ao obter credenciais do Mercado Pago.';
    throw new Error(detail);
  }
  return data;
}

async function saveMercadoPagoCredential(config, credential, { preserveConnectedAt = true } = {}) {
  const now = new Date();
  config.mpAccessTokenEnc = encryptSecret(credential.access_token, MP_TOKEN_SECRET);
  if (credential.refresh_token) {
    config.mpRefreshTokenEnc = encryptSecret(credential.refresh_token, MP_TOKEN_SECRET);
  }
  config.mpTokenExpiresAt = credential.expires_in
    ? new Date(now.getTime() + Number(credential.expires_in) * 1000)
    : config.mpTokenExpiresAt || null;
  config.mpUserId = credential.user_id != null ? String(credential.user_id) : config.mpUserId;
  config.mpPublicKey = credential.public_key || config.mpPublicKey;
  config.mpScope = credential.scope || config.mpScope;
  if (credential.live_mode !== undefined) config.mpLiveMode = Boolean(credential.live_mode);
  config.mpConnectedAt = preserveConnectedAt && config.mpConnectedAt ? config.mpConnectedAt : now;
  config.mpUpdatedAt = now;
  await config.save();
}

async function refreshMercadoPagoCredential(config) {
  if (!mpOAuthConfigured() || !config?.mpRefreshTokenEnc) {
    throw new Error('A autorização do Mercado Pago expirou. Reconecte a conta no painel administrativo.');
  }

  const refreshToken = decryptSecret(config.mpRefreshTokenEnc, MP_TOKEN_SECRET);
  const credential = await exchangeMercadoPagoToken({
    client_id: MP_CLIENT_ID,
    client_secret: MP_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  });

  await saveMercadoPagoCredential(config, credential, { preserveConnectedAt: true });
  return credential.access_token;
}

async function getMercadoPagoAccessToken() {
  const config = await getConfig();

  if (config?.mpAccessTokenEnc) {
    const expiresAt = config.mpTokenExpiresAt ? new Date(config.mpTokenExpiresAt).getTime() : null;
    const shouldRefresh = Boolean(
      expiresAt &&
      Number.isFinite(expiresAt) &&
      expiresAt - Date.now() < 10 * 60 * 1000
    );

    if (!shouldRefresh) {
      return decryptSecret(config.mpAccessTokenEnc, MP_TOKEN_SECRET);
    }

    return refreshMercadoPagoCredential(config);
  }

  const legacyToken = String(
    process.env.MERCADOPAGO_ACCESS_TOKEN ||
    process.env.MP_ACCESS_TOKEN ||
    ''
  ).trim();

  if (legacyToken) return legacyToken;

  throw new Error('Mercado Pago não conectado. Abra o painel administrativo e conecte a conta do estabelecimento.');
}

async function mercadoPagoApiRequest(pathname, options = {}) {
  const accessToken = await getMercadoPagoAccessToken();
  const response = await fetch(MP_API_BASE_URL + pathname, {
    method: options.method || 'GET',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: 'Bearer ' + accessToken,
      ...(options.idempotencyKey ? { 'x-idempotency-key': options.idempotencyKey } : {})
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {})
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail =
      data?.message ||
      data?.error_description ||
      data?.error ||
      data?.cause?.[0]?.description ||
      data?.cause?.[0]?.code ||
      'Erro na API do Mercado Pago.';
    const error = new Error(String(detail));
    error.statusCode = response.status >= 500 ? 502 : response.status;
    error.mercadoPagoResponse = data;
    throw error;
  }

  return data;
}


async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scrypt(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

async function verifyPassword(password, storedHash) {
  if (!storedHash) return safeTextEquals(password, process.env.ADMIN_PASS || 'admin');
  const [salt, savedKey] = storedHash.split(':');
  if (!salt || !savedKey) return false;
  const derivedKey = await scrypt(password, salt, 64);
  const savedKeyBuffer = Buffer.from(savedKey, 'hex');
  return savedKeyBuffer.length === derivedKey.length && timingSafeEqual(savedKeyBuffer, derivedKey);
}

async function requireAdminAuth(req, res, next) {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="Painel Admin"');
    return res.status(401).send('Acesso negado: senha necessária.');
  }

  const credentials = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  const separator = credentials.indexOf(':');
  const username = separator >= 0 ? credentials.slice(0, separator) : '';
  const password = separator >= 0 ? credentials.slice(separator + 1) : '';

  try {
    const config = await getConfig();
    const validUser = safeTextEquals(username, process.env.ADMIN_USER || 'admin');
    const validPassword = await verifyPassword(password, config.adminPasswordHash);
    if (validUser && validPassword) return next();
  } catch (error) {
    console.error('[Admin] Erro ao validar credenciais:', error);
  }

  res.set('WWW-Authenticate', 'Basic realm="Painel Admin"');
  return res.status(401).send('Credenciais rejeitadas.');
}

app.use('/admin.html', requireAdminAuth);

app.post('/admin/change-password', requireAdminAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      return res.status(400).json({ ok: false, error: 'Dados inválidos.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ ok: false, error: 'A nova senha deve ter pelo menos 8 caracteres.' });
    }

    const config = await getConfig();
    if (!await verifyPassword(currentPassword, config.adminPasswordHash)) {
      return res.status(403).json({ ok: false, error: 'Senha atual incorreta.' });
    }

    config.adminPasswordHash = await hashPassword(newPassword);
    config.adminPasswordChangedAt = new Date();
    await config.save();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Não foi possível alterar a senha.' });
  }
});


app.get('/api/admin/mercadopago/status', requireAdminAuth, async (req, res) => {
  try {
    const config = await getConfig();
    const connected = Boolean(config?.mpAccessTokenEnc);
    const legacy = !connected && Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN || process.env.MP_ACCESS_TOKEN);
    return res.json({
      ok: true,
      configured: mpOAuthConfigured(),
      webhookConfigured: Boolean(MP_WEBHOOK_SECRET),
      connected,
      source: connected ? 'oauth' : (legacy ? 'legacy' : 'none'),
      userId: connected ? config.mpUserId : null,
      expiresAt: connected ? config.mpTokenExpiresAt : null,
      connectedAt: connected ? config.mpConnectedAt : null,
      updatedAt: connected ? config.mpUpdatedAt : null,
      liveMode: connected ? config.mpLiveMode : null,
      redirectUri: MP_REDIRECT_URI || null
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Não foi possível consultar a conexão com o Mercado Pago.' });
  }
});

app.post('/api/admin/mercadopago/connect', requireAdminAuth, async (req, res) => {
  try {
    if (!mpOAuthConfigured()) {
      return res.status(503).json({ ok: false, error: 'OAuth do Mercado Pago ainda não foi configurado no servidor.' });
    }

    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(48).toString('base64url');
    const codeChallenge = sha256Base64Url(codeVerifier);

    await MpOAuthStateModel.deleteMany({});
    await MpOAuthStateModel.create({
      stateHash: sha256Base64Url(state),
      verifierEncrypted: encryptSecret(codeVerifier, MP_TOKEN_SECRET),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000)
    });

    const authorizationUrl = buildMercadoPagoAuthorizationUrl({
      clientId: MP_CLIENT_ID,
      redirectUri: MP_REDIRECT_URI,
      state,
      codeChallenge
    });

    return res.json({ ok: true, url: authorizationUrl });
  } catch (error) {
    console.error('[Mercado Pago OAuth] Erro ao iniciar conexão:', error);
    return res.status(500).json({ ok: false, error: 'Não foi possível iniciar a conexão com o Mercado Pago.' });
  }
});

app.post('/api/admin/mercadopago/disconnect', requireAdminAuth, async (req, res) => {
  try {
    const config = await getConfig();
    config.mpAccessTokenEnc = null;
    config.mpRefreshTokenEnc = null;
    config.mpTokenExpiresAt = null;
    config.mpUserId = null;
    config.mpPublicKey = null;
    config.mpScope = null;
    config.mpLiveMode = null;
    config.mpConnectedAt = null;
    config.mpUpdatedAt = new Date();
    await config.save();
    return res.json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: 'Não foi possível desconectar a conta do Mercado Pago.' });
  }
});

app.get('/api/mercadopago/oauth/callback', async (req, res) => {
  const redirectAdmin = (status) => res.redirect(`/admin.html?mp=${encodeURIComponent(status)}`);

  try {
    const { code, state, error } = req.query || {};
    if (error) return redirectAdmin('cancelled');
    if (typeof code !== 'string' || typeof state !== 'string') return redirectAdmin('error');
    if (!mpOAuthConfigured()) return redirectAdmin('config');

    const stateHash = sha256Base64Url(state);
    const oauthState = await MpOAuthStateModel.findOne({ stateHash });
    if (!oauthState || new Date(oauthState.expiresAt) <= new Date()) {
      if (oauthState) await MpOAuthStateModel.deleteOne({ _id: oauthState._id });
      return redirectAdmin('state');
    }

    const credential = await exchangeMercadoPagoToken({
      client_id: MP_CLIENT_ID,
      client_secret: MP_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: MP_REDIRECT_URI,
      code_verifier: decryptSecret(oauthState.verifierEncrypted, MP_TOKEN_SECRET)
    });

    if (!credential?.access_token || !credential?.user_id) {
      throw new Error('Mercado Pago não retornou as credenciais esperadas.');
    }

    const config = await getConfig();
    await saveMercadoPagoCredential(config, credential, { preserveConnectedAt: false });
    await MpOAuthStateModel.deleteOne({ _id: oauthState._id });

    console.log(`[Mercado Pago OAuth] Conta conectada. User ID: ${credential.user_id}`);
    return redirectAdmin('connected');
  } catch (error) {
    console.error('[Mercado Pago OAuth] Falha no callback:', error.message);
    return redirectAdmin('error');
  }
});

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true, ts: new Date().toISOString() });
});

// --- Rota interna para o Frontend verificar licença direto no QG Mestre ---
app.get('/api/status', async (req, res) => {
    try {
        if (!MASTER_URL || !CLIENT_ID) {
            return res.json({ ok: true, active: true });
        }
        const response = await fetch(`${MASTER_URL}/api/check-license?client_id=${CLIENT_ID}`);
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error("Erro ao conectar com o QG Mestre:", error);
        res.json({ ok: true, active: true });
    }
});

function getCommissionPercent(masterData) {
  if (masterData?.demo === true || masterData?.client?.demoMode === true) return null;

  const percent = Number(masterData?.client?.value);
  const isPercentage = masterData?.client?.model?.includes('%') || masterData?.client?.model?.toLowerCase().includes('porcentagem');

  if (isPercentage && Number.isFinite(percent)) return percent;

  return Number.isFinite(QG_COMMISSION_PERCENT) && QG_COMMISSION_PERCENT >= 0 && QG_COMMISSION_PERCENT <= 100
    ? QG_COMMISSION_PERCENT
    : null;
}

app.get('/api/admin/commission', requireAdminAuth, async (req, res) => {
  try {
    const config = await getConfig();
    let masterData = null;
    if (MASTER_URL && CLIENT_ID) {
      const response = await fetch(`${MASTER_URL}/api/check-license?client_id=${CLIENT_ID}`);
      if (response.ok) masterData = await response.json();
    }
    const percent = getCommissionPercent(masterData);
    const totalSales = Number(config.totalSales) || 0; 

    return res.json({
      ok: true,
      percent,
      dailyRevenue: Number(config.dailyRevenue) || 0, 
      totalSales, 
      amountDue: percent === null ? null : totalSales * (percent / 100)
    });
  } catch (error) {
    return res.status(502).json({ ok: false, error: 'Nao foi possivel consultar a comissao no QG.' });
  }
});

// --- ROTINA AUTOMÁTICA DE HEARTBEAT (Mantém o servidor Online no QG) ---
async function sendHeartbeat() {
  if (!MASTER_URL || !CLIENT_ID) return;
  try {
    const config = await getConfig();
    
    // 1. O cliente pergunta ao QG Mestre como está a situação dele
    const response = await fetch(`${MASTER_URL}/api/check-license?client_id=${CLIENT_ID}`);
    const data = await response.json();

    // 2. SE O QG ZEROU AS VENDAS (Significa que o PIX da comissão foi pago!)
    if (data && data.client && data.client.totalSales === 0 && config.totalSales > 0) {
        console.log('[Sincronização] Comissão paga no QG. Zerando acumulado local...');
        config.totalSales = 0;
        await config.save();
    } 
    // 3. Caso contrário, o cliente continua informando as novas vendas ao QG
    else {
        await fetch(`${MASTER_URL}/api/report-revenue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                client_id: CLIENT_ID, 
                dailyRevenue: config.dailyRevenue,
                totalSales: config.totalSales 
            })
        });
    }
  } catch (err) {
    // Silencia erros de rede temporários para não poluir o console
  }
}
// Envia o sinal a cada 15 segundos
setInterval(sendHeartbeat, 15000);

const INACTIVITY_TIMEOUT = 5000;
let inactivityTimer = null;
let customerPlaybackTimer = null; 
let nowPlayingInfo = null;
let isCustomerPlaying = false;
let isAdvancingQueue = false;

async function getConfig() {
  try {
    let config = await ConfigModel.findOne({ key: 'main_config' });
    if (!config) {
      config = await ConfigModel.create({ key: 'main_config' });
    }
    return config;
  } catch (error) {
    return {
      dailyRevenue: 0.0,
      totalSales: 0.0,
      currentPromoText: "Erro ao carregar",
      currentVolume: 50,
      isMuted: true,
      maxPlaybackMinutes: 5,
      autoplayMode: 'manual',
      playlistLink: '',
      blockedKeywords: []
    };
  }
}

async function isTitleBlocked(title) {
  if (!title) return false;
  try {
    const config = await getConfig();
    if (!config.blockedKeywords || config.blockedKeywords.length === 0) return false;
    const lowerTitle = title.toLowerCase();
    return config.blockedKeywords.some(keyword => {
      const kw = keyword.toLowerCase().trim();
      return kw.length > 0 && lowerTitle.includes(kw);
    });
  } catch (e) {
    return false;
  }
}

async function fetchVideoIdByName(name) {
  if (!name) return null;
  try {
    if (await isTitleBlocked(name)) return null;
    const result = await youtubeSearchApi.GetListByKeyword(name, false, 1);
    if (result && result.items && result.items.length > 0 && result.items[0].id) {
      const video = result.items[0];
      if (await isTitleBlocked(video.title)) return null;
      return video.id;
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function broadcastPlayerState() {
  try {
    const queue = await QueueModel.find({}).sort({ priority: -1, createdAt: 1 }).lean(); 
    const formattedQueue = queue.map(item => ({
        id: item.videoId,
        title: item.title,
        isCustomer: item.isCustomer,
        message: item.message
    }));
    io.emit('updatePlayerState', { nowPlaying: nowPlayingInfo, queue: formattedQueue });
  } catch (err) {}
}

async function playNextInQueue() {
  if (isAdvancingQueue) return;
  isAdvancingQueue = true;

  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  if (customerPlaybackTimer) {
    clearTimeout(customerPlaybackTimer);
    customerPlaybackTimer = null;
  }

  try {
      const nextVideo = await QueueModel.findOneAndDelete({}, { sort: { priority: -1, createdAt: 1 } });

      if (nextVideo) {
        const source = nextVideo.isCustomer ? 'customer' : (nextVideo.priority === 0 ? 'inactivity' : 'admin');

        await PlayHistoryModel.create({
          videoId: nextVideo.videoId,
          title: nextVideo.title,
          message: nextVideo.message || null,
          source,
          userPhone: nextVideo.userPhone || null,
          mpPaymentId: nextVideo.mpPaymentId || null
        });

        nowPlayingInfo = {
            id: nextVideo.videoId,
            title: nextVideo.title,
            message: nextVideo.message,
            isCustomer: nextVideo.isCustomer
        };
        isCustomerPlaying = nowPlayingInfo.isCustomer;
        
        if (isCustomerPlaying) {
          const config = await getConfig();
          const maxMinutes = config.maxPlaybackMinutes || 5;
          const maxMs = maxMinutes * 60 * 1000;
          customerPlaybackTimer = setTimeout(() => {
            playNextInQueue();
          }, maxMs);
        }

        io.emit('player:playVideo', {
          videoId: nowPlayingInfo.id,
          title: nowPlayingInfo.title,
          message: nowPlayingInfo.message
        });
      } else {
        nowPlayingInfo = null;
        isCustomerPlaying = false;
        io.emit('player:stop');
        startInactivityTimer();
      }
      broadcastPlayerState();
  } catch (err) {
  } finally {
      isAdvancingQueue = false;
  }
}

async function startInactivityTimer() {
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  try {
    const queueCount = await QueueModel.countDocuments();
    if (nowPlayingInfo || queueCount > 0) return;

    inactivityTimer = setTimeout(async () => {
      if (nowPlayingInfo) return;
      const countCheck = await QueueModel.countDocuments();
      if (countCheck > 0) return; 

      const config = await getConfig();
      if (config.autoplayMode === 'playlist' && config.playlistLink) {
          try {
              const searchResult = await youtubeSearchApi.GetListByKeyword(config.playlistLink, false, 15);
              if (searchResult && searchResult.items && searchResult.items.length > 0) {
                  const validVideos = [];
                  for (const item of searchResult.items) {
                      if (item.id && item.title && !(await isTitleBlocked(item.title))) {
                          validVideos.push(item);
                      }
                  }
                  if (validVideos.length > 0) {
                      const randomVideo = validVideos[Math.floor(Math.random() * validVideos.length)];
                      await QueueModel.create({
                          videoId: randomVideo.id,
                          title: randomVideo.title,
                          isCustomer: false,
                          message: null,
                          priority: 0 
                      });
                      playNextInQueue();
                      return;
                  }
              }
          } catch (err) {}
      }

      const inactivitySongs = await InactivityModel.find({}).lean(); 
      if (inactivitySongs.length > 0) {
        const itemsToInsert = [];
        for (const song of inactivitySongs) {
            if (!(await isTitleBlocked(song.title))) {
                itemsToInsert.push({
                  videoId: song.videoId,
                  title: song.title || '(Música da Casa)', 
                  isCustomer: false,
                  message: null,
                  priority: 0 
                });
            }
        }
        if (itemsToInsert.length > 0) {
            await QueueModel.insertMany(itemsToInsert);
            playNextInQueue();
        } else {
            broadcastPlayerState();
        }
      } else {
        broadcastPlayerState();
      }
    }, INACTIVITY_TIMEOUT);
  } catch (err) {}
}

app.get("/user-history", async (req, res) => {
    try {
        const phone = req.query.phone;
        if (!phone) return res.json({ ok: true, history: [] });

        const payments = await PaymentModel.find({ 
            userPhone: phone, 
            status: 'approved' 
        }).sort({ createdAt: -1 }).limit(30);

        const uniqueVideos = new Map();
        payments.forEach(p => {
            if(p.videos) {
                p.videos.forEach(v => {
                    if(!uniqueVideos.has(v.id)) {
                        uniqueVideos.set(v.id, {
                            id: v.id,
                            title: v.title,
                            thumbnail: v.thumbnail
                        });
                    }
                });
            }
        });
        res.json({ ok: true, history: Array.from(uniqueVideos.values()) });
    } catch (err) {
        res.status(500).json({ ok: false, error: 'Erro ao buscar histórico' });
    }
});

app.get("/discover", async (req, res) => {
  try {
    const popular = await PaymentModel.aggregate([
      { $match: { status: 'approved' } },
      { $unwind: '$videos' },
      { $match: { 'videos.id': { $type: 'string', $ne: '' } } },
      {
        $group: {
          _id: '$videos.id',
          title: { $last: '$videos.title' },
          channel: { $last: '$videos.channel' },
          thumbnail: { $last: '$videos.thumbnail' },
          requests: { $sum: 1 },
          lastRequestedAt: { $max: '$createdAt' }
        }
      },
      { $sort: { requests: -1, lastRequestedAt: -1 } },
      { $limit: 10 },
      {
        $project: {
          _id: 0,
          id: '$_id',
          title: 1,
          channel: 1,
          thumbnail: 1,
          requests: 1
        }
      }
    ]);

    const seen = new Set(popular.map(item => item.id));
    const results = [...popular];

    // Se o estabelecimento ainda não tiver histórico suficiente, completa a vitrine
    // com sugestões de busca. Isso não interfere na fila nem no player da TV.
    if (results.length < 8) {
      const fallbackTerm = 'músicas mais tocadas brasil 2026';
      let fallback = await SearchCacheModel.findOne({ term: fallbackTerm }).lean();

      if (!fallback) {
        const search = await youtubeSearchApi.GetListByKeyword(fallbackTerm, false, 10);
        const items = [];
        for (const item of search.items || []) {
          if (item.id && item.title && !(await isTitleBlocked(item.title))) {
            items.push({
              id: item.id,
              title: item.title,
              channel: item.channel?.name || 'YouTube',
              thumbnail: item.thumbnail?.thumbnails?.[0]?.url || ''
            });
          }
        }
        if (items.length) {
          try {
            fallback = await SearchCacheModel.create({ term: fallbackTerm, results: items });
          } catch {
            fallback = { results: items };
          }
        }
      }

      for (const item of fallback?.results || []) {
        if (!item?.id || seen.has(item.id)) continue;
        seen.add(item.id);
        results.push(item);
        if (results.length >= 10) break;
      }
    }

    res.json({ ok: true, results });
  } catch (err) {
    console.error('[Discover] Erro ao montar sugestões:', err);
    res.json({ ok: true, results: [] });
  }
});

app.get("/search", async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) return res.status(400).json({ ok: false, error: "Consulta inválida" });

    const lowerQuery = query.toLowerCase().trim();
    const cachedEntry = await SearchCacheModel.findOne({ term: lowerQuery }).lean();
    if (cachedEntry) {
        return res.json({ ok: true, results: cachedEntry.results });
    }

    const result = await youtubeSearchApi.GetListByKeyword(query, false, 8);
    const items = [];
    for (const item of result.items) {
      if (item.id && item.title) {
        if (!(await isTitleBlocked(item.title))) {
          items.push({
            id: item.id,
            title: item.title,
            channel: item.channel?.name ?? 'Canal Indefinido',
            thumbnail: item.thumbnail?.thumbnails?.[0]?.url || ''
          });
        }
      }
    }

    if (items.length > 0) {
        await SearchCacheModel.create({ term: lowerQuery, results: items });
    }
    res.json({ ok: true, results: items });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Erro interno na busca" });
  }
});

async function approveLocalPayment(paymentId, source = 'mercadopago') {
  const dbPayment = await PaymentModel.findOneAndUpdate(
    { mpPaymentId: String(paymentId), status: { $ne: 'approved' } },
    { $set: { status: 'approved' } },
    { new: true }
  );

  if (!dbPayment) return false;

  console.log(`[Server] Pagamento ${paymentId} APROVADO via ${source}.`);

  const config = await getConfig();
  config.dailyRevenue += Number(dbPayment.amount) || 0;
  config.totalSales += Number(dbPayment.amount) || 0;
  await config.save();
  io.emit('admin:updateRevenue', config.dailyRevenue);

  if (MASTER_URL && CLIENT_ID) {
    try {
      await fetch(`${MASTER_URL}/api/report-revenue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: CLIENT_ID,
          dailyRevenue: config.dailyRevenue,
          totalSales: config.totalSales
        })
      });
    } catch (syncErr) {
      console.error('[Server] Erro ao enviar faturamento para o QG Mestre:', syncErr.message);
    }
  }

  isCustomerPlaying = true;
  if (inactivityTimer) clearTimeout(inactivityTimer);
  inactivityTimer = null;

  const customerVideos = [];
  for (const v of dbPayment.videos || []) {
    if (!(await isTitleBlocked(v.title))) {
      customerVideos.push({
        videoId: v.id,
        title: v.title,
        isCustomer: true,
        message: dbPayment.message,
        userPhone: dbPayment.userPhone || null,
        mpPaymentId: dbPayment.mpPaymentId || null,
        priority: 1
      });
    }
  }

  if (customerVideos.length > 0) {
    await QueueModel.insertMany(customerVideos);
    io.emit('player:newOrderNotification', { title: customerVideos[0].title });
  }

  if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
    playNextInQueue();
  } else if (!nowPlayingInfo) {
    playNextInQueue();
  } else {
    broadcastPlayerState();
  }

  if (dbPayment.socketId) {
    const targetSocket = io.sockets.sockets.get(dbPayment.socketId);
    if (targetSocket) targetSocket.emit('paymentConfirmed');
  }

  return true;
}

app.post("/create-payment", async (req, res) => {
  try {
    const { videos, amount, description, message, socketId, userPhone } = req.body;
    if (!Array.isArray(videos) || videos.length === 0 || !socketId) {
      return res.status(400).json({ ok: false, error: "Dados inválidos." });
    }

    for (const v of videos) {
      if (await isTitleBlocked(v.title)) {
        return res.status(400).json({ ok: false, error: `A música "${v.title}" não é permitida pelo estabelecimento.` });
      }
    }

    let demoMode = false;
    if (MASTER_URL && CLIENT_ID) {
      try {
        const licenseResponse = await fetch(`${MASTER_URL}/api/check-license?client_id=${CLIENT_ID}`);
        if (licenseResponse.ok) {
          const licenseData = await licenseResponse.json();
          demoMode = licenseData?.demo === true || licenseData?.client?.demoMode === true;
        }
      } catch (licenseError) {
        console.error('[Demo] Não foi possível consultar o QG Mestre:', licenseError.message);
      }
    }

    if (demoMode) {
      const demoPaymentId = `demo-${Date.now()}-${randomBytes(4).toString('hex')}`;

      const demoPayment = await PaymentModel.create({
        mpPaymentId: demoPaymentId,
        socketId,
        userPhone,
        amount: 0,
        description: `[DEMO] ${description || 'Pedido PlayBar'}`,
        message,
        status: 'approved',
        videos
      });

      isCustomerPlaying = true;
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = null;

      const customerVideos = [];
      for (const v of demoPayment.videos) {
        if (!(await isTitleBlocked(v.title))) {
          customerVideos.push({
            videoId: v.id,
            title: v.title,
            isCustomer: true,
            message: demoPayment.message,
            userPhone: demoPayment.userPhone || null,
            mpPaymentId: demoPayment.mpPaymentId,
            priority: 1
          });
        }
      }

      if (customerVideos.length > 0) {
        await QueueModel.insertMany(customerVideos);
        io.emit('player:newOrderNotification', { title: customerVideos[0].title });
      }

      if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
        playNextInQueue();
      } else if (!nowPlayingInfo) {
        playNextInQueue();
      } else {
        broadcastPlayerState();
      }

      console.log(`[DEMO] Pedido ${demoPaymentId} liberado sem cobrança.`);
      return res.json({
        ok: true,
        demo: true,
        paymentId: demoPaymentId,
        status: 'approved'
      });
    }

    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ ok: false, error: "Valor de pagamento inválido." });
    }

    const notification_url = `https://${req.get('host')}/webhook`;

    const payment_data = {
      transaction_amount: numericAmount,
      description: description,
      payment_method_id: "pix",
      payer: { email: "pagador@email.com" },
      notification_url: notification_url
    };

    const result = await mercadoPagoApiRequest('/v1/payments', {
      method: 'POST',
      idempotencyKey: randomIdempotencyKey(),
      body: payment_data
    });

    if (
      !result?.id ||
      !result?.point_of_interaction?.transaction_data?.qr_code ||
      !result?.point_of_interaction?.transaction_data?.qr_code_base64
    ) {
      throw new Error('O Mercado Pago não retornou os dados completos do PIX.');
    }

    await PaymentModel.create({
      mpPaymentId: result.id.toString(),
      socketId: socketId,
      userPhone: userPhone,
      amount: numericAmount,
      description: description,
      message: message,
      status: 'pending',
      videos: videos
    });

    res.json({
      ok: true,
      demo: false,
      paymentId: result.id.toString(),
      qr: result.point_of_interaction.transaction_data.qr_code_base64,
      copiaCola: result.point_of_interaction.transaction_data.qr_code
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/payment-status/:paymentId', async (req, res) => {
  try {
    const paymentId = String(req.params.paymentId || '').trim();
    if (!paymentId) return res.status(400).json({ ok: false, error: 'paymentId obrigatório' });

    let localPayment = await PaymentModel.findOne({ mpPaymentId: paymentId }).select('status').lean();
    if (!localPayment) return res.status(404).json({ ok: false, error: 'Pagamento não encontrado' });

    if (localPayment.status === 'pending' && !paymentId.startsWith('demo-')) {
      try {
        const remotePayment = await mercadoPagoApiRequest('/v1/payments/' + encodeURIComponent(paymentId));
        const remoteStatus = String(remotePayment?.status || '').toLowerCase();

        if (remoteStatus === 'approved') {
          await approveLocalPayment(paymentId, 'consulta automática');
          localPayment = { status: 'approved' };
        } else if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(remoteStatus)) {
          await PaymentModel.updateOne(
            { mpPaymentId: paymentId, status: 'pending' },
            { $set: { status: remoteStatus } }
          );
          localPayment = { status: remoteStatus };
        }
      } catch (remoteError) {
        console.warn('[Mercado Pago] Falha temporária ao reconciliar pagamento:', remoteError.message);
      }
    }

    res.json({ ok: true, status: localPayment.status });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Erro ao consultar pagamento' });
  }
});

// --- Webhook Mercado Pago: assinatura validada + confirmação idempotente ---
app.post("/webhook", async (req, res) => {
  const notification = req.body || {};
  const paymentId = String(
    req.query?.['data.id'] ||
    notification?.data?.id ||
    notification?.id ||
    ''
  ).trim();

  if (!paymentId) return res.sendStatus(200);

  if (MP_WEBHOOK_SECRET) {
    const signatureValid = validateMercadoPagoWebhookSignature({
      secret: MP_WEBHOOK_SECRET,
      xSignature: req.get('x-signature') || '',
      xRequestId: req.get('x-request-id') || '',
      dataId: paymentId
    });

    if (!signatureValid) {
      console.warn('[Mercado Pago] Webhook rejeitado por assinatura inválida.');
      return res.status(401).json({ ok: false, error: 'Webhook não autorizado.' });
    }
  }

  // Responde rápido; a confirmação real sempre é consultada na API do Mercado Pago.
  res.sendStatus(200);

  Promise.resolve().then(async () => {
    const mpPayment = await mercadoPagoApiRequest('/v1/payments/' + encodeURIComponent(paymentId));
    const remoteStatus = String(mpPayment?.status || '').toLowerCase();

    if (remoteStatus === 'approved') {
      await approveLocalPayment(paymentId, 'webhook');
    } else if (['rejected', 'cancelled', 'refunded', 'charged_back'].includes(remoteStatus)) {
      await PaymentModel.updateOne(
        { mpPaymentId: paymentId, status: 'pending' },
        { $set: { status: remoteStatus } }
      );
    }
  }).catch((err) => {
    console.error('[Server] Erro ao processar webhook Mercado Pago:', err.message);
  });
});

io.on("connection", async (socket) => {
  socket.on('player:ready', async () => {
    const [freshConfig, queue] = await Promise.all([
        getConfig(),
        QueueModel.find({}).sort({ priority: -1, createdAt: 1 }).lean()
    ]);

    socket.emit('updatePlayerState', { 
        nowPlaying: nowPlayingInfo, 
        queue: queue.map(item => ({ id: item.videoId, title: item.title, isCustomer: item.isCustomer, message: item.message }))
    });
    
    socket.emit('player:setInitialState', { 
      volume: freshConfig.currentVolume, 
      isMuted: freshConfig.isMuted 
    });
    socket.emit('player:updatePromoText', freshConfig.currentPromoText);
    
    if (!nowPlayingInfo) {
        try {
            const count = await QueueModel.countDocuments();
            if (count > 0) playNextInQueue();
            else startInactivityTimer();
        } catch(e) {}
    }
  });

  socket.on('player:videoEnded', () => playNextInQueue());
  socket.on('player:ping', () => {
    socket.emit('player:pong', { ts: Date.now() });
  });
socket.on('admin:getList', async () => {
    try {
        const [freshConfig, inactivityList, queue, playHistory] = await Promise.all([
            getConfig(),
            InactivityModel.find({}).select('title videoId').lean(),
            QueueModel.find({}).sort({ priority: -1, createdAt: 1 }).lean(),
            PlayHistoryModel.find({}).sort({ playedAt: -1 }).limit(100).lean()
        ]);

        const inactivityItems = inactivityList.map(item => ({ title: item.title, videoId: item.videoId }));
        
        socket.emit('admin:loadInactivityList', inactivityItems);
        socket.emit('admin:updateRevenue', freshConfig.dailyRevenue);
        socket.emit('admin:updateVolume', { volume: freshConfig.currentVolume, isMuted: freshConfig.isMuted });
        socket.emit('admin:loadPromoText', freshConfig.currentPromoText);
        socket.emit('admin:playHistory', playHistory);

        socket.emit('admin:loadAutoplayConfig', { 
            mode: freshConfig.autoplayMode, 
            playlistLink: freshConfig.playlistLink 
        });
        socket.emit('admin:updateMaxPlaybackMinutes', freshConfig.maxPlaybackMinutes);
        socket.emit('admin:loadBlockedKeywords', freshConfig.blockedKeywords || []);

        const formattedQueue = queue.map(item => ({ 
            id: item.videoId, 
            title: item.title, 
            isCustomer: item.isCustomer, 
            message: item.message 
        }));
        socket.emit('admin:updatePlayerState', { nowPlaying: nowPlayingInfo, queue: formattedQueue });
    } catch(e) {}
  });

  socket.on('admin:getPlayHistory', async () => {
    try {
      const playHistory = await PlayHistoryModel.find({}).sort({ playedAt: -1 }).limit(100).lean();
      socket.emit('admin:playHistory', playHistory);
    } catch (e) {
      socket.emit('admin:playHistory', []);
    }
  });

  socket.on('admin:resetRevenue', async (callback) => {
    try {
      const config = await getConfig();
      config.dailyRevenue = 0; // Zera apenas o diário. O totalSales acumula!
      await config.save();
      io.emit('admin:updateRevenue', config.dailyRevenue);
      
      if (MASTER_URL && CLIENT_ID) {
          await fetch(`${MASTER_URL}/api/report-revenue`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                  client_id: CLIENT_ID, 
                  dailyRevenue: 0,
                  totalSales: config.totalSales 
              })
          });
      }

      if (typeof callback === 'function') callback({ ok: true });
    } catch (error) {
      if (typeof callback === 'function') callback({ ok: false });
    }
  });

  socket.on('admin:saveInactivityList', async (itemArray, callback) => {
    const newItems = [];
    const failedTitles = [];
    const items = Array.isArray(itemArray) ? itemArray : [];

    try {
        for (const item of items) {
            const name = typeof item === 'string' ? item.trim() : String(item?.title || '').trim();
            if (name.length > 0 && !(await isTitleBlocked(name))) {
                const id = typeof item === 'object' && item.videoId ? item.videoId : await fetchVideoIdByName(name);
                if (id) {
                  newItems.push({ title: name, videoId: id });
                } else {
                  failedTitles.push(name);
                }
            }
        }

        await InactivityModel.deleteMany({});
        if (newItems.length > 0) {
            await InactivityModel.insertMany(newItems); 
        }

        if (!isCustomerPlaying && !nowPlayingInfo) startInactivityTimer();
        const result = { ok: true, saved: newItems.length, failedTitles, items: newItems };
        socket.emit('admin:inactivityListSaved', result);
        if (typeof callback === 'function') callback(result);
    } catch (err) {
        if (typeof callback === 'function') callback({ ok: false, error: 'Erro ao salvar.' });
    }
  });

  socket.on('admin:searchForInactivityList', async (query) => {
      try {
        if (await isTitleBlocked(query)) return socket.emit('admin:inactivitySearchResults', []);
        const result = await youtubeSearchApi.GetListByKeyword(query, false, 5);
        const items = [];
        for (const i of result.items) {
            if (!(await isTitleBlocked(i.title))) {
                items.push({ id: i.id, title: i.title, channel: i.channel?.name });
            }
        }
        socket.emit('admin:inactivitySearchResults', items);
      } catch(e) { socket.emit('admin:inactivitySearchResults', []); }
  });

  socket.on('admin:search', async (query) => {
      try {
        if (await isTitleBlocked(query)) return socket.emit('admin:searchResults', []);
        const result = await youtubeSearchApi.GetListByKeyword(query, false, 5);
        const items = [];
        for (const i of result.items) {
            if (!(await isTitleBlocked(i.title))) {
                items.push({ id: i.id, title: i.title, channel: i.channel?.name });
            }
        }
        socket.emit('admin:searchResults', items);
      } catch(e) { socket.emit('admin:searchResults', []); }
  });

  socket.on('admin:addVideo', async ({ videoId, videoTitle }) => {
    if (videoId) {
      if (await isTitleBlocked(videoTitle)) return;
      try {
          await QueueModel.create({
              videoId: videoId,
              title: videoTitle,
              isCustomer: false,
              message: null,
              priority: 1
          });
          if (!nowPlayingInfo) playNextInQueue();
          else broadcastPlayerState();
      } catch(e) {}
    }
  });

  socket.on('admin:setAutoplayMode', async (mode) => {
      const config = await getConfig();
      config.autoplayMode = mode;
      await config.save();
  });

  socket.on('admin:savePlaylistLink', async (link, callback) => {
      const config = await getConfig();
      config.playlistLink = link;
      config.autoplayMode = 'playlist';
      await config.save();
      
      await QueueModel.deleteMany({ priority: 0 });

      if (nowPlayingInfo && !nowPlayingInfo.isCustomer) {
          playNextInQueue();
      } else if (!nowPlayingInfo) {
          startInactivityTimer();
      }

      broadcastPlayerState();
      if (typeof callback === 'function') callback({ ok: true });
  });

  socket.on('admin:setMaxPlaybackMinutes', async ({ minutes }) => {
      const config = await getConfig();
      config.maxPlaybackMinutes = minutes;
      await config.save();
  });

  socket.on('admin:saveBlockedKeywords', async (keywordsArray, callback) => {
      try {
          const config = await getConfig();
          const cleanKeywords = Array.isArray(keywordsArray) 
              ? keywordsArray.map(k => String(k).trim()).filter(k => k.length > 0)
              : [];
          
          config.blockedKeywords = cleanKeywords;
          await config.save();

          io.emit('admin:loadBlockedKeywords', cleanKeywords);
          if (typeof callback === 'function') callback({ ok: true, keywords: cleanKeywords });
      } catch (err) {
          if (typeof callback === 'function') callback({ ok: false });
      }
  });

  socket.on('admin:setPromoText', async (text) => {
    const config = await getConfig();
    config.currentPromoText = text;
    await config.save();
    io.emit('player:updatePromoText', text);
    io.emit('admin:loadPromoText', text);
  });

  socket.on('admin:controlPause', () => io.emit('player:pause'));
  socket.on('admin:controlSkip', () => playNextInQueue());

  socket.on('admin:controlVolume', async ({ volume }) => {
    const config = await getConfig();
    config.currentVolume = parseInt(volume);
    config.isMuted = (config.currentVolume === 0);
    await config.save();
    io.emit('admin:updateVolume', { volume: config.currentVolume, isMuted: config.isMuted });
    io.emit('player:setVolume', { volume: config.currentVolume, isMuted: config.isMuted });
  });
});

server.listen(PORT, () => {
  console.log(`🔥 Servidor rodando na porta ${PORT}`);
});
