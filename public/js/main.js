const socket = io();

// --- DOM ---
const $ = (id) => document.getElementById(id);
const searchBtn = $('searchBtn');
const searchInput = $('searchInput');
const resultsDiv = $('results');
const selectedList = $('selected');
const countSpan = $('count');
const limitSpan = $('limit');
const selectionCountLabel = $('selectionCountLabel');
const toggleSelectionBtn = $('toggleSelectionBtn');
const pagarBtn = $('pagarBtn');
const pixArea = $('pixArea');
const pixTitle = $('pixTitle');
const qrCodeImg = $('qrCode');
const copiaColaWrapper = document.querySelector('.copia-cola-wrapper');
const copiaColaText = $('copiaCola');
const copyPixBtn = $('copyPixBtn');
const paymentStatusMsg = $('paymentStatusMsg');
const nowPlayingArea = $('now-playing-area');
const nowPlayingTitleSpan = $('nowPlayingTitle');
const packageRadios = document.querySelectorAll('input[name="package"]');
const wizardScreens = document.querySelectorAll('.wizard-screen');
const wizardStepBadges = document.querySelectorAll('.wizard-step');
const progressFill = $('progressFill');
const toStep2Btn = $('toStep2Btn');
const toStep3Btn = $('toStep3Btn');
const toStep4Btn = $('toStep4Btn');
const backToStep1Btn = $('backToStep1Btn');
const backToStep2Btn = $('backToStep2Btn');
const backToStep3Btn = $('backToStep3Btn');
const newOrderBtn = $('newOrderBtn');
const reviewSelected = $('reviewSelected');
const reviewPackageText = $('reviewPackageText');
const reviewPriceText = $('reviewPriceText');
const reviewCountText = $('reviewCountText');
const orderStatusText = $('orderStatusText');
const popularTracks = $('popularTracks');
const discoverSection = $('discoverSection');
const genreChips = $('genreChips');
const demoCenter = $('demo-center');
const demoNowPlaying = $('demo-now-playing');
const demoQueueCount = $('demo-queue-count');
const demoScreenStatus = $('demo-screen-status');
const ordersPausedBanner = $('ordersPausedBanner');

// Mensagem dedicada
const messageModal = $('messageModal');
const modalCloseBtn = $('modalCloseBtn');
const modalBtnYes = $('modalBtnYes');
const modalBtnNo = $('modalBtnNo');
const modalInitialButtons = $('modalInitialButtons');
const modalMessageInputArea = $('modalMessageInputArea');
const modalMessageText = $('modalMessageText');
const modalBtnConfirm = $('modalBtnConfirm');
const messageCharCount = $('messageCharCount');
let MESSAGE_COST = 1.00;

// Perfil
const navHome = $('nav-home');
const navDiscover = $('nav-discover');
const navUser = $('nav-user');
const homeArea = $('home-area');
const userProfileArea = $('user-profile-area');
const loginModal = $('loginModal');
const userPhoneInput = $('userPhoneInput');
const btnConfirmLogin = $('btnConfirmLogin');
const loginCloseBtn = $('loginCloseBtn');
const userPhoneDisplay = $('user-phone-display');
const historyList = $('history-list');
const historyLoading = $('history-loading');
const logoutBtn = $('logoutBtn');
const backToHomeBtn = $('backToHomeBtn');

// --- Estado ---
let selectedPackage = { limit: 3, price: 2.00, description: 'Pacote 3 Músicas' };
let selectedVideos = [];
let finalAmount = 0;
let finalDescription = '';
let finalMessage = null;
let currentUserPhone = localStorage.getItem('userPhone');
let currentStep = 1;
let currentPaymentId = null;
let paymentPollingInterval = null;
let discoverLoaded = false;
let isDemoMode = false;
let customerOrdersEnabled = true;

// --- Helpers ---
function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function safeThumb(url = '') {
  const value = String(url || '').trim();
  return /^https?:\/\//i.test(value) ? value : '';
}

