'use strict';

// ─── State ────────────────────────────────────────────────────────────────────
let currentPhotos = [];
let lbIndex = 0;
let currentAlbumId = null;
let selFilter = 'all';
let photoSearch = '';       // search query
let photoSort = 'default';  // 'default' | 'name-asc' | 'name-desc'
let renderLimit = 50;       // limits the number of visible cards
let selections = {}; // { [photoId]: 'selected'|'later'|null }
let photoComments = {}; // { [photoId]: string }

// ─── Token helpers ────────────────────────────────────────────────────────────
const getToken = () => localStorage.getItem('client_token');
const getUser  = () => { try { return JSON.parse(localStorage.getItem('client_user')); } catch { return null; } };
const setSession = (token, user) => {
  localStorage.setItem('client_token', token);
  localStorage.setItem('client_user', JSON.stringify(user));
};
const clearSession = () => {
  localStorage.removeItem('client_token');
  localStorage.removeItem('client_user');
};

// ─── Selection persistence ────────────────────────────────────────────────────
function loadSelections(albumId) {
  try { const r = localStorage.getItem(`sel_${albumId}`); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function saveSelections(albumId, data) { localStorage.setItem(`sel_${albumId}`, JSON.stringify(data)); }

// ─── Comment persistence ──────────────────────────────────────────────────────
function loadComments(albumId) {
  try { const r = localStorage.getItem(`cmt_${albumId}`); return r ? JSON.parse(r) : {}; } catch { return {}; }
}
function saveComments(albumId, data) { localStorage.setItem(`cmt_${albumId}`, JSON.stringify(data)); }
function getPhotoComment(photoId) { return photoComments[photoId] || ''; }
function setPhotoComment(photoId, text) {
  if (text.trim()) photoComments[photoId] = text.trim();
  else delete photoComments[photoId];
  saveComments(currentAlbumId, photoComments);
  const card = document.querySelector(`.photo-item[data-id="${photoId}"]`);
  if (card) updateCommentBadge(card, text.trim());
}
function updateCommentBadge(card, text) {
  let badge = card.querySelector('.photo-comment-badge');
  if (text) {
    if (!badge) { badge = document.createElement('div'); badge.className = 'photo-comment-badge'; card.appendChild(badge); }
    badge.innerHTML = '💬'; badge.title = text;
  } else { badge?.remove(); }
}
function getPhotoState(photoId) {
  return selections[photoId] || null;
}
function setPhotoState(photoId, state) {
  // Toggle: if same state clicked again → unset
  if (selections[photoId] === state) {
    selections[photoId] = null;
  } else {
    selections[photoId] = state;
  }
  saveSelections(currentAlbumId, selections);
  updateSelCounter();
  // Re-render the specific card
  const card = document.querySelector(`.photo-item[data-id="${photoId}"]`);
  if (card) applyCardState(card, selections[photoId]);
}

function getSelectedPhotos() {
  return currentPhotos.filter(p => selections[p.id] === 'selected');
}
function updateSelCounter() {
  const sel = getSelectedPhotos().length;
  const total = currentPhotos.length;
  const countEl = document.getElementById('sel-counter');
  if (countEl) countEl.textContent = `Đã chọn: ${sel} / ${total}`;
  const btn = document.getElementById('btn-submit-sel');
  if (btn) btn.disabled = sel === 0;
  // Update filter tab counts
  updateTabCounts();
}
function updateTabCounts() {
  const counts = {
    all:      currentPhotos.length,
    selected: currentPhotos.filter(p => selections[p.id] === 'selected').length,
    later:    currentPhotos.filter(p => selections[p.id] === 'later').length,
    none:     currentPhotos.filter(p => !selections[p.id]).length,
  };
  document.querySelectorAll('.sel-tab').forEach(btn => {
    const f = btn.dataset.filter;
    const count = counts[f] ?? 0;
    btn.dataset.count = count;
    // Update badge if present
    let badge = btn.querySelector('.sel-tab-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'sel-tab-badge';
      btn.appendChild(badge);
    }
    badge.textContent = count;
  });
  const info = document.getElementById('sel-info');
  if (info) {
    const filtered = getFilteredPhotos();
    info.textContent = `Ảnh 1 - ${filtered.length}, Tổng ${currentPhotos.length}`;
  }
}

function getFilteredPhotos() {
  let list;
  if (selFilter === 'all')      list = [...currentPhotos];
  else if (selFilter === 'selected') list = currentPhotos.filter(p => selections[p.id] === 'selected');
  else if (selFilter === 'later')    list = currentPhotos.filter(p => selections[p.id] === 'later');
  else if (selFilter === 'none')     list = currentPhotos.filter(p => !selections[p.id]);
  else list = [...currentPhotos];

  // Apply search
  if (photoSearch.trim()) {
    const q = photoSearch.trim().toLowerCase();
    list = list.filter(p => (p.name || '').toLowerCase().includes(q));
  }

  // Apply sort
  if (photoSort === 'name-asc') {
    list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'vi'));
  } else if (photoSort === 'name-desc' || photoSort === 'name-desc-alt') {
    list.sort((a, b) => (b.name || '').localeCompare(a.name || '', 'vi'));
  } else if (photoSort === 'time-desc') {
    // Mới nhất trước
    list.sort((a, b) => new Date(b.createdTime || 0) - new Date(a.createdTime || 0));
  } else if (photoSort === 'time-asc') {
    // Cũ nhất trước
    list.sort((a, b) => new Date(a.createdTime || 0) - new Date(b.createdTime || 0));
  }
  // 'default' → giữ thứ tự gốc từ Drive

  return list;
}

