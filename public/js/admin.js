const socket = io();

const revenueSpan = document.getElementById('revenue');
const resetRevenueBtn = document.getElementById('resetRevenueBtn');
const currentAdminPasswordInput = document.getElementById('currentAdminPassword');
const newAdminPasswordInput = document.getElementById('newAdminPassword');
const confirmAdminPasswordInput = document.getElementById('confirmAdminPassword');
const changeAdminPasswordBtn = document.getElementById('changeAdminPasswordBtn');
const searchVideoBtn = document.getElementById('searchVideoBtn');
const adminVideoSearchInput = document.getElementById('adminVideoSearchInput');
const adminSearchResultsDiv = document.getElementById('adminSearchResults');
const saveListBtn = document.getElementById('saveListBtn');
const inactivityListText = document.getElementById('inactivityList');
const inactivitySearchInput = document.getElementById('inactivitySearchInput');
const inactivitySearchBtn = document.getElementById('inactivitySearchBtn');
const inactivitySearchResultsDiv = document.getElementById('inactivitySearchResults');
const pauseBtn = document.getElementById('pauseBtn');
const skipBtn = document.getElementById('skipBtn');
const volumeSlider = document.getElementById('volumeSlider');
const volumeValueSpan = document.getElementById('volumeValue');
const maxPlaybackMinutesInput = document.getElementById('maxPlaybackMinutesInput');
const saveMaxPlaybackBtn = document.getElementById('saveMaxPlaybackBtn');
const adminNowPlayingSpan = document.getElementById('adminNowPlaying');
const adminNowPlayingMessageSpan = document.getElementById('adminNowPlayingMessage'); 
const adminQueueList = document.getElementById('adminQueueList');
const adminPlayHistoryList = document.getElementById('adminPlayHistory');
const refreshHistoryBtn = document.getElementById('refreshHistoryBtn');
const promoTextInput = document.getElementById('promoText');
const savePromoBtn = document.getElementById('savePromoBtn');
const commissionAmountSpan = document.getElementById('commissionAmount');
const commissionPercentSpan = document.getElementById('commissionPercent');

// Elementos do Filtro
const blockedKeywordInput = document.getElementById('blockedKeywordInput');
const addBlockedKeywordBtn = document.getElementById('addBlockedKeywordBtn');
const blockedKeywordsListContainer = document.getElementById('blockedKeywordsListContainer');

const autoplayModeSelect = document.getElementById('autoplayMode');
const manualAutoplaySection = document.getElementById('manualAutoplaySection');
const playlistAutoplaySection = document.getElementById('playlistAutoplaySection');

let inactivityItems = [];
let isSavingInactivityList = false;
let currentBlockedKeywords = [];

function showToast(message, type = 'info') {
    let backgroundColor;
    if (type === 'error') backgroundColor = "linear-gradient(to right, #ff5f6d, #ffc371)";
    else if (type === 'success') backgroundColor = "linear-gradient(to right, #00b09b, #96c93d)";
    else backgroundColor = "linear-gradient(to right, #007bff, #00c6ff)";

    Toastify({
        text: message,
        duration: 3000,
        close: true,
        gravity: "top",
        position: "center",
        stopOnFocus: true,
        style: { background: backgroundColor, borderRadius: "8px" },
    }).showToast();
}

function formatCurrency(value) {
    return Number(value || 0).toFixed(2).replace('.', ',');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderAdminPlayerState(state = {}) {
    const nowPlaying = state.nowPlaying || null;
    if (adminNowPlayingSpan) {
        if (nowPlaying) {
            adminNowPlayingSpan.textContent = nowPlaying.title + (!nowPlaying.isCustomer ? ' (Lista da Casa)' : '');
            if (adminNowPlayingMessageSpan) {
                if (nowPlaying.message) {
                    adminNowPlayingMessageSpan.textContent = `"${nowPlaying.message}"`;
                    adminNowPlayingMessageSpan.style.display = 'block';
                } else {
                    adminNowPlayingMessageSpan.style.display = 'none';
                }
            }
        } else {
            adminNowPlayingSpan.textContent = 'Nenhuma música tocando...';
            if (adminNowPlayingMessageSpan) adminNowPlayingMessageSpan.style.display = 'none';
        }
    }

    const dashNowPlaying = document.getElementById('dashNowPlaying');
    if (dashNowPlaying) dashNowPlaying.textContent = nowPlaying?.title || 'Nenhuma música tocando';

    if (adminQueueList) {
        if (Array.isArray(state.queue) && state.queue.length > 0) {
            adminQueueList.innerHTML = state.queue.map((video, index) => {
                const source = video.isCustomer ? 'Cliente' : 'Casa';
                const message = video.message ? ` • "${escapeHtml(video.message)}"` : '';
                return `<li class="queue-admin-item">
                    <div class="queue-admin-copy">
                        <strong>${String(index + 1).padStart(2, '0')} • ${escapeHtml(video.title || 'Sem título')}</strong>
                        <small>${source}${message}</small>
                    </div>
                    ${video.queueId ? `<div class="queue-admin-actions">
                        <button class="queue-action-btn next" type="button" data-queue-next="${escapeHtml(video.queueId)}" title="Tocar como próxima"><i class="fa-solid fa-arrow-up"></i></button>
                        <button class="queue-action-btn remove" type="button" data-queue-remove="${escapeHtml(video.queueId)}" title="Remover da fila"><i class="fa-solid fa-trash"></i></button>
                    </div>` : ''}
                </li>`;
            }).join('');
        } else {
            adminQueueList.innerHTML = '<li>(Fila vazia)</li>';
        }
    }
}


async function loadCommission() {
    if (!commissionAmountSpan || !commissionPercentSpan) return;
    try {
        const response = await fetch('/api/admin/commission', { credentials: 'same-origin' });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error);
        if (data.percent === null || data.percent === undefined) {
            commissionAmountSpan.textContent = '--';
            commissionPercentSpan.textContent = 'Percentual não informado pelo QG';
            return;
        }
        commissionAmountSpan.textContent = formatCurrency(data.amountDue);
        commissionPercentSpan.textContent = `${Number(data.percent).toLocaleString('pt-BR')}% do faturamento do dia`;
    } catch (error) {
        commissionAmountSpan.textContent = '--';
        commissionPercentSpan.textContent = 'Comissão indisponível';
    }
}