function youtubeThumb(videoId = '') {
  const id = String(videoId || '').trim();
  return /^[A-Za-z0-9_-]{6,20}$/.test(id) ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : '';
}

function showToast(message, type = 'info') {
  let background;
  if (type === 'error') background = 'linear-gradient(to right,#9c2842,#d23d59)';
  else if (type === 'success') background = 'linear-gradient(to right,#2b936a,#2fbf88)';
  else background = 'linear-gradient(to right,#5e2e91,#7043c8)';

  if (typeof Toastify !== 'function') return;
  Toastify({
    text: message,
    duration: 2800,
    close: true,
    gravity: 'top',
    position: 'center',
    style: { background, borderRadius: '13px', fontSize: '12px', fontWeight: '700' }
  }).showToast();
}

function trackButtonLabel(id) {
  return selectedVideos.some(v => v.id === id) ? 'NA LISTA' : 'ADICIONAR';
}

function renderTrackCard(v, { rail = false, rank = null } = {}) {
  const id = escapeHtml(v?.id || '');
  const title = escapeHtml(v?.title || 'Sem título');
  const channel = escapeHtml(v?.channel || 'YouTube');
  const thumb = escapeHtml(safeThumb(v?.thumbnail) || youtubeThumb(v?.id));
  const selected = selectedVideos.some(item => item.id === v?.id);
  const data = [
    `data-id="${id}"`,
    `data-title="${title}"`,
    `data-channel="${channel}"`,
    `data-thumbnail="${thumb}"`
  ].join(' ');

  if (rail) {
    return `
      <article class="rail-card video-item-rail" data-video-id="${id}">
        <div class="cover">
          ${thumb ? `<img src="${thumb}" alt="" loading="lazy">` : ''}
          ${rank ? `<span class="rail-rank">#${rank}</span>` : ''}
        </div>
        <div class="rail-info">
          <strong>${title}</strong>
          <small>${channel}</small>
          <button class="select-btn" type="button" data-add-track ${data} ${selected ? 'disabled' : ''}>
            ${selected ? 'NA LISTA' : 'ADICIONAR'}
          </button>
        </div>
      </article>`;
  }

  return `
    <article class="video-item ${selected ? 'selected-video' : ''}" data-video-id="${id}">
      ${thumb ? `<img src="${thumb}" alt="" loading="lazy">` : '<div class="track-placeholder"></div>'}
      <div class="info">
        <strong>${title}</strong>
        <span class="track-channel">${channel}</span>
      </div>
      <button class="select-btn" type="button" data-add-track ${data} ${selected ? 'disabled' : ''}>
        ${selected ? 'NA LISTA' : 'ADICIONAR'}
      </button>
    </article>`;
}

function syncTrackButtons(id) {
  const isSelected = selectedVideos.some(v => v.id === id);
  document.querySelectorAll(`[data-video-id="${CSS.escape(id)}"]`).forEach(card => {
    card.classList.toggle('selected-video', isSelected);
    const btn = card.querySelector('[data-add-track]');
    if (btn) {
      btn.disabled = isSelected;
      btn.textContent = isSelected ? 'NA LISTA' : 'ADICIONAR';
    }
  });
}

function scrollTopSoft() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// --- Wizard ---
function goToStep(step, { scroll = true } = {}) {
  currentStep = step;
  wizardScreens.forEach((screen, index) => {
    screen.style.display = index + 1 === step ? 'block' : 'none';
  });

  const wizardProgress = $('wizard-progress');
  if (wizardProgress) {
    wizardProgress.classList.toggle('hidden', step === 1);
  }

  wizardStepBadges.forEach((badge) => {
    const badgeStep = Number(badge.dataset.step);
    badge.classList.toggle('active', badgeStep === step);
  });

  if (progressFill) {
    const widths = { 2: 25, 3: 50, 4: 75, 5: 100 };
    progressFill.style.width = `${widths[step] || 25}%`;
  }

  if (step === 2) loadDiscover();
  if (scroll) scrollTopSoft();
}

function resetUI() {
  selectedVideos = [];
  atualizarLista();
  if (pixArea) pixArea.style.display = 'none';
  if (qrCodeImg) qrCodeImg.style.display = 'block';
  if (copiaColaWrapper) copiaColaWrapper.style.display = 'grid';
  if (pixTitle) pixTitle.textContent = 'Faça o PIX';
  if (paymentStatusMsg) {
    paymentStatusMsg.style.display = 'none';
    paymentStatusMsg.textContent = '';
  }
  if (resultsDiv) resultsDiv.innerHTML = '';
  if (searchInput) searchInput.value = '';
  if (copyPixBtn) {
    copyPixBtn.innerHTML = '<span class="material-icons-round">content_copy</span> Copiar código';
    copyPixBtn.classList.remove('copied');
    copyPixBtn.disabled = false;
  }
  if (pagarBtn) pagarBtn.disabled = true;
  if (orderStatusText) orderStatusText.textContent = 'Pagamento aprovado! Seu pedido entrou na fila.';
  if (paymentPollingInterval) clearInterval(paymentPollingInterval);
  paymentPollingInterval = null;
  currentPaymentId = null;
  goToStep(1);
}

async function loadPublicConfig() {
  try {
    const res = await fetch('/api/public/config', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data?.ok) throw new Error('Configuração indisponível');

    const options = Array.from(document.querySelectorAll('.package-option'));
    const packages = Array.isArray(data.packages) ? data.packages.slice(0, 2) : [];

    packages.forEach((pkg, index) => {
      const option = options[index];
      if (!option) return;
      const radio = option.querySelector('input[name="package"]');
      const title = option.querySelector('strong');
      const price = option.querySelector('.package-price');
      if (!radio || !title || !price) return;

      const limit = Math.max(1, Number(pkg.limit) || (index === 0 ? 3 : 5));
      const value = Math.max(0, Number(pkg.price) || 0);
      radio.value = String(limit);
      radio.dataset.limit = String(limit);
      radio.dataset.price = value.toFixed(2);
      title.textContent = `${limit} música${limit === 1 ? '' : 's'}`;
      price.innerHTML = isDemoMode
        ? 'GRÁTIS'
        : `<span>R$</span> ${value.toFixed(2).replace('.', ',')}`;
    });

    MESSAGE_COST = Math.max(0, Number(data.messageCost) || 0);
    customerOrdersEnabled = data.ordersEnabled !== false;
    ordersPausedBanner?.classList.toggle('hidden', customerOrdersEnabled);

    if (modalBtnYes) {
      modalBtnYes.textContent = isDemoMode || MESSAGE_COST === 0
        ? 'Adicionar mensagem grátis'
        : `Adicionar mensagem (+ R$ ${MESSAGE_COST.toFixed(2).replace('.', ',')})`;
    }
    if ($('modalQuestion')) {
      $('modalQuestion').textContent = isDemoMode || MESSAGE_COST === 0
        ? 'Sua mensagem aparece na TV antes da música sem custo adicional.'
        : `Por mais R$ ${MESSAGE_COST.toFixed(2).replace('.', ',')}, sua mensagem aparece na TV antes da música.`;
    }

    if (toStep2Btn) toStep2Btn.disabled = !customerOrdersEnabled;
    updateSelectedPackage();
  } catch (error) {
    console.warn('[Config] Não foi possível atualizar pacotes:', error.message);
  }
}

async function loadDemoMode() {
  try {
    const res = await fetch('/api/status', { cache: 'no-store' });
    const data = await res.json();
    isDemoMode = data?.demo === true || data?.client?.demoMode === true;
  } catch {
    isDemoMode = false;
  }
  applyDemoUi();
}

function applyDemoUi() {
  demoCenter?.classList.toggle('hidden', !isDemoMode);

  const heroCopy = document.querySelector('.hero p');
  if (heroCopy) heroCopy.textContent = isDemoMode
    ? 'Demonstre o PlayBar completo sem cobrança. Escolha músicas, acompanhe no telão e controle tudo pelo painel ADM.'
    : 'Selecione seu pacote, escolha as músicas e pague por PIX. Seu pedido entra direto na fila do bar.';

  document.querySelectorAll('.package-option').forEach(option => {
    const priceEl = option.querySelector('.package-price');
    const radio = option.querySelector('input[name="package"]');
    if (!priceEl || !radio) return;
    const price = Number(radio.dataset.price || 0);
    priceEl.innerHTML = isDemoMode
      ? 'GRÁTIS'
      : `<span>R$</span> ${price.toFixed(2).replace('.', ',')}`;
  });

  const step3Copy = document.querySelector('#step-3 .section-heading p');
  if (step3Copy) step3Copy.textContent = isDemoMode
    ? 'Revise seu pedido antes de enviar.'
    : 'Revise antes de gerar o PIX.';

  const step4Title = document.querySelector('#step-4 .section-heading h2');
  const step4Copy = document.querySelector('#step-4 .section-heading p');
  const paymentLogo = document.querySelector('#step-4 .pix-logo');
  const paymentHeading = document.querySelector('#step-4 .payment-card h3');
  const paymentCopy = document.querySelector('#step-4 .payment-card > p');
  const progressLabel = document.querySelector('.wizard-step[data-step="4"] em');
  const trustFirst = document.querySelector('.trust-row div:first-child small');

  if (step4Title) step4Title.textContent = isDemoMode ? 'Modo Demo' : 'Pagamento';
  if (step4Copy) step4Copy.textContent = isDemoMode
    ? 'Seu pedido será enviado sem cobrança.'
    : 'Finalize por PIX para colocar as músicas na fila.';
  if (paymentLogo) paymentLogo.textContent = isDemoMode ? 'DEMO' : 'PIX';
  if (paymentHeading) paymentHeading.textContent = isDemoMode ? 'Pedido gratuito' : 'Pagamento instantâneo';
  if (paymentCopy) paymentCopy.textContent = isDemoMode
    ? 'Nenhum PIX será gerado. As músicas entram direto na fila.'
    : 'Após a confirmação, seu pedido entra automaticamente na fila do bar.';
  if (progressLabel) progressLabel.textContent = isDemoMode ? 'Demo' : 'PIX';
  if (trustFirst) trustFirst.textContent = isDemoMode ? 'Modo demo' : 'PIX rápido';

  updatePaymentButtonText();
  if (currentStep === 3) updateReviewStep();
}

function updateSelectedPackage() {
  const checked = document.querySelector('input[name="package"]:checked');
  if (!checked) return;
  selectedPackage.limit = Number(checked.dataset.limit);
  selectedPackage.price = Number(checked.dataset.price);
  selectedPackage.description = `Pacote ${selectedPackage.limit} Músicas`;

  if (limitSpan) limitSpan.textContent = String(selectedPackage.limit);
  if (selectedVideos.length > selectedPackage.limit) {
    const removed = selectedVideos.splice(selectedPackage.limit);
    removed.forEach(v => syncTrackButtons(v.id));
    showToast('Pacote alterado. A seleção foi ajustada ao novo limite.', 'info');
  }
  atualizarLista();
}

function updatePaymentButtonText() {
  if (!pagarBtn) return;
  pagarBtn.textContent = isDemoMode
    ? 'ENVIAR PEDIDO GRÁTIS'
    : `PAGAR R$ ${selectedPackage.price.toFixed(2).replace('.', ',')} (PIX)`;
  pagarBtn.disabled = selectedVideos.length !== selectedPackage.limit;
}

function atualizarLista() {
  if (selectedList) {
    selectedList.innerHTML = selectedVideos.map(v => `
      <li>
        <span>${escapeHtml(v.title)}</span>
        <button type="button" data-remove-track="${escapeHtml(v.id)}" aria-label="Remover">
          <span class="material-icons-round">close</span>
        </button>
      </li>`).join('');
  }
  if (countSpan) countSpan.textContent = String(selectedVideos.length);
  if (selectionCountLabel) selectionCountLabel.textContent = String(selectedVideos.length);
  if (toStep3Btn) toStep3Btn.disabled = selectedVideos.length !== selectedPackage.limit;
  if (toggleSelectionBtn) {
    toggleSelectionBtn.disabled = selectedVideos.length === 0;
    if (selectedVideos.length === 0) {
      selectedList?.classList.remove('expanded');
      selectedList?.classList.add('collapsed');
      toggleSelectionBtn.setAttribute('aria-expanded', 'false');
      toggleSelectionBtn.innerHTML = '<span class="material-icons-round">expand_more</span><span>Ver lista</span>';
    }
  }
  updatePaymentButtonText();
}

function updateReviewStep() {
  if (reviewPackageText) reviewPackageText.textContent = selectedPackage.description;
  if (reviewPriceText) reviewPriceText.textContent = isDemoMode
    ? 'GRÁTIS • MODO DEMO'
    : `R$ ${selectedPackage.price.toFixed(2).replace('.', ',')}`;
  if (reviewCountText) reviewCountText.textContent = `${selectedVideos.length} músicas`;
  if (reviewSelected) {
    reviewSelected.innerHTML = selectedVideos.map(v => `
      <li>
        <span class="review-song-title">${escapeHtml(v.title)}</span>
        <button class="remove-song-btn" type="button" data-remove-track="${escapeHtml(v.id)}" aria-label="Remover música">
          <span class="material-icons-round">close</span>
        </button>
      </li>`).join('');
  }
}

window.addVideo = (id, title, thumbnail = '', channel = '') => {
  if (!id) return;
  if (selectedVideos.some(v => v.id === id)) return showToast('Essa música já está na sua seleção.', 'info');
  if (selectedVideos.length >= selectedPackage.limit) return showToast(`Você já escolheu ${selectedPackage.limit} músicas.`, 'error');

  selectedVideos.push({ id, title, thumbnail, channel });
  atualizarLista();
  syncTrackButtons(id);
  showToast('Música adicionada ao pedido.', 'success');

  if (userProfileArea?.style.display === 'block') {
    showHome();
    goToStep(2);
  }
};

window.removerVideo = (id) => {
  selectedVideos = selectedVideos.filter(v => v.id !== id);
  atualizarLista();
  syncTrackButtons(id);
  if (currentStep === 3) updateReviewStep();
};

// --- Busca e descoberta ---
async function buscarVideos(queryOverride = null) {
  if (!searchInput || !resultsDiv) return;
  const q = String(queryOverride ?? searchInput.value).trim();
  if (!q) return showToast('Digite o nome de uma música ou artista.', 'error');

  searchInput.value = q;
  resultsDiv.innerHTML = '<div class="loading-state"><span class="spinner"></span>Buscando músicas...</div>';
  if (pixArea) pixArea.style.display = 'none';

  try {
    const res = await fetch(`/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.results) || data.results.length === 0) {
      resultsDiv.innerHTML = '<div class="loading-state">Nenhuma música encontrada.</div>';
      return;
    }
    resultsDiv.innerHTML = data.results.map(v => renderTrackCard(v)).join('');
  } catch {
    resultsDiv.innerHTML = '<div class="loading-state">Não foi possível buscar agora. Tente novamente.</div>';
  }
}