// ─── Screen helpers ───────────────────────────────────────────────────────────
const screens = ['login-screen', 'dashboard-screen', 'album-screen'];
function showScreen(id) {
  screens.forEach(s => {
    const el = document.getElementById(s);
    if (el) el.classList.toggle('hidden', s !== id);
  });
}

// ─── Loader ───────────────────────────────────────────────────────────────────
function hideLoader() {
  const loader = document.getElementById('page-loader');
  if (loader) { loader.classList.add('hidden'); setTimeout(() => loader.remove(), 700); }
}

// ─── Decode JWT ───────────────────────────────────────────────────────────────
function decodeJWT(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const binStr = atob(base64 + padding);
    const bytes = new Uint8Array(binStr.length);
    for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i);
    }
    return JSON.parse(new TextDecoder('utf-8').decode(bytes));
  } catch (e) {
    console.error('JWT decode error:', e.message);
    return null;
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function enterDashboard(user) {
  showScreen('dashboard-screen');
  ['user-avatar', 'user-avatar-2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.src = user.picture || ''; el.alt = user.name || ''; }
  });
  ['user-name', 'user-name-2'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = user.name || user.email;
  });
  const sub = document.getElementById('dash-sub');
  if (sub) sub.textContent = `Xin chào, ${user.name || user.email.split('@')[0]} 👋`;
  loadAlbums().then(() => checkAutoOpenAlbum());
}

function checkAutoOpenAlbum() {
  const params = new URLSearchParams(window.location.search);
  const albumId = params.get('album');
  if (!albumId) return;
  // Remove param from URL without reload
  history.replaceState(null, '', '/client');
  // Find album in current list
  const card = document.querySelector(`.album-card[data-id="${albumId}"]`);
  if (card && !card.classList.contains('no-access')) {
    openAlbum(card.dataset.id, card.dataset.title, card.dataset.desc || '');
  }
}

// ─── Load Albums ──────────────────────────────────────────────────────────────
async function loadAlbums() {
  const grid = document.getElementById('albums-grid');
  const empty = document.getElementById('albums-empty');
  grid.innerHTML = '<div class="albums-loading"><div class="loading-bars"><span></span><span></span><span></span><span></span></div></div>';
  empty.classList.add('hidden');
  try {
    const res = await fetch(`${API_BASE}/albums`, {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    });
    if (res.status === 401) return logout();
    const albums = await res.json();
    renderAlbums(albums, grid, empty);
  } catch {
    grid.innerHTML = `<p style="color:#6e6b64;padding:3rem;grid-column:1/-1;text-align:center;">Lỗi tải dữ liệu. Vui lòng thử lại.</p>`;
  }
}

