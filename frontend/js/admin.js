/* ─── Admin Panel JavaScript (Photographer) ──────────────────────────────────
   Auth, Photos CRUD, About (photographer fields), Services CRUD
   ─────────────────────────────────────────────────────────────────────────── */

const API = '/api/admin';
const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];
const getToken = () => localStorage.getItem('admin_token');
const setToken = t => localStorage.setItem('admin_token', t);
const clearToken = () => localStorage.removeItem('admin_token');
const getUser = () => localStorage.getItem('admin_user') || 'admin';
const setUser = u => localStorage.setItem('admin_user', u);

// ─── API helper ───────────────────────────────────────────────────────────────
async function apiRequest(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── Image Compression Utility ────────────────────────────────────────────────
async function compressImage(file, maxWidth = 1920, quality = 0.8) {
  if (!file.type.startsWith('image/')) return file;
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file; // Do not compress gifs or SVGs
  
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = e => {
      const img = new Image();
      img.src = e.target.result;
      img.onload = () => {
        let width = img.width, height = img.height;
        if (width > maxWidth) {
          height = Math.round(height * maxWidth / width);
          width = maxWidth;
        }
        const cvs = document.createElement('canvas');
        cvs.width = width; cvs.height = height;
        cvs.getContext('2d').drawImage(img, 0, 0, width, height);
        cvs.toBlob(blob => {
          if (!blob) return resolve(file);
          const newName = file.name.replace(/\.[^/.]+$/, "") + ".webp";
          resolve(new File([blob], newName, { type: 'image/webp', lastModified: Date.now() }));
        }, 'image/webp', quality);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
}

async function uploadImage(file, progressEl) {
  const finalFile = await compressImage(file);
  const formData = new FormData();
  formData.append('image', finalFile);
  const headers = { 'Authorization': `Bearer ${getToken()}` };
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API}/upload`);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && progressEl) progressEl.style.width = `${(e.loaded / e.total) * 100}%`;
    };
    xhr.onload = () => {
      const data = JSON.parse(xhr.responseText);
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || 'Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(formData);
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type]}</span><span>${msg}</span>`;
  $('#toast-container').appendChild(el);
  setTimeout(() => { el.classList.add('removing'); setTimeout(() => el.remove(), 350); }, 3500);
}

// ─── Confirm ──────────────────────────────────────────────────────────────────
function showConfirm(msg) {
  return new Promise(resolve => {
    const overlay = $('#confirm-modal-overlay');
    $('#confirm-modal-msg').textContent = msg;
    overlay.classList.add('open');
    const close = result => {
      overlay.classList.remove('open');
      $('#confirm-delete-btn').removeEventListener('click', onY);
      $('#confirm-cancel-btn').removeEventListener('click', onN);
      $('#confirm-modal-close').removeEventListener('click', onN);
      resolve(result);
    };
    const onY = () => close(true);
    const onN = () => close(false);
    $('#confirm-delete-btn').addEventListener('click', onY);
    $('#confirm-cancel-btn').addEventListener('click', onN);
    $('#confirm-modal-close').addEventListener('click', onN);
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────
const TAB_TITLES = {
  dashboard: 'Dashboard', hero: 'Hình nền', photos: 'Quản lý ảnh', about: 'Thông tin cá nhân',
  services: 'Dịch vụ', 'client-albums': 'Client Albums', settings: 'Đổi mật khẩu'
};
function switchTab(tab) {
  $$('.nav-item').forEach(n => n.classList.remove('active'));
  $(`#nav-${tab}`)?.classList.add('active');
  $$('.tab-panel').forEach(p => p.classList.remove('active'));
  $(`#tab-${tab}`)?.classList.add('active');
  const t = $('#topbar-title'); if (t) t.textContent = TAB_TITLES[tab] || tab;
  if (tab === 'hero') loadHeroImages();
  if (tab === 'photos') loadPhotos();
  if (tab === 'about') loadAbout();
  if (tab === 'services') loadServices();
  if (tab === 'dashboard') loadDashboard();
  if (tab === 'client-albums') loadClientAlbums();
}
function initNav() {
  $$('.nav-item[data-tab]').forEach(el => {
    el.addEventListener('click', () => {
      switchTab(el.dataset.tab);
      if (window.innerWidth < 768) $('#sidebar')?.classList.remove('open');
    });
  });
  $('#menu-toggle')?.addEventListener('click', () => $('#sidebar')?.classList.toggle('open'));
  document.addEventListener('click', e => {
    const sb = $('#sidebar'), btn = $('#menu-toggle');
    if (window.innerWidth < 768 && sb?.classList.contains('open') && !sb.contains(e.target) && !btn?.contains(e.target))
      sb.classList.remove('open');
  });
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function checkAuth() {
  if (!getToken()) return false;
  try { await apiRequest('GET', '/verify'); return true; } catch { clearToken(); return false; }
}
function showLoginPage() { $('#login-page').style.display = 'flex'; $('#admin-app').classList.remove('visible'); }
function showAdminApp() {
  $('#login-page').style.display = 'none'; $('#admin-app').classList.add('visible');
  const user = getUser();
  $$('#sidebar-username, #footer-username').forEach(el => { if (el) el.textContent = user; });
  const av = $('#user-avatar-initials'); if (av) av.textContent = user.charAt(0).toUpperCase();
}
function initLogin() {
  const form = $('#login-form'), errorEl = $('#login-error'), btn = $('#btn-login');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    errorEl.style.display = 'none'; btn.disabled = true; btn.textContent = 'Đang đăng nhập...';
    try {
      const data = await fetch('/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: $('#username').value.trim(), password: $('#password').value })
      }).then(r => r.json());
      if (data.token) {
        setToken(data.token); setUser(data.username);
        showAdminApp(); initNav(); loadDashboard(); switchTab('dashboard');
      } else throw new Error(data.error || 'Đăng nhập thất bại');
    } catch (err) { errorEl.textContent = err.message; errorEl.style.display = 'block'; }
    finally { btn.disabled = false; btn.textContent = 'Đăng nhập'; }
  });
  $('#btn-logout')?.addEventListener('click', () => { clearToken(); showLoginPage(); });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [photos, services] = await Promise.all([apiRequest('GET', '/photos'), apiRequest('GET', '/services')]);
    $('#stat-total').textContent = photos.length;
    $('#stat-visible').textContent = photos.filter(p => p.visible).length;
    $('#stat-featured').textContent = photos.filter(p => p.featured).length;
    $('#stat-services').textContent = services.length;
    $('#photos-count').textContent = photos.length;
    $('#services-count').textContent = services.length;

    // Category breakdown
    const breakdown = $('#cat-breakdown');
    if (breakdown) {
      const catIcons = { Wedding: '💍', Portrait: '🎭', Event: '🎊', Product: '📦' };
      const cats = {};
      photos.forEach(p => { cats[p.category] = (cats[p.category] || 0) + 1; });
      breakdown.innerHTML = '<div class="cat-badge-wrap">' +
        Object.entries(cats).map(([cat, count]) =>
          `<div class="cat-badge"><span class="cat-badge-icon">${catIcons[cat]||'📷'}</span><span class="cat-badge-name">${cat}</span><span class="cat-badge-count">${count}</span></div>`
        ).join('') + '</div>';
    }
  } catch (err) { console.warn(err); }
}

// ─── PHOTOS ───────────────────────────────────────────────────────────────────
let photosList = [];
let photosFilter = 'All';

async function loadPhotos() {
  const grid = $('#admin-photo-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    photosList = await apiRequest('GET', '/photos');
    renderPhotosGrid();
    $('#photos-count').textContent = photosList.length;
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--accent-danger);padding:2rem">${err.message}</p>`;
  }
}

function renderPhotosGrid() {
  const grid = $('#admin-photo-grid');
  if (!grid) return;
  const filtered = photosFilter === 'All' ? photosList : photosList.filter(p => p.category === photosFilter);
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="empty-state-icon">📷</div><h3>Không có ảnh</h3><p>Nhấn "Thêm ảnh" để bắt đầu</p></div>`;
    return;
  }
  const catIcons = { Wedding: '💍', Portrait: '🎭', Event: '🎊', Product: '📦' };
  grid.innerHTML = '';
  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'admin-photo-card';
    card.innerHTML = `
      <div class="admin-photo-thumb">
        ${p.image_url ? `<img src="${p.image_url}" alt="${p.title}" loading="lazy" />` : `<div class="admin-photo-thumb-placeholder">📷</div>`}
        <span class="badge-cat">${catIcons[p.category]||'📷'} ${p.category}</span>
        <div class="admin-photo-overlay">
          <button class="btn btn-secondary btn-sm btn-icon edit-photo-btn" data-id="${p.id}" title="Sửa">✏️</button>
          <button class="btn btn-danger btn-sm btn-icon del-photo-btn" data-id="${p.id}" title="Xóa">🗑️</button>
        </div>
      </div>
      <div class="admin-photo-info">
        <div class="admin-photo-title">${p.title}</div>
        <div class="admin-photo-actions">
          <label class="toggle-switch" title="${p.visible?'Ẩn':'Hiện'}">
            <input type="checkbox" ${p.visible?'checked':''} class="toggle-visible" data-id="${p.id}" />
            <span class="toggle-track"></span>
          </label>
          <span style="font-size:.75rem;color:var(--text-muted);margin-left:.3rem">${p.visible?'Hiện':'Ẩn'}</span>
          ${p.featured ? '<span class="badge badge-featured" style="margin-left:auto">⭐</span>' : ''}
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
  // Events
  $$('.toggle-visible', grid).forEach(t => {
    t.addEventListener('change', async () => {
      try {
        await apiRequest('PATCH', `/photos/${t.dataset.id}/toggle`);
        await loadPhotos(); await loadDashboard();
        showToast('Đã cập nhật trạng thái', 'success');
      } catch (err) { showToast(err.message, 'error'); t.checked = !t.checked; }
    });
  });
  $$('.edit-photo-btn', grid).forEach(btn => {
    btn.addEventListener('click', () => {
      const p = photosList.find(x => x.id == btn.dataset.id);
      if (p) openPhotoModal(p);
    });
  });
  $$('.del-photo-btn', grid).forEach(btn => {
    btn.addEventListener('click', async () => {
      const p = photosList.find(x => x.id == btn.dataset.id);
      if (!await showConfirm(`Xóa ảnh "${p?.title}"?`)) return;
      try {
        await apiRequest('DELETE', `/photos/${btn.dataset.id}`);
        await loadPhotos(); await loadDashboard();
        showToast('Đã xóa!', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
}

// Photo Modal
let currentDetailImages = [];

function openPhotoModal(photo = null) {
  $('#photo-modal-heading').textContent = photo ? 'Chỉnh sửa ảnh' : 'Thêm ảnh mới';
  $('#photo-edit-id').value = photo?.id || '';
  $('#p-title').value = photo?.title || '';
  $('#p-desc').value = photo?.description || '';
  $('#p-category').value = photo?.category || 'Wedding';
  $('#p-order').value = photo?.order_index || 0;
  $('#p-location').value = photo?.location || '';
  $('#p-date').value = photo?.shoot_date || '';
  const tags = Array.isArray(photo?.tags) ? photo.tags : [];
  $('#p-tags').value = tags.join(', ');
  $('#p-visible').checked = photo ? !!photo.visible : true;
  $('#p-featured').checked = !!photo?.featured;
  $('#p-image-url').value = photo?.image_url || '';
  $('#p-image-url-input').value = photo?.image_url || '';
  clearPhotoPreview();
  if (photo?.image_url) showPhotoPreview(photo.image_url);
  $('#photo-upload-progress').style.width = '0%';
  
  // Detail images
  currentDetailImages = Array.isArray(photo?.detail_images) ? [...photo.detail_images] : [];
  renderDetailImagesPreview();
  $('#detail-upload-progress').style.width = '0%';

  $('#photo-modal-overlay').classList.add('open');
}
function closePhotoModal() { $('#photo-modal-overlay')?.classList.remove('open'); }

function showPhotoPreview(url) {
  $('#photo-preview').classList.add('visible');
  $('#photo-preview-img').src = url;
}
function clearPhotoPreview() {
  $('#photo-preview').classList.remove('visible');
  $('#photo-preview-img').src = '';
}

function renderDetailImagesPreview() {
  const container = $('#detail-preview-container');
  if (!container) return;
  container.innerHTML = '';
  currentDetailImages.forEach((url, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'detail-thumb';
    thumb.innerHTML = `
      <img src="${url}" alt="Detail ${i}" />
      <button type="button" class="detail-thumb-remove" data-idx="${i}">✕</button>
    `;
    container.appendChild(thumb);
  });
  $$('.detail-thumb-remove', container).forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      currentDetailImages.splice(idx, 1);
      renderDetailImagesPreview();
    });
  });
}

function initPhotoModal() {
  $('#btn-add-photo')?.addEventListener('click', () => openPhotoModal(null));
  $('#photo-modal-close')?.addEventListener('click', closePhotoModal);
  $('#photo-cancel-btn')?.addEventListener('click', closePhotoModal);
  $('#photo-modal-overlay')?.addEventListener('click', e => { if (e.target === $('#photo-modal-overlay')) closePhotoModal(); });

  $('#p-image-url-input')?.addEventListener('input', e => {
    const url = e.target.value.trim();
    $('#p-image-url').value = url;
    url ? showPhotoPreview(url) : clearPhotoPreview();
  });

  const fileInput = $('#photo-file');
  const zone = $('#photo-upload-zone');
  fileInput?.addEventListener('change', async () => { if (fileInput.files[0]) await doPhotoUpload(fileInput.files[0]); });
  zone?.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone?.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone?.addEventListener('drop', async e => {
    e.preventDefault(); zone.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith('image/')) await doPhotoUpload(f);
  });
  $('#photo-preview-remove')?.addEventListener('click', () => {
    clearPhotoPreview(); $('#p-image-url').value = ''; $('#p-image-url-input').value = '';
    if (fileInput) fileInput.value = '';
  });

  // Detail Images Logic
  const detailInput = $('#detail-files');
  const detailZone = $('#detail-upload-zone');
  
  const handleDetailUploads = async (files) => {
    const prog = $('#detail-upload-progress');
    prog.style.width = '50%';
    try {
      showToast(`Đang tải lên ${files.length} ảnh...`, 'info');
      const uploads = Array.from(files).filter(f => f.type.startsWith('image/')).map(f => uploadImage(f, null));
      const results = await Promise.all(uploads);
      results.forEach(res => {
        if (res && res.url) currentDetailImages.push(res.url);
      });
      renderDetailImagesPreview();
      prog.style.width = '100%';
      setTimeout(() => prog.style.width = '0', 500);
      showToast('Tải lên ảnh chi tiết thành công!', 'success');
      if (detailInput) detailInput.value = '';
    } catch (err) {
      prog.style.width = '0';
      showToast(`Lỗi khi tải ảnh chi tiết: ${err.message}`, 'error');
    }
  };

  detailInput?.addEventListener('change', () => {
    if (detailInput.files && detailInput.files.length) handleDetailUploads(detailInput.files);
  });
  detailZone?.addEventListener('dragover', e => { e.preventDefault(); detailZone.classList.add('dragover'); });
  detailZone?.addEventListener('dragleave', () => detailZone.classList.remove('dragover'));
  detailZone?.addEventListener('drop', e => {
    e.preventDefault(); detailZone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length) handleDetailUploads(e.dataTransfer.files);
  });

  $('#photo-save-btn')?.addEventListener('click', async () => {
    const title = $('#p-title').value.trim();
    if (!title) { showToast('Vui lòng nhập tiêu đề!', 'error'); return; }
    const imageUrl = $('#p-image-url').value || $('#p-image-url-input').value.trim();
    const tagsRaw = $('#p-tags').value;
    const body = {
      title, description: $('#p-desc').value.trim(),
      category: $('#p-category').value, image_url: imageUrl,
      detail_images: currentDetailImages,
      location: $('#p-location').value.trim(), shoot_date: $('#p-date').value,
      tags: tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : [],
      order_index: parseInt($('#p-order').value) || 0,
      visible: $('#p-visible').checked, featured: $('#p-featured').checked
    };
    const btn = $('#photo-save-btn'); btn.disabled = true;
    try {
      const editId = $('#photo-edit-id').value;
      if (editId) { await apiRequest('PUT', `/photos/${editId}`, body); showToast('Đã cập nhật!', 'success'); }
      else { await apiRequest('POST', '/photos', body); showToast('Đã thêm ảnh!', 'success'); }
      closePhotoModal(); await loadPhotos(); await loadDashboard();
    } catch (err) { showToast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });

  // Category filter in admin
  $('#admin-cat-filter')?.addEventListener('change', e => {
    photosFilter = e.target.value; renderPhotosGrid();
  });
}

async function doPhotoUpload(file) {
  const prog = $('#photo-upload-progress');
  try {
    showToast('Đang upload...', 'info');
    const data = await uploadImage(file, prog);
    $('#p-image-url').value = data.url;
    $('#p-image-url-input').value = data.url;
    showPhotoPreview(data.url);
    showToast('Upload thành công! 🎉', 'success');
  } catch (err) {
    showToast(`Upload thất bại: ${err.message}`, 'error');
    if (prog) prog.style.width = '0%';
  }
}

// ─── ABOUT ────────────────────────────────────────────────────────────────────
async function loadAbout() {
  try {
    const d = await apiRequest('GET', '/about');
    $('#about-name').value = d.name || '';
    $('#about-title').value = d.title || '';
    $('#about-bio').value = d.bio || '';
    $('#about-email').value = d.email || '';
    $('#about-phone').value = d.phone || '';
    $('#about-instagram').value = d.instagram || '';
    $('#about-facebook').value = d.facebook || '';
    if (d.avatar_url) {
      $('#about-avatar-url').value = d.avatar_url;
      $('#about-avatar-preview').classList.add('visible');
      $('#about-avatar-preview-img').src = d.avatar_url;
    }
  } catch (err) { showToast(`Không thể tải About: ${err.message}`, 'error'); }
}

function initAbout() {
  const fileInput = $('#about-avatar-file'), zone = $('#about-avatar-zone');
  fileInput?.addEventListener('change', async () => { if (fileInput.files[0]) await doAvatarUpload(fileInput.files[0]); });
  zone?.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone?.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone?.addEventListener('drop', async e => {
    e.preventDefault(); zone.classList.remove('dragover');
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith('image/')) await doAvatarUpload(f);
  });
  $('#about-avatar-remove')?.addEventListener('click', () => {
    $('#about-avatar-url').value = ''; $('#about-avatar-preview').classList.remove('visible');
    $('#about-avatar-preview-img').src = '';
    if (fileInput) fileInput.value = '';
  });
  $('#btn-save-about')?.addEventListener('click', async () => {
    const body = {
      name: $('#about-name').value.trim(), title: $('#about-title').value.trim(),
      bio: $('#about-bio').value.trim(), avatar_url: $('#about-avatar-url').value.trim(),
      email: $('#about-email').value.trim(), phone: $('#about-phone').value.trim(),
      instagram: $('#about-instagram').value.trim(), facebook: $('#about-facebook').value.trim()
    };
    if (!body.name) { showToast('Vui lòng nhập tên!', 'error'); return; }
    try { await apiRequest('PUT', '/about', body); showToast('Đã lưu!', 'success'); }
    catch (err) { showToast(err.message, 'error'); }
  });
}

async function doAvatarUpload(file) {
  try {
    showToast('Đang upload ảnh...', 'info');
    const data = await uploadImage(file, $('#about-avatar-progress'));
    $('#about-avatar-url').value = data.url;
    $('#about-avatar-preview').classList.add('visible');
    $('#about-avatar-preview-img').src = data.url;
    showToast('Upload thành công!', 'success');
  } catch (err) { showToast(`Upload thất bại: ${err.message}`, 'error'); }
}

// ─── SERVICES ─────────────────────────────────────────────────────────────────
let servicesList = [];

async function loadServices() {
  const grid = $('#services-admin-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    servicesList = await apiRequest('GET', '/services');
    renderServicesGrid();
    $('#services-count').textContent = servicesList.length;
  } catch (err) { grid.innerHTML = `<p style="color:var(--accent-danger)">${err.message}</p>`; }
}

function renderServicesGrid() {
  const grid = $('#services-admin-grid');
  if (!grid) return;
  if (!servicesList.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💼</div><h3>Chưa có dịch vụ nào</h3></div>`;
    return;
  }
  grid.innerHTML = '';
  servicesList.forEach(s => {
    const card = document.createElement('div');
    card.className = 'skill-admin-card';
    card.innerHTML = `
      <div class="skill-admin-icon">${s.icon || '📷'}</div>
      <div class="skill-admin-info">
        <div class="skill-admin-name">${s.name}</div>
        <div class="skill-admin-category" style="white-space:normal;line-height:1.5">${s.description || '—'}</div>
      </div>
      <div class="skill-admin-actions">
        <button class="btn btn-secondary btn-sm btn-icon edit-svc-btn" data-id="${s.id}" title="Sửa">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="btn btn-danger btn-sm btn-icon del-svc-btn" data-id="${s.id}" title="Xóa">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
      </div>
    `;
    grid.appendChild(card);
  });
  $$('.edit-svc-btn', grid).forEach(btn => {
    btn.addEventListener('click', () => { const s = servicesList.find(x => x.id == btn.dataset.id); if (s) openServiceModal(s); });
  });
  $$('.del-svc-btn', grid).forEach(btn => {
    btn.addEventListener('click', async () => {
      const s = servicesList.find(x => x.id == btn.dataset.id);
      if (!await showConfirm(`Xóa dịch vụ "${s?.name}"?`)) return;
      try { await apiRequest('DELETE', `/services/${btn.dataset.id}`); await loadServices(); showToast('Đã xóa!', 'success'); }
      catch (err) { showToast(err.message, 'error'); }
    });
  });
}

function openServiceModal(service = null) {
  $('#service-modal-heading').textContent = service ? 'Chỉnh sửa dịch vụ' : 'Thêm dịch vụ mới';
  $('#service-edit-id').value = service?.id || '';
  $('#s-name').value = service?.name || '';
  $('#s-icon').value = service?.icon || '';
  $('#s-desc').value = service?.description || '';
  $('#s-order').value = service?.order_index || 0;
  $('#service-modal-overlay').classList.add('open');
}
function closeServiceModal() { $('#service-modal-overlay')?.classList.remove('open'); }

function initServiceModal() {
  $('#btn-add-service')?.addEventListener('click', () => openServiceModal(null));
  $('#service-modal-close')?.addEventListener('click', closeServiceModal);
  $('#service-cancel-btn')?.addEventListener('click', closeServiceModal);
  $('#service-modal-overlay')?.addEventListener('click', e => { if (e.target === $('#service-modal-overlay')) closeServiceModal(); });
  $('#service-save-btn')?.addEventListener('click', async () => {
    const name = $('#s-name').value.trim();
    if (!name) { showToast('Vui lòng nhập tên dịch vụ!', 'error'); return; }
    const editId = $('#service-edit-id').value;
    const body = { name, icon: $('#s-icon').value.trim(), description: $('#s-desc').value.trim(), order_index: parseInt($('#s-order').value) || 0 };
    const btn = $('#service-save-btn'); btn.disabled = true;
    try {
      if (editId) { await apiRequest('PUT', `/services/${editId}`, body); showToast('Đã cập nhật!', 'success'); }
      else { await apiRequest('POST', '/services', body); showToast('Đã thêm!', 'success'); }
      closeServiceModal(); await loadServices(); await loadDashboard();
    } catch (err) { showToast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });
}

// ─── Settings ─────────────────────────────────────────────────────────────────
function initSettings() {
  $('#change-password-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const curr = $('#curr-pw').value, np = $('#new-pw').value, cf = $('#confirm-pw').value;
    if (np !== cf) { showToast('Mật khẩu xác nhận không khớp!', 'error'); return; }
    if (np.length < 6) { showToast('Mật khẩu mới phải ít nhất 6 ký tự!', 'error'); return; }
    try { await apiRequest('PUT', '/change-password', { currentPassword: curr, newPassword: np }); showToast('Đã đổi mật khẩu!', 'success'); e.target.reset(); }
    catch (err) { showToast(err.message, 'error'); }
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  const authed = await checkAuth();
  if (authed) { showAdminApp(); initNav(); loadDashboard(); switchTab('dashboard'); }
  else showLoginPage();
  initLogin(); initPhotoModal(); initAbout(); initServiceModal(); initSettings(); initHeroImagesLogic(); initClientAlbumModal(); initNotifications();
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePhotoModal(); closeServiceModal(); closeClientAlbumModal(); $('#confirm-modal-overlay')?.classList.remove('open'); }
  });
  $('#confirm-modal-close')?.addEventListener('click', () => $('#confirm-modal-overlay')?.classList.remove('open'));
}

document.addEventListener('DOMContentLoaded', init);

// ─── CLIENT ALBUMS ────────────────────────────────────────────────────────────
let clientAlbumsList = [];
let caStatusFilter = 'all';

const STATUS_CONFIG = {
  draft:     { label: 'Bản nháp',           color: '#94a3b8', bg: 'rgba(148,163,184,.15)', dot: '#94a3b8' },
  waiting:   { label: 'Chờ khách xem',      color: '#818cf8', bg: 'rgba(129,140,248,.15)', dot: '#818cf8' },
  selecting: { label: 'Khách đang chọn',    color: '#60a5fa', bg: 'rgba(96,165,250,.15)',  dot: '#60a5fa' },
  selected:  { label: 'Khách chọn xong',    color: '#34d399', bg: 'rgba(52,211,153,.15)',  dot: '#34d399' },
  editing:   { label: 'Đang hậu kỳ',        color: '#fbbf24', bg: 'rgba(251,191,36,.15)',  dot: '#fbbf24' },
  ready:     { label: 'Sẵn sàng bàn giao',  color: '#f472b6', bg: 'rgba(244,114,182,.15)', dot: '#f472b6' },
};

function timeAgo(dateStr) {
  if (!dateStr) return '';
  // SQLite stores "2026-04-02 13:21:36" (UTC, no T/Z) — fix for JS Date parsing
  const normalized = String(dateStr).trim().replace(' ', 'T') + (dateStr.includes('Z') ? '' : 'Z');
  const diff = (Date.now() - new Date(normalized)) / 1000;
  if (isNaN(diff) || diff < 0) return 'vừa xong';
  if (diff < 60)     return 'vừa xong';
  if (diff < 3600)   return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400)  return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 172800) return 'Hôm qua';
  return `${Math.floor(diff / 86400)} ngày trước`;
}

async function loadClientAlbums() {
  const container = $('#client-albums-grid');
  if (!container) return;
  container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    clientAlbumsList = await apiRequest('GET', '/client-albums');
    renderClientAlbumsUI();
    $('#client-albums-count').textContent = clientAlbumsList.length;
  } catch (err) {
    container.innerHTML = `<p style="color:var(--accent-danger);padding:2rem">${err.message}</p>`;
  }
}

function renderClientAlbumsUI() {
  const panel = $('#tab-client-albums');
  if (!panel) return;

  // Count per status
  const counts = { all: clientAlbumsList.length };
  Object.keys(STATUS_CONFIG).forEach(s => {
    counts[s] = clientAlbumsList.filter(a => (a.status || 'draft') === s).length;
  });

  // Filter tabs HTML
  const tabsDef = [
    { key: 'all',       label: 'Tất cả' },
    { key: 'draft',     label: STATUS_CONFIG.draft.label },
    { key: 'waiting',   label: STATUS_CONFIG.waiting.label },
    { key: 'selecting', label: STATUS_CONFIG.selecting.label },
    { key: 'selected',  label: STATUS_CONFIG.selected.label },
    { key: 'editing',   label: STATUS_CONFIG.editing.label },
    { key: 'ready',     label: STATUS_CONFIG.ready.label },
  ];

  let tabsEl = panel.querySelector('.ca-filter-tabs');
  if (!tabsEl) {
    tabsEl = document.createElement('div');
    tabsEl.className = 'ca-filter-tabs';
    // Insert after panel-header
    const ph = panel.querySelector('.panel-header');
    ph.after(tabsEl);
  }
  tabsEl.innerHTML = tabsDef.map(t => {
    const cfg = STATUS_CONFIG[t.key];
    const dot = cfg ? `<span class="ca-tab-dot" style="background:${cfg.dot}"></span>` : '';
    return `<button class="ca-filter-tab ${caStatusFilter === t.key ? 'active' : ''}" data-status="${t.key}">
      ${dot}${t.label} <span class="ca-tab-count">${counts[t.key] || 0}</span>
    </button>`;
  }).join('');
  tabsEl.querySelectorAll('.ca-filter-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      caStatusFilter = btn.dataset.status;
      renderClientAlbumsGrid();
      tabsEl.querySelectorAll('.ca-filter-tab').forEach(b => b.classList.toggle('active', b.dataset.status === caStatusFilter));
    });
  });

  renderClientAlbumsGrid();
}

function renderClientAlbumsGrid() {
  const grid = $('#client-albums-grid');
  if (!grid) return;

  const filtered = caStatusFilter === 'all'
    ? clientAlbumsList
    : clientAlbumsList.filter(a => (a.status || 'draft') === caStatusFilter);

  if (!filtered.length) {
    grid.innerHTML = `<div class="ca-empty-state">
      <div style="font-size:2.5rem">📁</div>
      <h3>Không có album nào</h3>
      <p>${caStatusFilter === 'all' ? 'Nhấn "+ Tạo album mới" để bắt đầu.' : 'Chưa có album ở trạng thái này.'}</p>
    </div>`;
    return;
  }

  grid.innerHTML = '';
  filtered.forEach(a => {
    const cfg = STATUS_CONFIG[a.status || 'draft'] || STATUS_CONFIG.draft;
    const card = document.createElement('div');
    card.className = 'ca-card';
    const emailList = (a.client_emails || []).join(', ') || '—';
    const clientDisplay = a.client_name || (a.client_emails?.[0]?.split('@')[0] || '—');

    card.innerHTML = `
      <div class="ca-card-cover">
        ${a.cover_image
          ? `<img src="${a.cover_image}" alt="${a.title}" loading="lazy" />`
          : `<div class="ca-card-no-cover">📷</div>`}
        <div class="ca-card-actions">
          <button class="btn-icon copy-link-ca-btn" data-id="${a.id}" title="Copy link album">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>
          <button class="btn-icon edit-ca-btn" data-id="${a.id}" title="Chỉnh sửa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon btn-danger del-ca-btn" data-id="${a.id}" title="Xóa">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
          </button>
        </div>
      </div>
      <div class="ca-card-body">
        <div class="ca-card-top">
          <div class="ca-status-badge" style="background:${cfg.bg};color:${cfg.color};" data-id="${a.id}">
            <span class="ca-status-dot" style="background:${cfg.dot}"></span>
            ${cfg.label}
            <span class="ca-status-chevron">▼</span>
            <select class="ca-status-select" data-id="${a.id}" title="Đổi trạng thái">
              ${Object.entries(STATUS_CONFIG).map(([k,v]) =>
                `<option value="${k}" ${(a.status||'draft')===k?'selected':''}>${v.label}</option>`
              ).join('')}
            </select>
          </div>
          <div class="ca-privacy-indicator ${a.is_public ? 'public' : 'private'}" title="${a.is_public ? 'Album Công khai' : 'Album Riêng tư'}">
            ${a.is_public ? '🌐' : '🔒'}
          </div>
        </div>
        <div class="ca-card-title">${a.title}</div>
        <div class="ca-card-client">👤 ${clientDisplay}</div>
        ${a.description ? `<div class="ca-card-desc">${a.description}</div>` : ''}
        <div class="ca-card-emails" title="${emailList}">✉️ ${emailList}</div>
        <div class="ca-card-meta">
          <span>📅 ${timeAgo(a.created_at)}</span>
          <a href="https://drive.google.com/drive/folders/${a.drive_folder_id}" target="_blank">Drive ↗</a>
        </div>
        <button class="ca-detail-btn view-detail-btn" data-id="${a.id}">
          Xem chi tiết lựa chọn
        </button>
      </div>
    `;
    grid.appendChild(card);
  });

  // Status select inline change
  grid.querySelectorAll('.ca-status-select').forEach(sel => {
    sel.addEventListener('change', async (e) => {
      e.stopPropagation();
      try {
        await apiRequest('PUT', `/client-albums/${sel.dataset.id}`, { status: sel.value });
        await loadClientAlbums();
        showToast('Đã cập nhật trạng thái!', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  // View detail
  grid.querySelectorAll('.view-detail-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openAlbumDetail(btn.dataset.id);
    });
  });

  // Copy link
  grid.querySelectorAll('.copy-link-ca-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const link = `${window.location.origin}/client?album=${btn.dataset.id}`;
      navigator.clipboard?.writeText(link).then(() => showToast('📋 Đã copy link album!', 'success'));
    });
  });

  // Edit / Delete
  grid.querySelectorAll('.edit-ca-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const a = clientAlbumsList.find(x => x.id == btn.dataset.id);
      if (a) openClientAlbumModal(a);
    });
  });
  grid.querySelectorAll('.del-ca-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const a = clientAlbumsList.find(x => x.id == btn.dataset.id);
      if (!await showConfirm(`Xóa album "${a?.title}"?`)) return;
      try {
        await apiRequest('DELETE', `/client-albums/${btn.dataset.id}`);
        await loadClientAlbums();
        showToast('Đã xóa album!', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
}

// ─── Notification System ──────────────────────────────────────────────────────
let notifPollInterval = null;

async function loadNotifications() {
  try {
    const { count, notifications } = await apiRequest('GET', '/notifications');
    const badge = document.getElementById('notif-badge');
    const list  = document.getElementById('notif-list');
    if (badge) {
      badge.textContent = count;
      badge.classList.toggle('hidden', count === 0);
    }
    if (list) {
      if (!notifications || !notifications.length) {
        list.innerHTML = '<div class="notif-empty">Không có thông báo mới</div>';
      } else {
        list.innerHTML = notifications.map(n => {
          const initials = (n.name || n.email || '?').substring(0, 2).toUpperCase();
          const typeConfig = {
            access_request: { icon: '🔑', label: 'Yêu cầu truy cập', color: '#a78bfa' },
            selection:      { icon: '✅', label: 'Đã chọn ảnh',       color: '#4ade80' },
            comment:        { icon: '💬', label: 'Ghi chú ảnh',       color: '#38bdf8' },
          };
          const cfg = typeConfig[n.type] || { icon: '🔔', label: 'Thông báo', color: '#94a3b8' };

          // Action buttons differ by type
          let actions = '';
          if (n.type === 'access_request') {
            actions = `
              <div class="notif-item-actions">
                <button class="btn-notif-approve" data-id="${n.id}" data-type="access_request">✅ Phê duyệt</button>
                <button class="btn-notif-reject"  data-id="${n.id}" data-type="access_request">✕ Từ chối</button>
              </div>`;
          } else {
            actions = `
              <div class="notif-item-actions">
                <button class="btn-notif-view" data-id="${n.id}" data-album="${n.album_id}">👁 Xem album</button>
                <button class="btn-notif-read" data-id="${n.id}">✓ Đã xem</button>
              </div>`;
          }

          return `
          <div class="notif-item" data-id="${n.id}" data-type="${n.type}">
            <div class="notif-avatar" style="background:linear-gradient(135deg,${cfg.color}55,${cfg.color}99)">${initials}</div>
            <div class="notif-item-info">
              <div class="notif-item-type-badge" style="color:${cfg.color}">${cfg.icon} ${cfg.label}</div>
              <div class="notif-item-title">${n.album_title || 'Album #' + n.album_id}</div>
              <div class="notif-item-email">${n.email}</div>
              ${n.message ? `<div class="notif-item-msg">${n.message}</div>` : ''}
              <div class="notif-item-sub">⏱ ${timeAgo(n.created_at)}${n.name ? ' · ' + n.name : ''}</div>
              ${actions}
            </div>
          </div>`;
        }).join('');

        // Bind access request approve/reject
        list.querySelectorAll('.btn-notif-approve[data-type="access_request"]').forEach(btn => {
          btn.addEventListener('click', () => handleAccessRequest(btn.dataset.id, 'approved'));
        });
        list.querySelectorAll('.btn-notif-reject[data-type="access_request"]').forEach(btn => {
          btn.addEventListener('click', () => handleAccessRequest(btn.dataset.id, 'rejected'));
        });
        // Bind mark-read for selection/comment
        list.querySelectorAll('.btn-notif-read').forEach(btn => {
          btn.addEventListener('click', async () => {
            await apiRequest('PUT', `/notifications/${btn.dataset.id}/read`);
            await loadNotifications();
          });
        });
        // Bind view album
        list.querySelectorAll('.btn-notif-view').forEach(btn => {
          btn.addEventListener('click', async () => {
            await apiRequest('PUT', `/notifications/${btn.dataset.id}/read`);
            // Switch to client albums tab and open detail
            document.querySelector('[data-section="client-albums"]')?.click();
            await loadNotifications();
            document.getElementById('notif-dropdown')?.classList.add('hidden');
            openAlbumDetail(btn.dataset.album);
          });
        });
      }
    }
  } catch {}
}

async function handleAccessRequest(id, status) {
  try {
    await apiRequest('PUT', `/access-requests/${id}`, { status });
    showToast(status === 'approved' ? '✅ Đã phê duyệt quyền truy cập!' : '❌ Đã từ chối yêu cầu.', status === 'approved' ? 'success' : 'info');
    await loadNotifications();
    await loadClientAlbums();
  } catch (err) { showToast(err.message, 'error'); }
}

function initNotifications() {
  const bell     = document.getElementById('notif-bell');
  const dropdown = document.getElementById('notif-dropdown');
  const closeBtn = document.getElementById('notif-close');

  // Open / toggle on bell click
  bell?.addEventListener('click', (e) => {
    e.stopPropagation();
    const isHidden = dropdown?.classList.contains('hidden');
    dropdown?.classList.toggle('hidden');
    if (isHidden) loadNotifications(); // load fresh when opening
  });

  // Close on ✕ button — use capture to ensure it fires first
  closeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown?.classList.add('hidden');
  });

  // Also handle via event delegation on dropdown header (belt-and-suspenders)
  dropdown?.addEventListener('click', (e) => {
    if (e.target.closest('#notif-close')) {
      e.stopPropagation();
      dropdown.classList.add('hidden');
    }
  });

  // Close when clicking outside the entire notif-wrap
  document.addEventListener('click', (e) => {
    if (!document.getElementById('notif-wrap')?.contains(e.target)) {
      dropdown?.classList.add('hidden');
    }
  });

  // Poll every 30s for new notifications
  loadNotifications();
  notifPollInterval = setInterval(loadNotifications, 30000);
}

// ─── Album Detail Modal (khách đã chọn + ghi chú) ────────────────────────────
let adminSelectedMap = {}; // id -> 'selected' | 'later'
let adminCommentMap = {}; // id -> string
let adminCurrentPhotos = []; // allPhotos from API

async function openAlbumDetail(albumId) {
  const overlay = document.getElementById('album-detail-overlay');
  const content = document.getElementById('album-detail-content');
  if (!overlay || !content) return;
  content.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  overlay.classList.add('open');

  try {
    const { album, selection, allPhotos } = await apiRequest('GET', `/client-albums/${albumId}/selection`);
    const cfg = STATUS_CONFIG[album.status || 'draft'] || STATUS_CONFIG.draft;

    adminSelectedMap = {};
    adminCommentMap = {};
    const submittedAt = selection ? new Date(selection.submitted_at).toLocaleString('vi-VN') : '—';
    
    let totalSelected = 0;
    let totalCommented = 0;
    let totalLater = 0;

    if (selection) {
      if (selection.photos) {
        selection.photos.forEach(p => {
          adminSelectedMap[p.id] = 'selected';
          if (p.comment) adminCommentMap[p.id] = p.comment;
        });
        totalSelected = selection.photos.length;
      }
      if (selection.later_photos) {
        selection.later_photos.forEach(p => {
          adminSelectedMap[p.id] = 'later';
          if (p.comment && !adminCommentMap[p.id]) adminCommentMap[p.id] = p.comment;
        });
        totalLater = selection.later_photos.length;
      }
    }
    
    totalCommented = Object.keys(adminCommentMap).length;
    adminCurrentPhotos = allPhotos && allPhotos.length > 0 ? allPhotos : (selection ? [...(selection.photos || []), ...(selection.later_photos || [])] : []);

    if (!adminCurrentPhotos.length) {
      content.innerHTML = `
        <div class="ad-header">
          <h2>${album.title}</h2>
          <p style="color:var(--text-muted)">👤 ${album.client_name || album.client_email || '—'}</p>
        </div>
        <div class="ad-empty">
          <div style="font-size:2rem">📭</div>
          <p>Album chưa có ảnh nào / Không lấy được danh sách ảnh từ Drive.</p>
        </div>`;
      return;
    }

    content.innerHTML = `
      <div class="ad-header">
        <div>
          <h2>${album.title}</h2>
          <p style="color:var(--text-muted);font-size:.85rem">
            👤 ${album.client_name || '—'} &nbsp;·&nbsp;
            ✉️ ${album.client_email || '—'}
          </p>
        </div>
        <div class="ad-meta">
          <span class="ca-status-badge" style="background:${cfg.bg};color:${cfg.color};display:inline-flex;align-items:center;gap:.35rem;padding:.25rem .7rem;border-radius:99px;font-size:.75rem;font-weight:600">
            <span class="ca-status-dot" style="background:${cfg.dot};width:6px;height:6px;border-radius:50%;display:inline-block"></span>${cfg.label}
          </span>
          <div style="font-size:.75rem;color:var(--text-muted);margin-top:.35rem">📤 Lựa chọn gần nhất: ${submittedAt}</div>
        </div>
      </div>

      <div class="ad-summary">
        <div class="ad-stat"><span class="ad-stat-n">${adminCurrentPhotos.length}</span><span class="ad-stat-l">Tổng ảnh Drive</span></div>
        <div class="ad-stat"><span class="ad-stat-n">${totalSelected}</span><span class="ad-stat-l">Đã chọn</span></div>
        ${totalLater ? `<div class="ad-stat"><span class="ad-stat-n">${totalLater}</span><span class="ad-stat-l">Chọn sau</span></div>` : ''}
        ${totalCommented ? `<div class="ad-stat"><span class="ad-stat-n">${totalCommented}</span><span class="ad-stat-l">Ghi chú</span></div>` : ''}
      </div>

      <div class="ad-filters-container">
        <div class="ad-filters-group">
          <span class="ad-filters-label">Lọc ảnh:</span>
          
          <label class="ad-filter-pill sel-pill">
            <input type="checkbox" id="ad-filter-selected" class="ad-filter-cb hidden-cb">
            <span class="ad-pill-text"><span class="pill-icon">✅</span> Đã chọn</span>
          </label>
          
          <label class="ad-filter-pill later-pill">
            <input type="checkbox" id="ad-filter-later" class="ad-filter-cb hidden-cb">
            <span class="ad-pill-text"><span class="pill-icon">⏳</span> Chọn sau</span>
          </label>
          
          <label class="ad-filter-pill cmt-pill">
            <input type="checkbox" id="ad-filter-commented" class="ad-filter-cb hidden-cb">
            <span class="ad-pill-text"><span class="pill-icon">💬</span> Có ghi chú</span>
          </label>
        </div>
        <button id="btn-copy-filtered-names" class="btn-ad-copy">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy tên file (Đã lọc)
        </button>
      </div>

      <div class="ad-photos-grid" id="ad-detail-grid" style="margin-top:1.5rem;"></div>
    `;

    const grid = document.getElementById('ad-detail-grid');
    const chkSelected = document.getElementById('ad-filter-selected');
    const chkLater = document.getElementById('ad-filter-later');
    const chkCommented = document.getElementById('ad-filter-commented');
    const btnCopy = document.getElementById('btn-copy-filtered-names');

    let currentlyFilteredItems = [];

    const renderAdminGrid = () => {
      const showSel = chkSelected.checked;
      const showLater = chkLater.checked;
      const showCmt = chkCommented.checked;
      
      currentlyFilteredItems = adminCurrentPhotos.filter(p => {
        const isSel = (adminSelectedMap[p.id] === 'selected');
        const isLater = (adminSelectedMap[p.id] === 'later');
        const hasCmt = !!adminCommentMap[p.id];
        
        if (!showSel && !showLater && !showCmt) return true; // check nothing => show all
        if (showSel && isSel) return true;
        if (showLater && isLater) return true;
        if (showCmt && hasCmt) return true;
        
        return false; // must match at least one selected condition
      });

      if (!currentlyFilteredItems.length) {
        grid.innerHTML = '<p style="color:var(--text-muted); opacity:.7; text-align:center; padding: 2rem;">Không có ảnh nào khớp với bộ lọc.</p>';
        return;
      }

      grid.innerHTML = currentlyFilteredItems.map(p => {
        const state = adminSelectedMap[p.id];
        const comment = adminCommentMap[p.id];
        const stateStr = state === 'selected' ? '<span style="color:#4ade80;" title="Đã chọn">✅</span>' : (state === 'later' ? '<span style="color:#facc15;" title="Chọn sau">⏳</span>' : '');
        const opacity = (!state && !comment) ? '0.5' : '1';
        return `
          <div class="ad-photo-card" style="opacity:${opacity}; transition:opacity .2s;">
            <a href="https://lh3.googleusercontent.com/d/${p.id}" target="_blank">
              <img src="https://lh3.googleusercontent.com/d/${p.id}=w300" alt="${p.name}" loading="lazy"
                   onerror="this.style.background='rgba(255,255,255,.05)'" />
            </a>
            <div class="ad-photo-info" style="display:flex;flex-direction:column;gap:.3rem;">
              <div class="ad-photo-name" style="display:flex;justify-content:space-between;align-items:center;">
                <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;font-size:0.8rem;color:var(--text-muted);">${p.name}</span>
                ${stateStr}
              </div>
              ${comment ? `<div class="ad-photo-comment" style="font-size:.8rem;color:#a5b4fc;"><span class="ad-cmt-icon">💬</span> ${comment}</div>` : ''}
            </div>
          </div>`;
      }).join('');
    };

    renderAdminGrid();

    chkSelected.addEventListener('change', renderAdminGrid);
    chkLater.addEventListener('change', renderAdminGrid);
    chkCommented.addEventListener('change', renderAdminGrid);

    btnCopy.addEventListener('click', () => {
      if (!currentlyFilteredItems.length) {
        showToast('Không có tên file nào để copy!', 'error');
        return;
      }
      const names = currentlyFilteredItems.map(p => {
        let name = p.name || '';
        return name.replace(/\.[^/.]+$/, ""); // strip extension
      }).filter(n => n.trim() !== "");
      
      navigator.clipboard.writeText(names.join('\n')).then(() => {
        showToast(`Đã copy ${names.length} tên file!`);
      });
    });

  } catch (err) {
    content.innerHTML = `<p style="color:var(--accent-danger);padding:2rem">${err.message}</p>`;
  }
}

// ─── Email Tags logic ─────────────────────────────────────────────────────────
let caEmailTags = []; // current emails array in modal

function renderEmailTags() {
  const list = document.getElementById('email-tags-list');
  if (!list) return;
  list.innerHTML = '';
  caEmailTags.forEach((email, i) => {
    const tag = document.createElement('div');
    tag.className = 'email-tag';
    tag.innerHTML = `<span>${email}</span><button type="button" class="email-tag-remove" data-i="${i}" title="Xóa">✕</button>`;
    list.appendChild(tag);
  });
  list.querySelectorAll('.email-tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      caEmailTags.splice(parseInt(btn.dataset.i), 1);
      renderEmailTags();
    });
  });
}

function addEmailTag(raw) {
  const email = raw.trim().toLowerCase();
  if (!email) return false;
  // Basic email validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast(`"${email}" không phải email hợp lệ`, 'error');
    return false;
  }
  if (caEmailTags.includes(email)) {
    showToast('Email này đã được thêm rồi', 'info');
    return false;
  }
  caEmailTags.push(email);
  renderEmailTags();
  return true;
}

// ─── Cover Picker helpers ─────────────────────────────────────────────────────
function setCoverPreview(url) {
  const preview = $('#ca-cover-preview');
  const img = $('#ca-cover-preview-img');
  const hidden = $('#ca-cover');
  if (url) {
    img.src = url; hidden.value = url;
    preview.classList.add('visible');
  } else {
    img.src = ''; hidden.value = '';
    preview.classList.remove('visible');
  }
}

function parseDriveUrl(raw) {
  if (!raw) return raw;
  // https://drive.google.com/file/d/FILE_ID/view → thumbnail
  const fileMatch = raw.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (fileMatch) return `https://lh3.googleusercontent.com/d/${fileMatch[1]}`;
  // https://drive.google.com/open?id=FILE_ID
  const openMatch = raw.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (openMatch) return `https://lh3.googleusercontent.com/d/${openMatch[1]}`;
  // Already a direct URL
  return raw;
}

function resetCoverPicker() {
  setCoverPreview('');
  const fileInput = $('#ca-cover-file');
  if (fileInput) fileInput.value = '';
  const urlInput = $('#ca-cover-url-input');
  if (urlInput) urlInput.value = '';
  $('#ca-cover-progress').style.width = '0%';
  // Switch back to upload tab
  $('#ca-tab-upload')?.classList.add('active');
  $('#ca-tab-url')?.classList.remove('active');
  $('#ca-panel-upload')?.classList.remove('hidden');
  $('#ca-panel-url')?.classList.add('hidden');
}

function openClientAlbumModal(album = null) {
  $('#ca-modal-heading').textContent = album ? 'Chỉnh sửa Album' : 'Tạo Client Album mới';
  $('#ca-edit-id').value = album?.id || '';
  $('#ca-title').value = album?.title || '';
  $('#ca-desc').value = album?.description || '';
  $('#ca-client-name').value = album?.client_name || '';
  $('#ca-status').value = album?.status || 'draft';
  $('#ca-drive').value = album?.drive_folder_id
    ? `https://drive.google.com/drive/folders/${album.drive_folder_id}`
    : '';

  // Reset cover picker, then load existing cover if editing
  resetCoverPicker();
  if (album?.cover_image) setCoverPreview(album.cover_image);

  // Load emails from album
  caEmailTags = Array.isArray(album?.client_emails) ? [...album.client_emails] : [];
  renderEmailTags();
  const emailInput = $('#ca-email-input');
  if (emailInput) emailInput.value = '';

  // Privacy toggle
  const isPublic = album?.is_public ? 1 : 0;
  $('#ca-privacy-private').checked = !isPublic;
  $('#ca-privacy-public').checked = !!isPublic;
  updatePrivacyUI(isPublic, album?.id);

  $('#client-album-modal-overlay').classList.add('open');
  setTimeout(() => $('#ca-title')?.focus(), 100);
}
function updatePrivacyUI(isPublic, albumId) {
  $('#priv-opt-private')?.classList.toggle('selected', !isPublic);
  $('#priv-opt-public')?.classList.toggle('selected', !!isPublic);
  const linkGroup = $('#copy-link-group');
  if (linkGroup) {
    if (albumId) {
      linkGroup.style.display = 'block';
      const origin = window.location.origin;
      $('#ca-album-link').value = `${origin}/client?album=${albumId}`;
    } else {
      linkGroup.style.display = 'none';
    }
  }
}
function closeClientAlbumModal() { $('#client-album-modal-overlay')?.classList.remove('open'); }

function initClientAlbumModal() {
  $('#btn-add-client-album')?.addEventListener('click', () => openClientAlbumModal(null));
  $('#ca-modal-close')?.addEventListener('click', closeClientAlbumModal);
  $('#ca-cancel-btn')?.addEventListener('click', closeClientAlbumModal);
  $('#client-album-modal-overlay')?.addEventListener('click', e => {
    if (e.target === $('#client-album-modal-overlay')) closeClientAlbumModal();
  });

  // ── Privacy toggle ──
  document.querySelectorAll('input[name="ca-privacy"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isPublic = $('#ca-privacy-public').checked ? 1 : 0;
      const albumId = $('#ca-edit-id').value;
      updatePrivacyUI(isPublic, albumId);
    });
  });

  // ── Copy link button ──
  $('#ca-copy-link-btn')?.addEventListener('click', () => {
    const link = $('#ca-album-link')?.value;
    if (link) navigator.clipboard?.writeText(link).then(() => showToast('Đã copy link album!', 'success'));
  });

  // ── Cover Picker tab switching ──
  $('#ca-tab-upload')?.addEventListener('click', () => {
    $('#ca-tab-upload').classList.add('active');
    $('#ca-tab-url').classList.remove('active');
    $('#ca-panel-upload').classList.remove('hidden');
    $('#ca-panel-url').classList.add('hidden');
  });
  $('#ca-tab-url')?.addEventListener('click', () => {
    $('#ca-tab-url').classList.add('active');
    $('#ca-tab-upload').classList.remove('active');
    $('#ca-panel-url').classList.remove('hidden');
    $('#ca-panel-upload').classList.add('hidden');
  });

  // ── Cover: Upload from computer ──
  const coverFile = $('#ca-cover-file');
  const coverZone = $('#ca-cover-zone');
  const handleCoverUpload = async (file) => {
    if (!file?.type.startsWith('image/')) return;
    showToast('Đang upload ảnh bìa...', 'info');
    try {
      const data = await uploadImage(file, $('#ca-cover-progress'));
      setCoverPreview(data.url);
      showToast('Upload ảnh bìa thành công!', 'success');
    } catch (err) { showToast(`Upload thất bại: ${err.message}`, 'error'); }
  };
  coverFile?.addEventListener('change', () => { if (coverFile.files[0]) handleCoverUpload(coverFile.files[0]); });
  coverZone?.addEventListener('dragover', e => { e.preventDefault(); coverZone.classList.add('dragover'); });
  coverZone?.addEventListener('dragleave', () => coverZone.classList.remove('dragover'));
  coverZone?.addEventListener('drop', e => {
    e.preventDefault(); coverZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleCoverUpload(e.dataTransfer.files[0]);
  });

  // ── Cover: URL / Drive input ──
  let urlDebounce;
  $('#ca-cover-url-input')?.addEventListener('input', e => {
    clearTimeout(urlDebounce);
    urlDebounce = setTimeout(() => {
      const url = parseDriveUrl(e.target.value.trim());
      setCoverPreview(url || '');
    }, 600);
  });

  // ── Cover: Remove ──
  $('#ca-cover-remove')?.addEventListener('click', () => {
    resetCoverPicker();
  });

  // Email tag input logic
  const emailInput = $('#ca-email-input');
  const container = $('#email-tags-container');
  container?.addEventListener('click', () => emailInput?.focus());
  emailInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (addEmailTag(emailInput.value)) emailInput.value = '';
    }
    if (e.key === 'Backspace' && !emailInput.value && caEmailTags.length) {
      caEmailTags.pop(); renderEmailTags();
    }
  });
  emailInput?.addEventListener('blur', () => {
    if (emailInput.value.trim()) {
      if (addEmailTag(emailInput.value)) emailInput.value = '';
    }
  });

  // Save
  $('#ca-save-btn')?.addEventListener('click', async () => {
    const title = $('#ca-title').value.trim();
    const drive = $('#ca-drive').value.trim();
    if (!title || !drive) {
      showToast('Vui lòng điền Tên album và Link Drive!', 'error');
      return;
    }
    // Nếu input có email chưa confirm, tự động thêm vào
    const pendingEmail = emailInput?.value.trim();
    if (pendingEmail) {
      addEmailTag(pendingEmail);
      if (emailInput) emailInput.value = '';
    }
    const body = {
      client_emails: caEmailTags,
      client_name: $('#ca-client-name').value.trim(),
      title,
      description: $('#ca-desc').value.trim(),
      drive_folder_id: drive,
      cover_image: $('#ca-cover').value.trim(),
      status: $('#ca-status').value || 'draft',
      is_public: $('#ca-privacy-public').checked ? 1 : 0
    };
    const btn = $('#ca-save-btn'); btn.disabled = true;
    try {
      const editId = $('#ca-edit-id').value;
      if (editId) {
        await apiRequest('PUT', `/client-albums/${editId}`, body);
        showToast('Đã cập nhật album!', 'success');
      } else {
        await apiRequest('POST', '/client-albums', body);
        showToast('Đã tạo album mới!', 'success');
      }
      closeClientAlbumModal();
      await loadClientAlbums();
    } catch (err) { showToast(err.message, 'error'); }
    finally { btn.disabled = false; }
  });
}