async function loadDiscover(force = false) {
  if (!popularTracks || (discoverLoaded && !force)) return;
  discoverLoaded = true;
  try {
    const res = await fetch('/discover', { cache: 'no-store' });
    const data = await res.json();
    const tracks = Array.isArray(data?.results) ? data.results : [];
    if (!data?.ok || tracks.length === 0) {
      discoverSection?.classList.add('hidden');
      return;
    }
    discoverSection?.classList.remove('hidden');
    popularTracks.innerHTML = tracks.slice(0, 10).map((v, i) => renderTrackCard(v, { rail: true, rank: i + 1 })).join('');
  } catch {
    discoverSection?.classList.add('hidden');
  }
}

// --- Perfil ---
function setNavActive(target) {
  [navHome, navDiscover, navUser].forEach(item => item?.classList.remove('active'));
  target?.classList.add('active');
}

function showHome() {
  if (homeArea) homeArea.style.display = 'block';
  if (userProfileArea) userProfileArea.style.display = 'none';
  setNavActive(navHome);
}

function showProfile() {
  if (!currentUserPhone) {
    if (loginModal) loginModal.style.display = 'flex';
    return;
  }
  if (homeArea) homeArea.style.display = 'none';
  if (userProfileArea) userProfileArea.style.display = 'block';
  setNavActive(navUser);
  if (userPhoneDisplay) userPhoneDisplay.textContent = `Celular: ${currentUserPhone}`;
  loadUserHistory();
  scrollTopSoft();
}