// ─── Render Albums ────────────────────────────────────────────────────────────
function renderAlbums(albums, grid, empty) {
  if (!albums || albums.length === 0) {
    grid.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  grid.innerHTML = albums.map(a => {
    const date = a.created_at
      ? new Date(a.created_at).toLocaleDateString('vi-VN', { year: 'numeric', month: 'long' })
      : '';
    const saved = loadSelections(a.id);
    const selCount = Object.values(saved).filter(v => v === 'selected').length;
    const imgHtml = a.cover_image
      ? `<img src="${escHtml(a.cover_image)}" alt="${escHtml(a.title)}" loading="lazy"/>`
      : `<div class="album-card-placeholder"><div class="ic">📷</div></div>`;

    const privacyBadge = a.is_public
      ? `<span class="album-privacy-badge public">🌐 Công khai</span>`
      : `<span class="album-privacy-badge private">🔒 Riêng tư</span>`;

    // No access state
    if (!a.has_access) {
      const reqStatus = a.request_status;
      const requestArea = reqStatus === 'pending'
        ? `<div class="album-request-pending">⏳ Đang chờ phê duyệt...</div>`
        : reqStatus === 'rejected'
          ? `<button class="album-request-btn rejected" data-id="${a.id}">🔄 Gửi lại yêu cầu</button>`
          : `<button class="album-request-btn" data-id="${a.id}">🔑 Yêu cầu xem album</button>`;
      return `
        <div class="album-card no-access" data-id="${a.id}" data-title="${escHtml(a.title)}" data-desc="${escHtml(a.description || '')}">
          ${privacyBadge}
          ${imgHtml}
          <div class="album-card-overlay always-show">
            <div class="album-card-title">${escHtml(a.title)}</div>
            ${a.description ? `<div class="album-card-desc">${escHtml(a.description)}</div>` : ''}
            ${requestArea}
          </div>
        </div>`;
    }

    return `
      <div class="album-card" data-id="${a.id}" data-title="${escHtml(a.title)}" data-desc="${escHtml(a.description || '')}">
        ${a.is_public ? privacyBadge : ''}
        <span class="album-card-info">📷 ${date}</span>
        ${imgHtml}
        <div class="album-card-overlay">
          <div class="album-card-title">${escHtml(a.title)}</div>
          ${a.description ? `<div class="album-card-desc">${escHtml(a.description)}</div>` : ''}
          ${selCount > 0 ? `<div class="album-card-sel-badge">✅ ${selCount} đã chọn</div>` : ''}
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.album-card:not(.no-access)').forEach(card => {
    card.addEventListener('click', () =>
      openAlbum(card.dataset.id, card.dataset.title, card.dataset.desc)
    );
  });

  // Request access buttons
  grid.querySelectorAll('.album-request-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      btn.textContent = '⏳ Đang gửi...';
      try {
        const res = await fetch(`${API_BASE}/albums/${btn.dataset.id}/request-access`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + getToken() }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast('✅ ' + data.message);
        btn.closest('.album-card')?.querySelector('.album-card-overlay')
          ?.insertAdjacentHTML('beforeend', '<div class="album-request-pending">⏳ Đang chờ phê duyệt...</div>');
        btn.remove();
      } catch (err) {
        btn.disabled = false;
        btn.textContent = '🔑 Yêu cầu xem album';
        showToast('❌ ' + err.message);
      }
    });
  });
}

// ─── Open Album ───────────────────────────────────────────────────────────────
async function openAlbum(id, title, desc) {
  showScreen('album-screen');
  currentAlbumId = id;
  selFilter = 'all';
  selections = loadSelections(id);
  photoComments = loadComments(id);

  document.getElementById('album-title').textContent = title;
  document.getElementById('album-desc').textContent = desc || '';
  document.getElementById('album-date').textContent = '';

  const grid = document.getElementById('photos-grid');
  grid.innerHTML = '<div class="albums-loading"><div class="loading-bars"><span></span><span></span><span></span><span></span></div></div>';
  currentPhotos = [];

  // Reset filter tabs + search + sort
  document.querySelectorAll('.sel-tab').forEach(b => b.classList.toggle('active', b.dataset.filter === 'all'));
  selFilter = 'all';
  photoSearch = '';
  photoSort = 'default';
  const si = document.getElementById('photo-search');
  if (si) si.value = '';
  document.getElementById('photo-search-clear')?.classList.add('hidden');
  const ss = document.getElementById('photo-sort');
  if (ss) ss.value = 'default';

  try {
    const res = await fetch(`${API_BASE}/albums/${id}/photos`, {
      headers: { 'Authorization': 'Bearer ' + getToken() }
    });
    if (res.status === 401) return logout();
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    const { album, photos } = data;
    if (album && album.created_at) {
      document.getElementById('album-date').textContent = new Date(album.created_at)
        .toLocaleDateString('vi-VN', { year: 'numeric', month: 'long', day: 'numeric' });
    }
    currentPhotos = photos || [];
    renderPhotos(grid);
    updateSelCounter();
  } catch (err) {
    grid.innerHTML = `<p style="color:#6e6b64;padding:3rem;text-align:center;">Không thể tải ảnh: ${err.message}</p>`;
  }
}

// ─── Render Photos (with selection UI) ────────────────────────────────────────
function renderPhotos(grid, append = false) {
  const filtered = getFilteredPhotos();

  // Update count label
  const countEl = document.getElementById('photo-count-label');
  if (countEl) {
    countEl.textContent = photoSearch
      ? `${filtered.length} / ${currentPhotos.length} ảnh`
      : `${currentPhotos.length} ảnh`;
  }

  if (!currentPhotos.length) {
    grid.innerHTML = '<p style="color:#6e6b64;padding:3rem;text-align:center;">Album này chưa có ảnh nào.</p>';
    document.getElementById('load-more-wrap')?.classList.add('hidden');
    return;
  }
  if (!filtered.length) {
    grid.innerHTML = '<p style="color:#6e6b64;padding:3rem;text-align:center;">Không có ảnh nào ở bộ lọc này.</p>';
    document.getElementById('load-more-wrap')?.classList.add('hidden');
    return;
  }

  if (!append) {
    renderLimit = 50;
    grid.innerHTML = '';
  }

  const startIndex = append ? renderLimit - 50 : 0;
  const itemsToRender = filtered.slice(startIndex, renderLimit);

  itemsToRender.forEach((p, i) => {
    const realIndex = currentPhotos.indexOf(p);
    const state = getPhotoState(p.id);
    const shortName = (p.name || '').replace(/\.[^.]+$/, '');
    const stateLabelMap = { selected: '✅ Đã chọn', later: '⏳ Chọn sau', none: '—' };
    const card = document.createElement('div');
    card.className = 'photo-item';
    card.dataset.id = p.id;
    card.dataset.index = realIndex;
    card.innerHTML = `
      <img src="${escHtml(p.thumbnail || p.url)}" alt="${escHtml(p.name || '')}" loading="lazy"
           onerror="this.src='${escHtml(p.url)}'" />
      <span class="list-photo-name" title="${escHtml(p.name || '')}">${escHtml(p.name || shortName)}</span>
      <span class="list-photo-time">${
        p.createdTime
          ? new Date(p.createdTime).toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })
          + (p.size ? ' · ' + (p.size >= 1048576 ? (p.size/1048576).toFixed(1)+' MB' : Math.round(p.size/1024)+' KB') : '')
          : '—'
      }</span>
      <span class="list-state-badge state-${state}">${stateLabelMap[state] || '—'}</span>
      <div class="photo-top-bar">
        <div class="photo-top-bar-info">
          <span class="photo-filename" title="${escHtml(p.name || '')}">${escHtml(shortName)}</span>
          ${p.createdTime ? `<span class="photo-upload-time">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="10" height="10"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            ${new Date(p.createdTime).toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}
            ${p.size ? '&middot; ' + (p.size >= 1048576 ? (p.size/1048576).toFixed(1) + ' MB' : Math.round(p.size/1024) + ' KB') : ''}
          </span>` : ''}
        </div>
        <button class="photo-copy-btn" data-url="${escHtml(p.url)}" title="Copy link ảnh">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
      <div class="photo-actions">
        <button class="photo-expand-btn" data-index="${realIndex}" title="Xem to">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>
        </button>
        <button class="pa-comment ${getPhotoComment(p.id) ? 'has-comment' : ''}" data-id="${p.id}" data-index="${realIndex}" title="Ghi chú / Yêu cầu chỉnh sửa">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          Ghi chú
        </button>
        <button class="pa-later ${state === 'later' ? 'active' : ''}" data-id="${p.id}" title="Chọn sau">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Chọn sau
        </button>
        <button class="pa-select ${state === 'selected' ? 'active' : ''}" data-id="${p.id}" title="Chọn ảnh này">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
          Chọn
        </button>
      </div>`;
    applyCardState(card, state);
    grid.appendChild(card);

    // Events (only bound to to the newly created card)
    card.querySelector('img')?.addEventListener('click', () => {
      openLightbox(parseInt(card.dataset.index));
    });
    card.querySelector('.photo-expand-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(parseInt(card.dataset.index));
    });
    // Copy link
    card.querySelector('.photo-copy-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      const url = e.currentTarget.dataset.url;
      navigator.clipboard?.writeText(url).then(() => showToast('Đã copy link ảnh!')).catch(() => {});
    });
    // Ghi chú
    card.querySelector('.pa-comment')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openCommentModal(card.dataset.id, parseInt(card.dataset.index));
    });
    // Chọn sau
    card.querySelector('.pa-later')?.addEventListener('click', (e) => {
      e.stopPropagation();
      setPhotoState(card.dataset.id, 'later');
      if (selFilter !== 'all') renderPhotos(grid);
    });
    // Chọn
    card.querySelector('.pa-select')?.addEventListener('click', (e) => {
      e.stopPropagation();
      setPhotoState(card.dataset.id, 'selected');
      if (selFilter !== 'all') renderPhotos(grid);
    });
    // Restore comment badge
    if (getPhotoComment(card.dataset.id)) updateCommentBadge(card, getPhotoComment(card.dataset.id));
  });

  // Toggle "Load More" button visibility
  const loadMoreWrap = document.getElementById('load-more-wrap');
  if (loadMoreWrap) {
    if (renderLimit < filtered.length) {
      loadMoreWrap.classList.remove('hidden');
      const loadBtn = document.getElementById('btn-load-more');
      if (loadBtn) {
        const remaining = filtered.length - renderLimit;
        loadBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg> Xem thêm ảnh (${remaining} ảnh nữa)`;
      }
    } else {
      loadMoreWrap.classList.add('hidden');
    }
  }
}