if (autoplayModeSelect) {
    autoplayModeSelect.addEventListener('change', (e) => {
        const mode = e.target.value;
        if (mode === 'playlist') {
            manualAutoplaySection.style.display = 'none';
            playlistAutoplaySection.style.display = 'block';
        } else {
            manualAutoplaySection.style.display = 'block';
            playlistAutoplaySection.style.display = 'none';
        }
        socket.emit('admin:setAutoplayMode', mode);
        showToast(`Modo alterado para: ${mode === 'playlist' ? 'Playlist Dinâmica' : 'Lista Manual'}`, 'info');
    });
}

document.addEventListener('click', (e) => {
    const btn = e.target.closest('.genre-select-btn');
    if (btn) {
        const link = btn.dataset.link;
        const genreName = btn.textContent.trim();

        document.querySelectorAll('.genre-select-btn').forEach(b => {
            b.style.opacity = '0.7';
            b.style.transform = 'scale(1)';
        });
        btn.style.opacity = '1';
        btn.style.transform = 'scale(1.02)';

        socket.emit('admin:savePlaylistLink', link, (response) => {
            if (response && response.ok) {
                showToast(`Autoplay ativado: ${genreName}!`, 'success');
            } else {
                showToast('Erro ao ativar o gênero.', 'error');
            }
        });
    }
});

// --- Lógica de Adicionar/Remover Termos Bloqueados ---
if (addBlockedKeywordBtn) {
    addBlockedKeywordBtn.addEventListener('click', () => {
        const term = blockedKeywordInput.value.trim();
        if (!term) return showToast('Digite um termo para bloquear.', 'error');
        if (currentBlockedKeywords.includes(term)) return showToast('Este termo já está bloqueado.', 'error');

        const updated = [...currentBlockedKeywords, term];
        socket.emit('admin:saveBlockedKeywords', updated, (res) => {
            if (res && res.ok) {
                blockedKeywordInput.value = '';
                showToast(`Termo "${term}" bloqueado com sucesso!`, 'success');
            } else {
                showToast('Erro ao salvar termo bloqueado.', 'error');
            }
        });
    });
}

if (blockedKeywordsListContainer) {
    blockedKeywordsListContainer.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-blocked-btn');
        if (removeBtn) {
            const termToRemove = removeBtn.dataset.term;
            const updated = currentBlockedKeywords.filter(k => k !== termToRemove);
            socket.emit('admin:saveBlockedKeywords', updated, (res) => {
                if (res && res.ok) {
                    showToast(`Termo "${termToRemove}" removido do bloqueio.`, 'info');
                } else {
                    showToast('Erro ao atualizar bloqueios.', 'error');
                }
            });
        }
    });
}

if (saveListBtn) {
    saveListBtn.addEventListener('click', () => {
        if (isSavingInactivityList) return;
        if (!socket.connected) return showToast('Sem conexão com o servidor.', 'error');
        const names = inactivityListText.value.split('\n').map(name => name.trim()).filter(name => name.length > 0);
        const availableItems = [...inactivityItems];
        const itemsToSave = names.map(title => {
            const matchIndex = availableItems.findIndex(item => item.title === title);
            return matchIndex === -1 ? { title } : availableItems.splice(matchIndex, 1)[0];
        });

        isSavingInactivityList = true;
        saveListBtn.disabled = true;
        saveListBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
        socket.emit('admin:saveInactivityList', itemsToSave);
    });
}

if (resetRevenueBtn) {
    resetRevenueBtn.addEventListener('click', () => {
        if (!confirm('Deseja zerar o faturamento do dia?')) return;
        socket.emit('admin:resetRevenue', (result) => {
            if (!result?.ok) return showToast('Erro ao zerar faturamento.', 'error');
            showToast('Faturamento do dia zerado.', 'success');
        });
    });
}

