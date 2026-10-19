import crypto from 'node:crypto';

export function sha256Base64Url(value) {
  return crypto.createHash('sha256').update(String(value)).digest('base64url');
}

function encryptionKey(secret) {
  if (!secret) throw new Error('Chave de criptografia do Mercado Pago não configurada.');
  return crypto.createHash('sha256').update(String(secret)).digest();
}

export function encryptSecret(value, secret) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((item) => item.toString('base64url')).join('.');
}

export function decryptSecret(payload, secret) {
  if (!payload) return null;
  const [ivPart, tagPart, dataPart] = String(payload).split('.');
  if (!ivPart || !tagPart || !dataPart) throw new Error('Segredo criptografado inválido.');

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    Buffer.from(ivPart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function buildMercadoPagoAuthorizationUrl({
  clientId,
  redirectUri,
  state,
  codeChallenge,
  authUrl = 'https://auth.mercadopago.com/authorization',
}) {
  if (!clientId || !redirectUri || !state || !codeChallenge) {
    throw new Error('Parâmetros OAuth do Mercado Pago incompletos.');
  }

  const url = new URL(authUrl);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: String(clientId),
    platform_id: 'mp',
    redirect_uri: String(redirectUri),
    state: String(state),
    code_challenge: String(codeChallenge),
    code_challenge_method: 'S256',
  }).toString();

  return url.toString();
}

export function validateMercadoPagoWebhookSignature({
  secret,
  xSignature,
  xRequestId,
  dataId,
}) {
  if (!secret || !xSignature || !xRequestId || !dataId) return false;

  let ts = '';
  let receivedHash = '';
  for (const part of String(xSignature).split(',')) {
    const [key, ...rest] = part.split('=');
    const value = rest.join('=').trim();
    if (key?.trim() === 'ts') ts = value;
    if (key?.trim() === 'v1') receivedHash = value;
  }

  if (!ts || !receivedHash) return false;

  const normalizedId = String(dataId).toLowerCase();
  const manifest = `id:${normalizedId};request-id:${xRequestId};ts:${ts};`;
  const expectedHash = crypto
    .createHmac('sha256', String(secret))
    .update(manifest)
    .digest('hex');

  const expected = Buffer.from(expectedHash, 'utf8');
  const received = Buffer.from(receivedHash, 'utf8');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

export function randomIdempotencyKey() {
  return crypto.randomUUID();
}