// ─── Comment Modal ────────────────────────────────────────────────────────────
let commentPhotoId = null;
function openCommentModal(photoId, realIndex) {
  commentPhotoId = photoId;
  const photo = currentPhotos[realIndex];
  document.getElementById('comment-thumb').src = photo?.thumbnail || photo?.url || '';
  document.getElementById('comment-photo-name').textContent = photo?.name || '';
  const s = getPhotoState(photoId);
  document.getElementById('comment-photo-state').textContent =
    s === 'selected' ? '✅ Đã chọn' : s === 'later' ? '⏳ Chọn sau' : '— Chưa chọn';
  document.getElementById('comment-input').value = getPhotoComment(photoId);
  document.getElementById('comment-modal')?.classList.add('open');
  setTimeout(() => document.getElementById('comment-input')?.focus(), 100);
}
function closeCommentModal() {
  document.getElementById('comment-modal')?.classList.remove('open');
  commentPhotoId = null;
}
async function saveCommentAndClose() {
  if (!commentPhotoId) return;
  const text = document.getElementById('comment-input')?.value || '';
  setPhotoComment(commentPhotoId, text);
  const card = document.querySelector(`.photo-item[data-id="${commentPhotoId}"]`);
  card?.querySelector('.pa-comment')?.classList.toggle('has-comment', !!text.trim());

  // Send to server if comment is non-empty
  if (text.trim() && currentAlbumId) {
    const photo = currentPhotos.find(p => p.id === commentPhotoId);
    try {
      await fetch(`${API_BASE}/albums/${currentAlbumId}/comment`, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ photo_id: commentPhotoId, photo_name: photo?.name || '', comment: text.trim() })
      });
    } catch {} // fail silently — local save already done
  }

  if (!document.getElementById('lightbox').classList.contains('hidden')) {
    showLbImage(lbIndex);
  }

  closeCommentModal();
  showToast(text.trim() ? '💬 Đã lưu ghi chú!' : 'Đã xóa ghi chú');
}