async function loadUserHistory() {
  if (!currentUserPhone || !historyList || !historyLoading) return;
  historyList.innerHTML = '';
  historyLoading.style.display = 'flex';
  try {
    const res = await fetch(`/user-history?phone=${encodeURIComponent(currentUserPhone)}`);
    const data = await res.json();
    historyLoading.style.display = 'none';
    if (!data.ok || !Array.isArray(data.history) || data.history.length === 0) {
      historyList.innerHTML = '<div class="loading-state">Você ainda não fez pedidos com este número.</div>';
      return;
    }
    historyList.innerHTML = data.history.map(v => renderTrackCard(v)).join('');
  } catch {
    historyLoading.style.display = 'none';
    historyList.innerHTML = '<div class="loading-state">Não foi possível carregar seu histórico.</div>';
  }
}

// --- Pagamento ---
async function proceedToPayment() {
  if (pagarBtn) pagarBtn.disabled = true;
  try {
    const res = await fetch('/create-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videos: selectedVideos,
        amount: finalAmount,
        description: finalDescription,
        message: finalMessage,
        socketId: socket.id,
        userPhone: currentUserPhone || null
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Não foi possível gerar o PIX.');

    currentPaymentId = data.paymentId || null;

    if (data.demo === true) {
      if (orderStatusText) orderStatusText.textContent = 'Modo demo: pedido enviado sem cobrança e já colocado na fila.';
      showToast('Modo demo: pedido enviado grátis!', 'success');
      goToStep(5);
      return;
    }

    if (pixArea) pixArea.style.display = 'block';
    if (qrCodeImg) qrCodeImg.src = `data:image/png;base64,${data.qr}`;
    if (copiaColaText) copiaColaText.value = data.copiaCola || '';
    startPaymentStatusPolling();
    showToast('PIX gerado. Aguardando pagamento.', 'success');
  } catch (error) {
    showToast(error.message || 'Erro ao gerar pagamento.', 'error');
    updatePaymentButtonText();
  }
}

function handlePaymentConfirmedUI() {
  if (paymentPollingInterval) clearInterval(paymentPollingInterval);
  paymentPollingInterval = null;

  if (qrCodeImg) qrCodeImg.style.display = 'none';
  if (copiaColaWrapper) copiaColaWrapper.style.display = 'none';
  if (pixTitle) pixTitle.textContent = 'PAGAMENTO APROVADO!';
  if (paymentStatusMsg) {
    paymentStatusMsg.textContent = 'Suas músicas estão na fila!';
    paymentStatusMsg.style.display = 'block';
  }
  if (orderStatusText) orderStatusText.textContent = 'Pagamento aprovado! Seu pedido entrou na fila.';
  showToast('Pagamento confirmado!', 'success');
  goToStep(5);
}

function startPaymentStatusPolling() {
  if (!currentPaymentId) return;
  if (paymentPollingInterval) clearInterval(paymentPollingInterval);
  paymentPollingInterval = setInterval(async () => {
    try {
      const res = await fetch(`/payment-status/${encodeURIComponent(currentPaymentId)}`, { cache: 'no-store' });
      const data = await res.json();
      if (data?.ok && data.status === 'approved') handlePaymentConfirmedUI();
    } catch {}
  }, 3000);
}

// --- Eventos da interface ---
toggleSelectionBtn?.addEventListener('click', () => {
  if (!selectedList || selectedVideos.length === 0) return;
  const expanded = !selectedList.classList.contains('expanded');
  selectedList.classList.toggle('expanded', expanded);
  selectedList.classList.toggle('collapsed', !expanded);
  toggleSelectionBtn.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  toggleSelectionBtn.innerHTML = expanded
    ? '<span class="material-icons-round">expand_more</span><span>Ocultar</span>'
    : '<span class="material-icons-round">expand_more</span><span>Ver lista</span>';
});

searchBtn?.addEventListener('click', () => buscarVideos());
searchInput?.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') buscarVideos();
});

