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
  services: 'Dịch vụ', settings: 'Đổi mật khẩu'
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
  initLogin(); initPhotoModal(); initAbout(); initServiceModal(); initSettings(); initHeroImagesLogic();
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closePhotoModal(); closeServiceModal(); $('#confirm-modal-overlay')?.classList.remove('open'); }
  });
  $('#confirm-modal-close')?.addEventListener('click', () => $('#confirm-modal-overlay')?.classList.remove('open'));
}

document.addEventListener('DOMContentLoaded', init);

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

document.addEventListener('DOMContentLoaded', init);