if (changeAdminPasswordBtn) {
    changeAdminPasswordBtn.addEventListener('click', async () => {
        const currentPassword = currentAdminPasswordInput?.value || '';
        const newPassword = newAdminPasswordInput?.value || '';
        const confirmation = confirmAdminPasswordInput?.value || '';
        if (!currentPassword || !newPassword) return showToast('Preencha os campos de senha.', 'error');
        if (newPassword.length < 8) return showToast('A senha deve ter pelo menos 8 caracteres.', 'error');
        if (newPassword !== confirmation) return showToast('As senhas não coincidem.', 'error');

        changeAdminPasswordBtn.disabled = true;
        try {
            const response = await fetch('/admin/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ currentPassword, newPassword })
            });
            const result = await response.json();
            if (!result?.ok) throw new Error(result?.error || 'Erro ao alterar senha.');
            currentAdminPasswordInput.value = '';
            newPasswordInput.value = '';
            confirmAdminPasswordInput.value = '';
            showToast('Senha alterada com sucesso!', 'success');
        } catch (error) {
            showToast(error.message, 'error');
        } finally {
            changeAdminPasswordBtn.disabled = false;
        }
    });
}

if (searchVideoBtn) {
    searchVideoBtn.addEventListener('click', () => {
        const query = adminVideoSearchInput.value.trim();
        if (!query) return showToast('Digite um termo para buscar.', 'error');
        adminSearchResultsDiv.innerHTML = '<p>Buscando...</p>';
        socket.emit('admin:search', query);
    });
}

if (inactivitySearchBtn) {
    inactivitySearchBtn.addEventListener('click', () => {
        const query = inactivitySearchInput.value.trim();
        if (!query) return showToast('Digite algo para buscar.', 'error');
        inactivitySearchResultsDiv.innerHTML = '<p>Buscando...</p>';
        socket.emit('admin:searchForInactivityList', query); 
    });
}

if (adminSearchResultsDiv) {
    adminSearchResultsDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-result-btn')) {
            const videoId = e.target.dataset.id;
            const videoTitle = e.target.dataset.title; 
            if (videoId) {
                socket.emit('admin:addVideo', { videoId, videoTitle }); 
                adminVideoSearchInput.value = '';
                adminSearchResultsDiv.innerHTML = '';
                showToast(`"${videoTitle}" adicionado à fila!`, 'success');
            }
        }
    });
}

if (inactivitySearchResultsDiv) {
    inactivitySearchResultsDiv.addEventListener('click', (e) => {
        if (e.target.classList.contains('add-inactivity-btn')) {
            const videoTitle = e.target.dataset.title;
            const videoId = e.target.dataset.id;
            if (videoTitle && inactivityListText) {
                const separator = inactivityListText.value.trim().length > 0 ? '\n' : '';
                inactivityListText.value += separator + videoTitle + '\n';
                if (videoId) inactivityItems.push({ title: videoTitle, videoId });
                inactivitySearchInput.value = '';
                inactivitySearchResultsDiv.innerHTML = '';
                showToast('Adicionado ao campo. Clique em "Salvar Lista Manual".', 'info');
            }
        }
    });
}

if (pauseBtn) {
    pauseBtn.addEventListener('click', () => socket.emit('admin:controlPause'));
}

if (skipBtn) {
    skipBtn.addEventListener('click', () => {
        if(confirm('Deseja pular a música atual?')) socket.emit('admin:controlSkip');
    });
}

if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
        const volume = e.target.value;
        if(volumeValueSpan) volumeValueSpan.textContent = `${volume}%`;
        socket.emit('admin:controlVolume', { volume });
    });
}

if (saveMaxPlaybackBtn) {
    saveMaxPlaybackBtn.addEventListener('click', () => {
        const minutes = Number(maxPlaybackMinutesInput?.value);
        if (!Number.isFinite(minutes) || minutes < 1 || minutes > 30) {
            return showToast('Informe um tempo entre 1 e 30 minutos.', 'error');
        }
        socket.emit('admin:setMaxPlaybackMinutes', { minutes: Math.round(minutes) });
        showToast('Tempo máximo atualizado!', 'success');
    });
}

if (savePromoBtn) {
    savePromoBtn.addEventListener('click', () => {
        socket.emit('admin:setPromoText', promoTextInput.value.trim());
        showToast('Promoção atualizada na TV!', 'success');
    });
}

if (refreshHistoryBtn) {
    refreshHistoryBtn.addEventListener('click', () => socket.emit('admin:getPlayHistory'));
}

socket.on('connect', () => socket.emit('admin:getList'));
socket.on('admin:updateRevenue', (amount) => {
  if (revenueSpan) revenueSpan.textContent = amount.toFixed(2).replace('.', ',');
  loadCommission();
});

loadCommission();

socket.on('admin:loadInactivityList', (nameArray) => {
  inactivityItems = (nameArray || []).map(item => typeof item === 'string' ? { title: item } : { title: item.title, videoId: item.videoId });
  if (inactivityListText) inactivityListText.value = inactivityItems.map(item => item.title).join('\n');
});

socket.on('admin:loadAutoplayConfig', (config) => {
    if (config.mode && autoplayModeSelect) {
        autoplayModeSelect.value = config.mode;
        autoplayModeSelect.dispatchEvent(new Event('change')); 
    }
});