genreChips?.addEventListener('click', (event) => {
  const button = event.target.closest('[data-genre]');
  if (!button) return;
  buscarVideos(button.dataset.genre);
});

document.addEventListener('click', (event) => {
  const addButton = event.target.closest('[data-add-track]');
  if (addButton) {
    window.addVideo(
      addButton.dataset.id,
      addButton.dataset.title,
      addButton.dataset.thumbnail,
      addButton.dataset.channel
    );
    return;
  }
  const removeButton = event.target.closest('[data-remove-track]');
  if (removeButton) window.removerVideo(removeButton.dataset.removeTrack);
});

packageRadios.forEach(radio => radio.addEventListener('change', updateSelectedPackage));
toStep2Btn?.addEventListener('click', () => {
  if (!customerOrdersEnabled) return showToast('Os pedidos estão temporariamente pausados pelo estabelecimento.', 'info');
  goToStep(2);
});
backToStep1Btn?.addEventListener('click', () => goToStep(1));
toStep3Btn?.addEventListener('click', () => {
  if (selectedVideos.length !== selectedPackage.limit) return;
  updateReviewStep();
  goToStep(3);
});
backToStep2Btn?.addEventListener('click', () => goToStep(2));
toStep4Btn?.addEventListener('click', () => goToStep(4));
backToStep3Btn?.addEventListener('click', () => goToStep(3));
newOrderBtn?.addEventListener('click', resetUI);