// ─── HERO IMAGES ──────────────────────────────────────────────────────────────
let heroImagesList = [];

async function loadHeroImages() {
  const grid = $('#admin-hero-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  try {
    heroImagesList = await apiRequest('GET', '/hero');
    renderHeroGrid();
    const countEl = $('#hero-count');
    if (countEl) countEl.textContent = heroImagesList.length;
  } catch (err) { grid.innerHTML = `<p style="color:var(--accent-danger)">${err.message}</p>`; }
}

function renderHeroGrid() {
  const grid = $('#admin-hero-grid');
  if (!grid) return;
  if (!heroImagesList.length) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🌄</div><h3>Chưa có hình nền nào</h3></div>`;
    return;
  }
  grid.innerHTML = '';
  heroImagesList.forEach(h => {
    const card = document.createElement('div');
    card.className = 'photo-admin-card';
    card.style.minHeight = '150px';
    card.innerHTML = `
      <img src="${h.image_url}" class="photo-admin-img" alt="Background" />
      <div class="photo-admin-overlay">
        <div class="photo-admin-actions">
          <button class="btn btn-danger btn-sm btn-icon del-hero-btn" data-id="${h.id}" title="Xóa bức ảnh này">✕</button>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });
  $$('.del-hero-btn', grid).forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!await showConfirm('Bạn có chắc chắn muốn xóa hình nền này khỏi màn hình chính?')) return;
      try {
        await apiRequest('DELETE', `/hero/${btn.dataset.id}`);
        await loadHeroImages();
        showToast('Đã xóa hình nền!', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
}

function initHeroImagesLogic() {
  const fileInput = $('#hero-files');
  const zone = $('#hero-upload-zone');
  if (!fileInput || !zone) return;
  
  const handleHeroUploads = async (files) => {
    const prog = $('#hero-upload-progress');
    prog.style.width = '50%';
    try {
      showToast(`Đang tải lên ${files.length} ảnh nền...`, 'info');
      const uploads = Array.from(files).filter(f => f.type.startsWith('image/')).map(f => uploadImage(f, null));
      const results = await Promise.all(uploads);
      for (const res of results) {
        if (res && res.url) {
          await apiRequest('POST', '/hero', { image_url: res.url, order_index: heroImagesList.length });
        }
      }
      prog.style.width = '100%';
      setTimeout(() => prog.style.width = '0', 500);
      showToast('Tải lên ảnh nền thành công!', 'success');
      loadHeroImages();
      if (fileInput) fileInput.value = '';
    } catch (err) {
      prog.style.width = '0';
      showToast(`Lỗi upload ảnh nền: ${err.message}`, 'error');
    }
  };

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files.length) handleHeroUploads(fileInput.files);
  });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length) handleHeroUploads(e.dataTransfer.files);
  });
}