// Renderiza a lista de termos bloqueados na interface do admin
socket.on('admin:loadBlockedKeywords', (keywords) => {
    currentBlockedKeywords = keywords || [];
    if (!blockedKeywordsListContainer) return;

    if (currentBlockedKeywords.length === 0) {
        blockedKeywordsListContainer.innerHTML = '<span style="font-size: 0.85rem; color: #666;">Nenhum termo bloqueado.</span>';
        return;
    }

    blockedKeywordsListContainer.innerHTML = currentBlockedKeywords.map(term => `
        <span style="background: #e2e8f0; color: #1e293b; padding: 4px 10px; border-radius: 6px; font-size: 0.85rem; display: inline-flex; align-items: center; gap: 6px; font-weight: 500;">
            ${term}
            <button class="remove-blocked-btn" data-term="${term}" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 0.9rem;" title="Remover bloqueio"><i class="fa-solid fa-xmark"></i></button>
        </span>
    `).join('');
});

socket.on('admin:inactivityListSaved', (result) => {
  isSavingInactivityList = false;
  if (saveListBtn) {
    saveListBtn.disabled = false;
    saveListBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Salvar Lista Manual';
  }
  if (!result?.ok) return showToast(result?.error || 'Erro ao salvar lista.', 'error');
  inactivityItems = result.items || [];
  if (inactivityListText) inactivityListText.value = inactivityItems.map(item => item.title).join('\n');
  showToast(`${result.saved} música(s) salva(s) com sucesso!`, 'success');
});

socket.on('admin:searchResults', (results) => {
  if (!adminSearchResultsDiv) return;
  if (results.length === 0) return adminSearchResultsDiv.innerHTML = '<p>Nenhum resultado.</p>';
  adminSearchResultsDiv.innerHTML = results.map(video => `
    <div class="search-result-item">
      <div class="result-info"><strong>${video.title}</strong><small>${video.channel}</small></div>
      <button class="add-result-btn" data-id="${video.id}" data-title="${video.title.replace(/"/g, "'")}">Adicionar</button>
    </div>
  `).join('');
});

socket.on('admin:inactivitySearchResults', (results) => {
  if (!inactivitySearchResultsDiv) return; 
  if (results.length === 0) return inactivitySearchResultsDiv.innerHTML = '<p>Nenhum resultado.</p>';
  inactivitySearchResultsDiv.innerHTML = results.map(video => `
    <div class="search-result-item">
      <div class="result-info"><strong>${video.title}</strong><small>${video.channel}</small></div>
      <button class="add-inactivity-btn" data-id="${video.id}" data-title="${video.title.replace(/"/g, "'")}">Adicionar</button>
    </div>
  `).join('');
});

socket.on('admin:updateVolume', (data) => {
  if (volumeSlider) volumeSlider.value = data.volume;
  if (volumeValueSpan) volumeValueSpan.textContent = `${data.volume}%`;
});

socket.on('admin:updateMaxPlaybackMinutes', (minutes) => {
  if (maxPlaybackMinutesInput) maxPlaybackMinutesInput.value = minutes;
});

socket.on('updatePlayerState', renderAdminPlayerState);
socket.on('admin:updatePlayerState', renderAdminPlayerState);

if (adminQueueList) {
  adminQueueList.addEventListener('click', (event) => {
    const nextBtn = event.target.closest('[data-queue-next]');
    const removeBtn = event.target.closest('[data-queue-remove]');

    if (nextBtn) {
      socket.emit('admin:queueNext', nextBtn.dataset.queueNext, (result) => {
        showToast(result?.ok ? 'Música movida para a próxima posição.' : (result?.error || 'Não foi possível reordenar a fila.'), result?.ok ? 'success' : 'error');
      });
      return;
    }

    if (removeBtn) {
      if (!confirm('Remover esta música da fila?')) return;
      socket.emit('admin:queueRemove', removeBtn.dataset.queueRemove, (result) => {
        showToast(result?.ok ? 'Música removida da fila.' : (result?.error || 'Não foi possível remover a música.'), result?.ok ? 'success' : 'error');
      });
    }
  });
}

socket.on('admin:loadPromoText', (text) => {
  if (promoTextInput) promoTextInput.value = text;
});

socket.on('admin:playHistory', (history) => {
  if (!adminPlayHistoryList) return;
  if (!history || history.length === 0) return adminPlayHistoryList.innerHTML = '<li>(Nenhuma música registrada)</li>';

  adminPlayHistoryList.innerHTML = history.map(item => {
    const playedAt = new Date(item.playedAt).toLocaleString('pt-BR');
    const sourceLabel = item.source === 'customer' ? 'Cliente' : (item.source === 'admin' ? 'Admin' : 'Inatividade');
    const phoneInfo = item.userPhone ? ` | Tel: ${item.userPhone}` : '';
    const messageInfo = item.message ? ` | Msg: "${item.message}"` : '';
    return `<li><strong>${item.title || 'Sem título'}</strong><br><small>${playedAt} | Origem: ${sourceLabel}${phoneInfo}${messageInfo}</small></li>`;
  }).join('');
});