navHome?.addEventListener('click', event => {
  event.preventDefault();
  showHome();
  goToStep(1);
});
navDiscover?.addEventListener('click', event => {
  event.preventDefault();
  showHome();
  setNavActive(navDiscover);
  if (!customerOrdersEnabled) return showToast('Os pedidos estão temporariamente pausados pelo estabelecimento.', 'info');
  goToStep(2);
});
navUser?.addEventListener('click', event => {
  event.preventDefault();
  showProfile();
});
backToHomeBtn?.addEventListener('click', () => {
  showHome();
  goToStep(1);
});

btnConfirmLogin?.addEventListener('click', () => {
  const phone = String(userPhoneInput?.value || '').trim();
  if (phone.length < 8) return showToast('Digite um telefone válido.', 'error');
  currentUserPhone = phone;
  localStorage.setItem('userPhone', phone);
  if (loginModal) loginModal.style.display = 'none';
  showProfile();
  showToast('Histórico carregado.', 'success');
});
loginCloseBtn?.addEventListener('click', () => {
  if (loginModal) loginModal.style.display = 'none';
});
logoutBtn?.addEventListener('click', () => {
  localStorage.removeItem('userPhone');
  currentUserPhone = null;
  showHome();
  goToStep(1);
  showToast('Você saiu do histórico.', 'info');
});