function applyCardState(card, state) {
  card.classList.remove('state-selected', 'state-later', 'state-none');
  if (state === 'selected') card.classList.add('state-selected');
  else if (state === 'later') card.classList.add('state-later');
  // Update buttons
  const btnLater  = card.querySelector('.pa-later');
  const btnSelect = card.querySelector('.pa-select');
  if (btnLater)  btnLater.classList.toggle('active', state === 'later');
  if (btnSelect) btnSelect.classList.toggle('active', state === 'selected');
}

// ─── Toast (simple) ───────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'client-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2200);
}

// ─── Lightbox ────────────────────────────────────────────────────────────────
function openLightbox(index) {
  lbIndex = index;
  document.getElementById('lightbox').classList.remove('hidden');
  document.getElementById('lb-backdrop').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  showLbImage(lbIndex);
}
function closeLightbox() {
  document.getElementById('lightbox').classList.add('hidden');
  document.getElementById('lb-backdrop').classList.add('hidden');
  document.body.style.overflow = '';
}
function showLbImage(idx) {
  const photo = currentPhotos[idx];
  if (!photo) return;
  const img = document.getElementById('lb-img');
  const loader = document.querySelector('.lb-loader');
  img.style.opacity = '0';
  if (loader) loader.style.display = 'flex';
  img.src = photo.url;
  img.onload = () => {
    if (loader) loader.style.display = 'none';
    img.style.opacity = '1';
    img.style.transition = 'opacity .3s';
  };
  
  // Sync Toolbar
  document.getElementById('lb-counter').textContent = `${idx + 1} / ${currentPhotos.length}`;
  
  const state = getPhotoState(photo.id);
  const btnSelect = document.getElementById('lb-btn-select');
  const btnLater = document.getElementById('lb-btn-later');
  const btnComment = document.getElementById('lb-btn-comment');
  
  if (btnSelect) btnSelect.classList.toggle('active', state === 'selected');
  if (btnLater) btnLater.classList.toggle('active', state === 'later');
  if (btnComment) btnComment.classList.toggle('has-comment', !!getPhotoComment(photo.id));
}