// --- Navegação mobile em tela cheia ---
(() => {
  const MOBILE_ADMIN_BREAKPOINT = 820;
  const modal = document.getElementById('adminSectionModal');
  const modalBody = document.getElementById('adminSectionModalBody');
  const modalTitle = document.getElementById('adminSectionModalTitle');
  const closeBtn = document.getElementById('adminSectionModalClose');
  const navLinks = Array.from(document.querySelectorAll('.sidebar .nav-link'));

  if (!modal || !modalBody || !modalTitle || !closeBtn || navLinks.length === 0) return;

  const titles = {
    dashboard: 'Visão Geral',
    player: 'Controle do Player',
    queue: 'Fila & Buscas',
    autoplay: 'Inatividade (Autoplay)',
    settings: 'Configurações'
  };

  const hrefToGroup = {
    '#dashboard-section': 'dashboard',
    '#player-section': 'player',
    '#queue-section': 'queue',
    '#autoplay-section': 'autoplay',
    '#settings-section': 'settings'
  };

  let movedCards = [];
  let pageScrollY = 0;

  const isMobileAdmin = () => window.innerWidth <= MOBILE_ADMIN_BREAKPOINT;

  function setActiveNav(link) {
    document.querySelectorAll('.sidebar .nav-item').forEach(item => item.classList.remove('active'));
    link?.closest('.nav-item')?.classList.add('active');
  }

  function restoreCards() {
    for (const item of movedCards) {
      if (!item.card || !item.placeholder?.parentNode) continue;
      item.placeholder.parentNode.insertBefore(item.card, item.placeholder);
      item.placeholder.remove();
    }
    movedCards = [];
  }

  function closeAdminModal({ restoreScroll = true } = {}) {
    if (!modal.classList.contains('open')) return;
    restoreCards();
    modalBody.innerHTML = '';
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('admin-modal-open');
    if (restoreScroll) window.scrollTo(0, pageScrollY);
  }

  function openAdminModal(group, sourceLink) {
    const cards = Array.from(document.querySelectorAll(`[data-admin-group="${group}"]`));
    if (!cards.length) return;

    closeAdminModal({ restoreScroll: false });
    pageScrollY = window.scrollY;
    modalTitle.textContent = titles[group] || 'Painel Administrativo';
    setActiveNav(sourceLink);

    movedCards = cards.map(card => {
      const placeholder = document.createComment(`admin-modal-${group}`);
      card.parentNode.insertBefore(placeholder, card);
      modalBody.appendChild(card);
      return { card, placeholder };
    });

    modalBody.scrollTop = 0;
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('admin-modal-open');
    closeBtn.focus({ preventScroll: true });
  }

  navLinks.forEach(link => {
    link.addEventListener('click', event => {
      const group = hrefToGroup[link.getAttribute('href')];
      if (!group || !isMobileAdmin()) return;
      event.preventDefault();
      openAdminModal(group, link);
    });
  });

  closeBtn.addEventListener('click', () => closeAdminModal());

  modal.addEventListener('click', event => {
    if (event.target === modal) closeAdminModal();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && modal.classList.contains('open')) closeAdminModal();
  });

  window.addEventListener('resize', () => {
    if (!isMobileAdmin() && modal.classList.contains('open')) closeAdminModal({ restoreScroll: false });
  });
})();