pagarBtn?.addEventListener('click', () => {
  if (selectedVideos.length !== selectedPackage.limit || !messageModal) return;
  modalInitialButtons.style.display = 'grid';
  modalMessageInputArea.style.display = 'none';
  modalMessageText.value = '';
  if (messageCharCount) messageCharCount.textContent = '0/180';
  if ($('modalTitle')) $('modalTitle').textContent = 'Quer deixar uma mensagem?';
  if ($('modalQuestion')) $('modalQuestion').textContent = isDemoMode
    ? 'No modo demo, a mensagem também é grátis e aparece na TV antes da música.'
    : (MESSAGE_COST === 0
        ? 'Sua mensagem aparece na TV antes da música sem custo adicional.'
        : `Por mais R$ ${MESSAGE_COST.toFixed(2).replace('.', ',')}, sua mensagem aparece na TV antes da música.`);
  finalMessage = null;
  finalAmount = selectedPackage.price;
  finalDescription = selectedPackage.description;
  messageModal.style.display = 'flex';
});

modalBtnNo?.addEventListener('click', () => {
  messageModal.style.display = 'none';
  proceedToPayment();
});
modalBtnYes?.addEventListener('click', () => {
  modalInitialButtons.style.display = 'none';
  modalMessageInputArea.style.display = 'block';
  if ($('modalTitle')) $('modalTitle').textContent = 'Escreva sua mensagem';
  if ($('modalQuestion')) $('modalQuestion').textContent = 'Ela será exibida na TV antes do seu pedido.';
  finalAmount = selectedPackage.price + MESSAGE_COST;
  finalDescription = selectedPackage.description + ' + Mensagem';
  modalBtnConfirm.textContent = isDemoMode
    ? 'ENVIAR PEDIDO GRÁTIS'
    : `IR PARA O PIX - R$ ${finalAmount.toFixed(2).replace('.', ',')}`;
});
modalBtnConfirm?.addEventListener('click', () => {
  finalMessage = modalMessageText.value.trim();
  messageModal.style.display = 'none';
  proceedToPayment();
});
modalMessageText?.addEventListener('input', () => {
  if (messageCharCount) messageCharCount.textContent = `${modalMessageText.value.length}/180`;
});
modalCloseBtn?.addEventListener('click', () => {
  if (messageModal) messageModal.style.display = 'none';
});