// ─── Submit selections ────────────────────────────────────────────────────────
async function submitSelections() {
  const selected = getSelectedPhotos();
  if (!selected.length) return;
  const confirmEl = document.getElementById('submit-confirm-overlay');
  const countEl = document.getElementById('submit-count');
  if (countEl) countEl.textContent = selected.length;
  if (confirmEl) confirmEl.classList.add('open');
}
async function doSubmit() {
  const selected = getSelectedPhotos();
  const overlay = document.getElementById('submit-confirm-overlay');
  if (overlay) overlay.classList.remove('open');
  const btn = document.getElementById('btn-submit-sel');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Đang gửi...'; }
  try {
    const res = await fetch(`${API_BASE}/albums/${currentAlbumId}/submit`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        selected_photos: selected.map(p => ({
          id: p.id, name: p.name,
          comment: getPhotoComment(p.id) || ''
        })),
        later_photos: currentPhotos
          .filter(p => selections[p.id] === 'later')
          .map(p => ({ id: p.id, name: p.name, comment: getPhotoComment(p.id) || '' }))
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    showToast(`✅ Đã gửi ${data.count} ảnh cho hậu kỳ!`);
    // Show success state
    const successOverlay = document.getElementById('submit-success-overlay');
    if (successOverlay) {
      document.getElementById('success-count').textContent = data.count;
      successOverlay.classList.add('open');
    }
  } catch (err) {
    showToast('❌ Lỗi: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Gửi hậu kỳ'; updateSelCounter(); }
  }
}

// ─── Logout ───────────────────────────────────────────────────────────────────
function logout() {
  clearSession();
  history.replaceState(null, '', '/client');
  showScreen('login-screen');
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Download Photos (original quality from Drive) ────────────────────────────
async function downloadPhotos(photos, label) {
  if (!photos.length || !currentAlbumId) return;
  const total = photos.length;
  const token = getToken();

  // ── Progress toast ──────────────────────────────────────────
  const toast = document.createElement('div');
  toast.className = 'dl-progress-wrap';
  toast.innerHTML = `
    <div class="dl-progress-title">⬇️ Đang tải: ${label}</div>
    <div class="dl-progress-bar-wrap"><div class="dl-progress-bar" id="dl-bar" style="width:0%"></div></div>
    <div class="dl-progress-sub" id="dl-sub">Đang chuẩn bị...</div>
  `;
  document.body.appendChild(toast);
  const bar = toast.querySelector('#dl-bar');
  const sub = toast.querySelector('#dl-sub');

  // ── Helper: hiện nút download và chờ user click ─────────────
  function showDownloadButton(blobUrl, fileName, countLabel) {
    if (bar) bar.style.width = '100%';
    toast.innerHTML = `
      <div class="dl-progress-title">✅ Sẵn sàng — ${countLabel}</div>
      <a href="${blobUrl}" download="${fileName}" id="zip-dl-btn"
         style="display:block;margin-top:10px;padding:10px 16px;background:rgba(255,255,255,0.15);color:#fff;border:1px solid rgba(255,255,255,0.3);border-radius:8px;text-decoration:none;font-weight:600;text-align:center;font-size:13px;cursor:pointer;transition:background .2s"
         onmouseover="this.style.background='rgba(255,255,255,0.25)'"
         onmouseout="this.style.background='rgba(255,255,255,0.15)'"
         onclick="setTimeout(()=>{ document.querySelector('.dl-progress-wrap')?.remove(); URL.revokeObjectURL('${blobUrl}') }, 2000)">
        📥 Nhấn đây để tải xuống
      </a>
      <div style="font-size:11px;opacity:.6;margin-top:6px;text-align:center">Link tự hết hạn sau 60 giây</div>
    `;
    setTimeout(() => { toast.remove(); URL.revokeObjectURL(blobUrl); }, 60000);
  }

  // ── TRƯỜNG HỢP 1 ẢNH: tải thẳng, không nén ZIP ─────────────
  if (total === 1) {
    const photo = photos[0];
    let fileName = photo.name || (photo.id + '.jpg');
    if (!/\.(jpg|jpeg|png|gif|webp|heic|tif|tiff)$/i.test(fileName)) fileName += '.jpg';
    if (sub) sub.textContent = `Đang tải: ${fileName}`;

    try {
      const proxyUrl = `/api/client/albums/${currentAlbumId}/download-file` +
        `?fileId=${encodeURIComponent(photo.id)}` +
        `&fileName=${encodeURIComponent(fileName)}` +
        `&token=${encodeURIComponent(token)}`;
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      if (blob.size < 1000) throw new Error('File không hợp lệ');
      if (bar) bar.style.width = '100%';
      showDownloadButton(URL.createObjectURL(blob), fileName, fileName);
    } catch (e) {
      if (sub) sub.textContent = `❌ Lỗi: ${e.message}`;
      setTimeout(() => toast.remove(), 4000);
    }
    return;
  }

  // ── NHIỀU ẢNH: nén thành ZIP ────────────────────────────────
  const zip = new JSZip();
  let successCount = 0;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];
    let fileName = photo.name || (photo.id + '.jpg');
    if (!/\.(jpg|jpeg|png|gif|webp|heic|tif|tiff)$/i.test(fileName)) fileName += '.jpg';

    if (sub) sub.textContent = `Đang tải (${i + 1}/${total}): ${fileName}`;

    try {
      const proxyUrl = `/api/client/albums/${currentAlbumId}/download-file` +
        `?fileId=${encodeURIComponent(photo.id)}` +
        `&fileName=${encodeURIComponent(fileName)}` +
        `&token=${encodeURIComponent(token)}`;

      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength < 1000) throw new Error('File quá nhỏ');
      zip.file(fileName, arrayBuffer, { compression: 'STORE' });
      successCount++;
    } catch (e) {
      console.warn(`[Download] Failed: ${fileName}`, e.message);
    }

    if (bar) bar.style.width = `${Math.round(((i + 1) / total) * 80)}%`;
  }

  if (successCount === 0) {
    if (sub) sub.textContent = '❌ Không thể tải ảnh nào.';
    setTimeout(() => toast.remove(), 4000);
    return;
  }

  if (sub) sub.textContent = `Đang đóng gói ${successCount} ảnh...`;
  if (bar) bar.style.width = '85%';

  const zipBlob = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' },
    (meta) => { if (bar) bar.style.width = `${85 + Math.round(meta.percent * 0.15)}%`; }
  );

  showDownloadButton(URL.createObjectURL(zipBlob), 'album_photos_' + Date.now() + '.zip', `${successCount}/${total} ảnh`);
}



// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // ── 1. Error from redirect ─────────────────────────────────
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('error')) {
    hideLoader(); showScreen('login-screen');
    const note = document.querySelector('.login-note');
    if (note) { note.textContent = '⚠️ Đăng nhập thất bại. Vui lòng thử lại.'; note.style.color = '#e55'; }
    history.replaceState(null, '', '/client');
    return;
  }

  // ── 2. Token from URL hash ─────────────────────────────────
  const hash = window.location.hash;
  if (hash.includes('token=')) {
    const hashParams = new URLSearchParams(hash.slice(1));
    const token = hashParams.get('token');
    if (token) {
      const decoded = decodeJWT(token);
      if (decoded && decoded.email) {
        setSession(token, { email: decoded.email, name: decoded.name, picture: decoded.picture });
        history.replaceState(null, '', '/client');
        hideLoader();
        enterDashboard({ email: decoded.email, name: decoded.name, picture: decoded.picture });
        return;
      }
    }
  }

  // ── 3. Existing session ────────────────────────────────────
  const token = getToken();
  let user = getUser();
  if (token && user) {
    // Re-decode token to fix any mangled Unicode from previous localStorage saves
    const decoded = decodeJWT(token);
    if (decoded && decoded.name) {
      user.name = decoded.name;
      localStorage.setItem('client_user', JSON.stringify(user));
    }

    fetch(`${API_BASE}/me`, { headers: { 'Authorization': 'Bearer ' + token } })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(serverUser => { 
        hideLoader(); 
        // Use server user data (more reliable) but sync to local storage
        localStorage.setItem('client_user', JSON.stringify(serverUser));
        enterDashboard(serverUser); 
      })
      .catch(() => { clearSession(); hideLoader(); showScreen('login-screen'); });
  } else {
    hideLoader(); showScreen('login-screen');
  }

  // ── Login button ───────────────────────────────────────────
  document.getElementById('btn-google-login')?.addEventListener('click', () => {
    window.location.href = '/api/client/auth/google';
  });

  // ── Logout ─────────────────────────────────────────────────
  ['btn-logout', 'btn-logout-2'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', logout);
  });

  // ── Back to albums ─────────────────────────────────────────
  document.getElementById('btn-back-albums')?.addEventListener('click', () => {
    showScreen('dashboard-screen');
    currentPhotos = []; currentAlbumId = null; selections = {};
    loadAlbums(); // refresh album cards to show updated sel counts
  });

  // ── Selection filter tabs ──────────────────────────────────
  document.getElementById('sel-filters')?.addEventListener('click', e => {
    const btn = e.target.closest('.sel-tab');
    if (!btn) return;
    selFilter = btn.dataset.filter;
    document.querySelectorAll('.sel-tab').forEach(b => b.classList.toggle('active', b === btn));
    renderPhotos(document.getElementById('photos-grid'));
    updateTabCounts();
  });

  // ── Submit selections ──────────────────────────────────────
  document.getElementById('btn-submit-sel')?.addEventListener('click', submitSelections);
  document.getElementById('confirm-submit-btn')?.addEventListener('click', doSubmit);
  document.getElementById('cancel-submit-btn')?.addEventListener('click', () => {
    document.getElementById('submit-confirm-overlay')?.classList.remove('open');
  });
  document.getElementById('close-success-btn')?.addEventListener('click', () => {
    document.getElementById('submit-success-overlay')?.classList.remove('open');
  });

  // ── View Toggle (Grid / List) ───────────────────────────────
  let currentView = 'grid';
  document.getElementById('btn-view-grid')?.addEventListener('click', () => {
    currentView = 'grid';
    document.getElementById('photos-grid')?.classList.remove('view-list');
    document.getElementById('btn-view-grid')?.classList.add('active');
    document.getElementById('btn-view-list')?.classList.remove('active');
  });
  document.getElementById('btn-view-list')?.addEventListener('click', () => {
    currentView = 'list';
    document.getElementById('photos-grid')?.classList.add('view-list');
    document.getElementById('btn-view-list')?.classList.add('active');
    document.getElementById('btn-view-grid')?.classList.remove('active');
  });

  // ── Search + Sort ──────────────────────────────────────────
  const searchInput = document.getElementById('photo-search');
  const searchClear = document.getElementById('photo-search-clear');
  const sortSelect  = document.getElementById('photo-sort');
  let searchTimeout;

  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      photoSearch = searchInput.value;
      searchClear?.classList.toggle('hidden', !photoSearch);
      renderPhotos(document.getElementById('photos-grid'));
    }, 200);
  });

  searchClear?.addEventListener('click', () => {
    searchInput.value = '';
    photoSearch = '';
    searchClear.classList.add('hidden');
    searchInput.focus();
    renderPhotos(document.getElementById('photos-grid'));
  });

  sortSelect?.addEventListener('change', () => {
    photoSort = sortSelect.value;
    renderPhotos(document.getElementById('photos-grid'));
  });

  // ── Load More ──────────────────────────────────────────────
  document.getElementById('btn-load-more')?.addEventListener('click', () => {
    renderLimit += 50;
    renderPhotos(document.getElementById('photos-grid'), true);
  });


  // ── Download Dropdown ──────────────────────────────────────
  const dlWrap = document.getElementById('dl-wrap');
  const dlMenu = document.getElementById('dl-menu');
  document.getElementById('btn-download')?.addEventListener('click', e => {
    e.stopPropagation();
    dlMenu?.classList.toggle('hidden');
    // Update counts
    const selCount = Object.values(selections).filter(s => s === 'selected').length;
    document.getElementById('dl-selected-count').textContent = `(${selCount})`;
    document.getElementById('dl-all-count').textContent = `(${currentPhotos.length})`;
  });
  document.addEventListener('click', e => {
    if (!dlWrap?.contains(e.target)) dlMenu?.classList.add('hidden');
  });

  document.getElementById('btn-dl-selected')?.addEventListener('click', () => {
    dlMenu?.classList.add('hidden');
    const selectedPhotos = currentPhotos.filter(p => getPhotoState(p.id) === 'selected');
    if (!selectedPhotos.length) { showToast('Chưa có ảnh nào được chọn!'); return; }
    downloadPhotos(selectedPhotos, 'Ảnh đã chọn');
  });
  document.getElementById('btn-dl-all')?.addEventListener('click', () => {
    dlMenu?.classList.add('hidden');
    if (!currentPhotos.length) { showToast('Album chưa có ảnh!'); return; }
    downloadPhotos(currentPhotos, 'Toàn bộ album');
  });

  document.getElementById('comment-save-btn')?.addEventListener('click', saveCommentAndClose);
  document.getElementById('comment-close-btn')?.addEventListener('click', closeCommentModal);
  document.getElementById('comment-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('comment-modal')) closeCommentModal();
  });
  document.getElementById('comment-input')?.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCommentModal();
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') saveCommentAndClose();
  });

  // ── Lightbox ───────────────────────────────────────────────
  document.getElementById('lb-close')?.addEventListener('click', closeLightbox);
  document.getElementById('lb-backdrop')?.addEventListener('click', closeLightbox);
  document.getElementById('lb-prev')?.addEventListener('click', () => {
    lbIndex = (lbIndex - 1 + currentPhotos.length) % currentPhotos.length;
    showLbImage(lbIndex);
  });
  document.getElementById('lb-next')?.addEventListener('click', () => {
    lbIndex = (lbIndex + 1) % currentPhotos.length;
    showLbImage(lbIndex);
  });
  
  document.getElementById('lb-btn-select')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const photo = currentPhotos[lbIndex];
    if (photo) { setPhotoState(photo.id, 'selected'); showLbImage(lbIndex); }
  });
  document.getElementById('lb-btn-later')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const photo = currentPhotos[lbIndex];
    if (photo) { setPhotoState(photo.id, 'later'); showLbImage(lbIndex); }
  });
  document.getElementById('lb-btn-comment')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const photo = currentPhotos[lbIndex];
    if (photo) openCommentModal(photo.id, lbIndex);
  });

  // ── Keyboard ───────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (!document.getElementById('lightbox').classList.contains('hidden')) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') { lbIndex = (lbIndex - 1 + currentPhotos.length) % currentPhotos.length; showLbImage(lbIndex); }
      if (e.key === 'ArrowRight') { lbIndex = (lbIndex + 1) % currentPhotos.length; showLbImage(lbIndex); }
    }
  });
});