// --- Mercado Pago OAuth ---
(() => {
  const badge = document.getElementById('mpStatusBadge');
  const title = document.getElementById('mpStatusTitle');
  const textEl = document.getElementById('mpStatusText');
  const accountInfo = document.getElementById('mpAccountInfo');
  const connectBtn = document.getElementById('mpConnectBtn');
  const disconnectBtn = document.getElementById('mpDisconnectBtn');

  if (!badge || !title || !textEl || !connectBtn || !disconnectBtn) return;

  function setBusy(busy) {
    connectBtn.disabled = busy;
    disconnectBtn.disabled = busy;
  }

  function renderStatus(data) {
    badge.className = 'mp-status-badge';

    if (!data.configured) {
      badge.classList.add('is-warning');
      badge.textContent = 'Configuração pendente';
      title.textContent = 'OAuth ainda não configurado';
      textEl.textContent = 'Configure as credenciais da aplicação Mercado Pago no servidor para liberar a conexão automática.';
      accountInfo.style.display = 'none';
      connectBtn.style.display = 'inline-flex';
      connectBtn.innerHTML = '<i class="fa-solid fa-link"></i> Configuração pendente';
      connectBtn.disabled = true;
      disconnectBtn.style.display = 'none';
      return;
    }

    connectBtn.disabled = false;

    if (data.connected) {
      badge.classList.add('is-connected');
      badge.textContent = 'Conectado';
      title.textContent = 'Conta Mercado Pago conectada';
      textEl.textContent = data.webhookConfigured
        ? 'Os próximos PIX serão gerados diretamente na conta autorizada. Webhook seguro está ativo.'
        : 'Conta conectada. Os PIX já funcionam; configure a chave secreta do Webhook do Mercado Pago para validar as notificações em tempo real.';
      if (data.userId) {
        accountInfo.textContent = `Conta Mercado Pago ID: ${data.userId}`;
        accountInfo.style.display = 'block';
      } else {
        accountInfo.style.display = 'none';
      }
      connectBtn.style.display = 'inline-flex';
      connectBtn.innerHTML = '<i class="fa-solid fa-rotate"></i> Reconectar';
      disconnectBtn.style.display = 'inline-flex';
      return;
    }

    if (data.source === 'legacy') {
      badge.classList.add('is-warning');
      badge.textContent = 'Chave antiga';
      title.textContent = 'Mercado Pago funcionando com Access Token manual';
      textEl.textContent = 'Conecte a conta para migrar para OAuth e não precisar mais informar chaves manualmente.';
    } else {
      badge.classList.add('is-disconnected');
      badge.textContent = 'Desconectado';
      title.textContent = 'Nenhuma conta Mercado Pago conectada';
      textEl.textContent = 'O dono do estabelecimento pode autorizar a própria conta com poucos cliques.';
    }

    accountInfo.style.display = 'none';
    connectBtn.style.display = 'inline-flex';
    connectBtn.innerHTML = '<i class="fa-solid fa-link"></i> Conectar Mercado Pago';
    disconnectBtn.style.display = 'none';
  }

  async function loadStatus() {
    try {
      const response = await fetch('/api/admin/mercadopago/status', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Falha ao consultar Mercado Pago.');
      renderStatus(data);
    } catch (error) {
      badge.className = 'mp-status-badge is-disconnected';
      badge.textContent = 'Erro';
      title.textContent = 'Não foi possível consultar o Mercado Pago';
      textEl.textContent = error.message || 'Atualize a página e tente novamente.';
    }
  }

  connectBtn.addEventListener('click', async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/admin/mercadopago/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !data.url) throw new Error(data.error || 'Não foi possível iniciar a conexão.');
      window.location.assign(data.url);
    } catch (error) {
      showToast(error.message || 'Erro ao conectar Mercado Pago.', 'error');
      setBusy(false);
    }
  });

  disconnectBtn.addEventListener('click', async () => {
    if (!confirm('Desconectar a conta do Mercado Pago? Novos PIX deixarão de usar esta conta.')) return;
    setBusy(true);
    try {
      const response = await fetch('/api/admin/mercadopago/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Não foi possível desconectar.');
      showToast('Conta Mercado Pago desconectada.', 'success');
      await loadStatus();
    } catch (error) {
      showToast(error.message || 'Erro ao desconectar Mercado Pago.', 'error');
    } finally {
      setBusy(false);
    }
  });

  const params = new URLSearchParams(window.location.search);
  const mpResult = params.get('mp');
  if (mpResult) {
    if (mpResult === 'connected') showToast('Mercado Pago conectado com sucesso!', 'success');
    else if (mpResult === 'cancelled') showToast('Conexão com Mercado Pago cancelada.', 'info');
    else if (mpResult === 'config') showToast('Configuração OAuth do Mercado Pago incompleta.', 'error');
    else if (mpResult === 'state') showToast('A autorização expirou. Tente conectar novamente.', 'error');
    else showToast('Não foi possível concluir a conexão com Mercado Pago.', 'error');

    params.delete('mp');
    const clean = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
    window.history.replaceState({}, '', clean);
  }

  loadStatus();
})();


// --- Operação comercial do cliente ---
(() => {
  const p1Limit = document.getElementById('package1Limit');
  const p1Price = document.getElementById('package1Price');
  const p2Limit = document.getElementById('package2Limit');
  const p2Price = document.getElementById('package2Price');
  const messageCost = document.getElementById('messageCostInput');
  const saveBtn = document.getElementById('saveCustomerConfigBtn');
  const toggleBtn = document.getElementById('settingsToggleOrdersBtn');
  const badge = document.getElementById('ordersSettingsBadge');
  const dashToggle = document.getElementById('toggleOrdersBtn');
  const dashBadge = document.getElementById('ordersModeBadge');

  let ordersEnabled = true;

  function renderOrdersState(enabled) {
    ordersEnabled = enabled !== false;
    const activeText = ordersEnabled ? 'Pedidos ativos' : 'Pedidos pausados';

    if (badge) {
      badge.textContent = activeText;
      badge.className = 'mp-status-badge ' + (ordersEnabled ? 'is-connected' : 'is-warning');
    }
    if (dashBadge) {
      dashBadge.textContent = ordersEnabled ? 'ATIVO' : 'PAUSADO';
      dashBadge.className = 'status-pill ' + (ordersEnabled ? 'ok' : 'warn');
    }
    if (toggleBtn) {
      toggleBtn.innerHTML = ordersEnabled
        ? '<i class="fa-solid fa-pause"></i> Pausar pedidos'
        : '<i class="fa-solid fa-play"></i> Reabrir pedidos';
    }
    if (dashToggle) {
      dashToggle.innerHTML = ordersEnabled
        ? '<i class="fa-solid fa-pause"></i> Pausar novos pedidos'
        : '<i class="fa-solid fa-play"></i> Reabrir pedidos';
      dashToggle.classList.toggle('btn-primary', !ordersEnabled);
      dashToggle.classList.toggle('btn-secondary', ordersEnabled);
    }
  }

  function toggleOrders() {
    const next = !ordersEnabled;
    const message = next
      ? 'Reabrir os pedidos pagos para os clientes?'
      : 'Pausar novos pedidos? O player e o telão continuarão funcionando normalmente.';
    if (!confirm(message)) return;

    socket.emit('admin:setOrdersEnabled', next, (result) => {
      if (!result?.ok) return showToast('Não foi possível alterar o recebimento de pedidos.', 'error');
      renderOrdersState(result.ordersEnabled);
      showToast(result.ordersEnabled ? 'Pedidos reabertos.' : 'Novos pedidos pausados.', 'success');
      window.dispatchEvent(new Event('playbar:dashboard-refresh'));
    });
  }

  socket.on('admin:loadCustomerConfig', (config = {}) => {
    if (p1Limit) p1Limit.value = config.package1Limit ?? 3;
    if (p1Price) p1Price.value = Number(config.package1Price ?? 2).toFixed(2);
    if (p2Limit) p2Limit.value = config.package2Limit ?? 5;
    if (p2Price) p2Price.value = Number(config.package2Price ?? 3).toFixed(2);
    if (messageCost) messageCost.value = Number(config.messageCost ?? 1).toFixed(2);
    renderOrdersState(config.ordersEnabled !== false);
  });

  saveBtn?.addEventListener('click', () => {
    const payload = {
      package1Limit: Number(p1Limit?.value),
      package1Price: Number(p1Price?.value),
      package2Limit: Number(p2Limit?.value),
      package2Price: Number(p2Price?.value),
      messageCost: Number(messageCost?.value),
      ordersEnabled
    };

    saveBtn.disabled = true;
    socket.emit('admin:saveCustomerConfig', payload, (result) => {
      saveBtn.disabled = false;
      if (!result?.ok) return showToast(result?.error || 'Erro ao salvar preços.', 'error');
      showToast('Pacotes e preços atualizados.', 'success');
      window.dispatchEvent(new Event('playbar:dashboard-refresh'));
    });
  });

  toggleBtn?.addEventListener('click', toggleOrders);
  dashToggle?.addEventListener('click', toggleOrders);
})();