copyPixBtn?.addEventListener('click', async () => {
  if (!copiaColaText?.value) return;
  try {
    await navigator.clipboard.writeText(copiaColaText.value);
  } catch {
    copiaColaText.select();
    document.execCommand('copy');
  }
  copyPixBtn.innerHTML = '<span class="material-icons-round">check</span> Código copiado';
  copyPixBtn.disabled = true;
  showToast('Código PIX copiado.', 'success');
});

// --- Socket: somente estado do player e confirmação de pagamento ---
// O sistema de reações para a TV foi removido do cliente para deixar a experiência mais leve.
socket.on('connect', () => console.log('PlayBar conectado.'));
socket.on('updatePlayerState', state => {
  if (state?.nowPlaying) {
    if (nowPlayingTitleSpan) nowPlayingTitleSpan.textContent = state.nowPlaying.title || 'Música atual';
    if (nowPlayingArea) nowPlayingArea.style.display = 'flex';
    if (demoNowPlaying) demoNowPlaying.textContent = state.nowPlaying.title || 'Música atual';
    if (demoScreenStatus) demoScreenStatus.textContent = 'AO VIVO';
  } else {
    if (nowPlayingArea) nowPlayingArea.style.display = 'none';
    if (demoNowPlaying) demoNowPlaying.textContent = 'Nenhuma música tocando';
    if (demoScreenStatus) demoScreenStatus.textContent = 'AGUARDANDO';
  }

  const queueSize = Array.isArray(state?.queue) ? state.queue.length : 0;
  if (demoQueueCount) {
    demoQueueCount.textContent = queueSize === 0
      ? 'Fila vazia'
      : `${queueSize} música${queueSize === 1 ? '' : 's'} na fila`;
  }
});
socket.on('paymentConfirmed', handlePaymentConfirmedUI);

document.addEventListener('DOMContentLoaded', async () => {
  await loadPublicConfig();
  updateSelectedPackage();
  goToStep(1, { scroll: false });
  loadDiscover();
  loadDemoMode();
  setInterval(loadDemoMode, 15000);
  setInterval(loadPublicConfig, 30000);
});