// --- Dashboard operacional ---
(() => {
  const queueCount = document.getElementById('dashQueueCount');
  const ordersToday = document.getElementById('dashOrdersToday');
  const revenueToday = document.getElementById('dashRevenueToday');
  const pending = document.getElementById('dashPendingPayments');
  const playerBadge = document.getElementById('dashPlayerBadge');
  const statusPlayer = document.getElementById('statusPlayer');
  const statusMp = document.getElementById('statusMp');
  const statusQG = document.getElementById('statusQG');
  const refreshBtn = document.getElementById('dashRefreshBtn');
  const financeBody = document.getElementById('financeTableBody');
  const financeTotal = document.getElementById('financeTotal');
  const financeCount = document.getElementById('financeCount');
  const financeFilters = Array.from(document.querySelectorAll('.finance-filter'));
  let financeDays = 1;

  function setStatus(el, state, label) {
    if (!el) return;
    el.className = 'status-dot-label ' + state;
    el.innerHTML = '<i></i>' + label;
  }

  function renderOnboarding(onboarding = {}) {
    const keys = ['mercadoPago', 'prices', 'screen', 'firstOrder'];
    let done = 0;
    keys.forEach(key => {
      const el = document.querySelector(`.onboarding-step[data-check="${key}"]`);
      const ok = onboarding[key] === true;
      if (ok) done += 1;
      el?.classList.toggle('done', ok);
    });
    const progress = document.getElementById('onboardingProgress');
    if (progress) progress.textContent = `${done}/4`;
  }

  async function loadDashboard() {
    try {
      const response = await fetch('/api/admin/dashboard', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Falha no dashboard');

      if (queueCount) queueCount.textContent = data.queueCount ?? 0;
      if (ordersToday) ordersToday.textContent = data.ordersToday ?? 0;
      if (revenueToday) revenueToday.textContent = formatCurrency(data.revenueToday);
      if (pending) pending.textContent = data.pendingPayments ?? 0;
      const dashNowPlaying = document.getElementById('dashNowPlaying');
      if (dashNowPlaying) dashNowPlaying.textContent = data.nowPlaying?.title || 'Nenhuma música tocando';

      if (playerBadge) {
        playerBadge.textContent = data.playerOnline ? 'TELÃO ONLINE' : 'TELÃO OFFLINE';
        playerBadge.className = 'status-pill ' + (data.playerOnline ? 'ok' : 'bad');
      }
      setStatus(statusPlayer, data.playerOnline ? 'ok' : 'bad', data.playerOnline ? 'Online' : 'Offline');
      setStatus(statusMp, data.mercadoPago?.connected ? 'ok' : 'bad', data.mercadoPago?.connected ? 'Conectado' : 'Desconectado');

      if (!data.qg?.configured) setStatus(statusQG, 'warn', 'Não configurado');
      else setStatus(statusQG, data.qg?.online ? 'ok' : 'bad', data.qg?.online ? (data.qg.demo ? 'Demo' : 'Online') : 'Offline');

      renderOnboarding(data.onboarding);
    } catch (error) {
      setStatus(statusPlayer, 'warn', 'Indisponível');
      setStatus(statusMp, 'warn', 'Indisponível');
      setStatus(statusQG, 'warn', 'Indisponível');
    }
  }

  async function loadPayments() {
    if (!financeBody) return;
    financeBody.innerHTML = '<tr><td colspan="4">Carregando...</td></tr>';
    try {
      const response = await fetch(`/api/admin/payments?days=${financeDays}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || 'Falha no histórico');

      if (financeTotal) financeTotal.textContent = formatCurrency(data.totalApproved);
      if (financeCount) financeCount.textContent = `${data.approvedCount || 0} pedido${data.approvedCount === 1 ? '' : 's'}`;

      if (!data.payments?.length) {
        financeBody.innerHTML = '<tr><td colspan="4">Nenhum pagamento neste período.</td></tr>';
        return;
      }

      financeBody.innerHTML = data.payments.map(item => {
        const date = new Date(item.createdAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' });
        const label = item.status === 'approved' ? 'Aprovado' : item.status === 'pending' ? 'Pendente' : item.status;
        const statusClass = item.status === 'approved' ? 'approved' : item.status === 'pending' ? 'pending' : 'other';
        const description = item.description || `${item.tracks || 0} música(s)`;
        return `<tr>
          <td>${escapeHtml(date)}</td>
          <td><strong>${escapeHtml(description)}</strong><br><small>${escapeHtml(item.phone || 'Sem telefone')}</small></td>
          <td>R$ ${formatCurrency(item.amount)}</td>
          <td><span class="finance-status ${statusClass}">${escapeHtml(label)}</span></td>
        </tr>`;
      }).join('');
    } catch {
      financeBody.innerHTML = '<tr><td colspan="4">Não foi possível carregar o histórico.</td></tr>';
    }
  }

  refreshBtn?.addEventListener('click', () => { loadDashboard(); loadPayments(); });
  financeFilters.forEach(btn => btn.addEventListener('click', () => {
    financeFilters.forEach(item => item.classList.remove('active'));
    btn.classList.add('active');
    financeDays = Number(btn.dataset.days) || 1;
    loadPayments();
  }));

  document.getElementById('dashPauseBtn')?.addEventListener('click', () => socket.emit('admin:controlPause'));
  document.getElementById('dashSkipBtn')?.addEventListener('click', () => socket.emit('admin:controlSkip'));
  document.getElementById('dashOpenPlayerBtn')?.addEventListener('click', () => window.open('/player.html', '_blank', 'noopener'));
  document.getElementById('dashOpenCustomerBtn')?.addEventListener('click', () => window.open('/', '_blank', 'noopener'));

  window.addEventListener('playbar:dashboard-refresh', () => { loadDashboard(); loadPayments(); });
  socket.on('updatePlayerState', () => loadDashboard());
  socket.on('admin:updateRevenue', () => loadDashboard());

  loadDashboard();
  loadPayments();
  setInterval(loadDashboard, 15000);
})();


// --- QR Code do cliente ---
(() => {
  const qrEl = document.getElementById('adminQrCode');
  const urlEl = document.getElementById('adminQrUrl');
  const copyBtn = document.getElementById('copyCustomerUrlBtn');
  const printBtn = document.getElementById('printQrBtn');
  if (!qrEl) return;

  const customerUrl = window.location.origin + '/';
  if (urlEl) urlEl.textContent = customerUrl;

  if (window.QRCode) {
    qrEl.innerHTML = '';
    new QRCode(qrEl, {
      text: customerUrl,
      width: 136,
      height: 136,
      correctLevel: QRCode.CorrectLevel.H
    });
  } else {
    qrEl.textContent = 'QR indisponível';
  }

  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(customerUrl);
      showToast('Link do cliente copiado.', 'success');
    } catch {
      showToast('Não foi possível copiar o link.', 'error');
    }
  });

  printBtn?.addEventListener('click', () => {
    const image = qrEl.querySelector('img')?.src || qrEl.querySelector('canvas')?.toDataURL?.('image/png');
    if (!image) return showToast('QR Code ainda não está pronto.', 'error');
    const popup = window.open('', '_blank', 'width=520,height=620');
    if (!popup) return showToast('Permita pop-ups para imprimir o QR Code.', 'error');
    popup.document.write(`<!doctype html><html><head><title>QR Code PlayBar</title><style>body{font-family:Arial;text-align:center;padding:40px}img{width:320px;height:320px}h1{margin-bottom:6px}p{color:#555}</style></head><body><h1>PlayBar Music</h1><p>Escaneie e escolha sua música</p><img src="${image}" alt="QR Code"><p>${customerUrl}</p><script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
  });
})();


// --- PWA exclusivo do painel administrativo ---
(() => {
  const installBtn = document.getElementById('adminInstallBtn');
  if (!installBtn) return;

  let deferredPrompt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;

  function renderInstalled() {
    installBtn.classList.add('is-installed');
    installBtn.innerHTML = '<i class="fa-solid fa-circle-check"></i> Painel instalado';
    installBtn.disabled = true;
  }

  if (isStandalone()) {
    renderInstalled();
    return;
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    installBtn.disabled = false;
  });

  installBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      deferredPrompt = null;
      if (choice?.outcome === 'accepted') renderInstalled();
      return;
    }

    const isiOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    showToast(
      isiOS
        ? 'No iPhone/iPad: toque em Compartilhar e depois em “Adicionar à Tela de Início”.'
        : 'Se o botão de instalação não apareceu, abra o menu do navegador e escolha “Instalar app”.',
      'info'
    );
  });

  window.addEventListener('appinstalled', renderInstalled);
})();
