/* ═══════════════════════════════════════════════════════════════════════════
   Photographer Portfolio — Main JavaScript
   - Custom cursor, page loader, hero slideshow
   - Gallery with category filter + masonry
   - Lightbox with keyboard nav
   - Services & About rendering
   ═══════════════════════════════════════════════════════════════════════════ */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

// ─── Page Loader ──────────────────────────────────────────────────────────────
window.addEventListener('load', () => {
  setTimeout(() => {
    $('#page-loader')?.classList.add('hidden');
    initReveal();
  }, 800);
});

// ─── Custom Cursor ────────────────────────────────────────────────────────────
function initCursor() {
  const dot = $('#cursor-dot');
  const ring = $('#cursor-ring');
  if (!dot || !ring) return;

  let mx = 0, my = 0, rx = 0, ry = 0;
  let animId;

  document.addEventListener('mousemove', (e) => {
    mx = e.clientX; my = e.clientY;
    dot.style.left = mx + 'px';
    dot.style.top  = my + 'px';
  });

  function animRing() {
    rx += (mx - rx) * 0.14;
    ry += (my - ry) * 0.14;
    ring.style.left = rx + 'px';
    ring.style.top  = ry + 'px';
    animId = requestAnimationFrame(animRing);
  }
  animRing();

  document.querySelectorAll('a, button, .photo-card, .filter-btn, .contact-card, .service-card, .slide-dot, .lb-nav, .lb-close').forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
  });

  document.addEventListener('mousedown', () => document.body.classList.add('cursor-click'));
  document.addEventListener('mouseup', () => document.body.classList.remove('cursor-click'));
}

// ─── Navbar ───────────────────────────────────────────────────────────────────
function initNavbar() {
  const nav = $('#navbar');
  const hamburger = $('#hamburger');
  const navLinks = $('#nav-links');
  const links = $$('.nav-link');

  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
    // Active link
    let current = '';
    $$('section[id]').forEach(s => {
      if (window.scrollY >= s.offsetTop - 120) current = s.id;
    });
    links.forEach(l => l.classList.toggle('active', l.getAttribute('href') === `#${current}`));
  });

  hamburger?.addEventListener('click', () => navLinks?.classList.toggle('open'));
  links.forEach(l => l.addEventListener('click', () => navLinks?.classList.remove('open')));
}

// ─── Hero Slideshow ───────────────────────────────────────────────────────────
let heroPhotos = [];
let heroSlideIdx = 0;
let heroTimer;

function buildHeroSlideshow(photos) {
  const slidesWrap = $('#hero-slides');
  const dotsWrap = $('#slide-dots');
  if (!slidesWrap) return;

  heroPhotos = photos.filter(p => p.image_url);

  if (!heroPhotos.length) return;

  // Clear fallback
  slidesWrap.innerHTML = '';
  if (dotsWrap) dotsWrap.innerHTML = '';

  heroPhotos.forEach((p, i) => {
    const slide = document.createElement('div');
    slide.className = 'hero-slide' + (i === 0 ? ' active' : '');
    slide.style.backgroundImage = `url(${p.image_url})`;
    slidesWrap.appendChild(slide);

    if (dotsWrap) {
      const dot = document.createElement('button');
      dot.className = 'slide-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', `Slide ${i + 1}`);
      dot.addEventListener('click', () => goToSlide(i));
      dotsWrap.appendChild(dot);
    }
  });

  startSlideshow();
}

function goToSlide(idx) {
  clearInterval(heroTimer);
  const slides = $$('.hero-slide');
  const dots = $$('.slide-dot');
  if (!slides.length) return;
  slides[heroSlideIdx]?.classList.remove('active');
  dots[heroSlideIdx]?.classList.remove('active');
  heroSlideIdx = (idx + heroPhotos.length) % heroPhotos.length;
  slides[heroSlideIdx]?.classList.add('active');
  dots[heroSlideIdx]?.classList.add('active');
  startSlideshow();
}

function startSlideshow() {
  heroTimer = setInterval(() => goToSlide(heroSlideIdx + 1), 5000);
}

// ─── Gallery ──────────────────────────────────────────────────────────────────
let allPhotos = [];
let filteredPhotos = [];
let activeFilter = 'All';
let currentGalleryPage = 1;
const PHOTOS_PER_PAGE = 12;

const CATEGORY_LABELS = {
  'Wedding': '💍 Wedding',
  'Portrait': '🎭 Portrait',
  'Event': '🎊 Event',
  'Product': '📦 Product',
};

async function loadHeroImages() {
  try {
    const heroData = await fetchJSON('/api/hero');
    buildHeroSlideshow(heroData);
  } catch(err) { console.warn('Failed to load hero images', err); }
}

async function loadGallery() {
  const grid = $('#gallery-grid');
  if (!grid) return;

  try {
    allPhotos = await fetchJSON('/api/photos');

    // Update stat
    const statPhotos = $('#stat-photos');
    if (statPhotos) animCount(statPhotos, allPhotos.length);

    // Init filter buttons
    initFilterBar();

    // Init load more button
    const btnLoadMore = $('#btn-load-more');
    if (btnLoadMore && !btnLoadMore.dataset.bound) {
      btnLoadMore.addEventListener('click', () => {
        currentGalleryPage++;
        renderGalleryPage();
      });
      btnLoadMore.dataset.bound = 'true';
    }

    applyFilter('All');
  } catch (err) {
    grid.innerHTML = `<div class="gallery-empty"><div class="gallery-empty-icon">📷</div><p>Không thể tải ảnh.</p></div>`;
    console.warn(err);
  }
}

function initFilterBar() {
  $$('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.filter-btn').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      applyFilter(btn.dataset.filter);
    });
  });
}

function applyFilter(category) {
  activeFilter = category;
  filteredPhotos = category === 'All' ? allPhotos : allPhotos.filter(p => p.category === category);
  currentGalleryPage = 1;
  const grid = $('#gallery-grid');
  if (grid) grid.innerHTML = '';
  renderGalleryPage(true);
}

function renderGalleryPage(isReset = false) {
  const grid = $('#gallery-grid');
  const loadMoreWrap = $('#load-more-wrap');
  if (!grid) return;

  if (!filteredPhotos.length) {
    grid.innerHTML = `<div class="gallery-empty" style="text-align:center;padding:4rem;width:100%;">
      <div class="gallery-empty-icon">📷</div>
      <p>Không có ảnh trong danh mục này</p>
    </div>`;
    if (loadMoreWrap) loadMoreWrap.style.display = 'none';
    return;
  }

  const start = (currentGalleryPage - 1) * PHOTOS_PER_PAGE;
  const end = start + PHOTOS_PER_PAGE;
  const pagePhotos = filteredPhotos.slice(start, end);

  if (isReset) grid.innerHTML = '';

  pagePhotos.forEach((photo, i) => {
    const card = createPhotoCard(photo, start + i);
    grid.appendChild(card);
  });

  // Re-observe cursor hover for new cards
  $$('.photo-card').forEach(el => {
    el.addEventListener('mouseenter', () => document.body.classList.add('cursor-hover'));
    el.addEventListener('mouseleave', () => document.body.classList.remove('cursor-hover'));
  });

  if (loadMoreWrap) {
    loadMoreWrap.style.display = end < filteredPhotos.length ? 'block' : 'none';
  }
}

function createPhotoCard(photo, index) {
  const card = document.createElement('div');
  card.className = 'photo-card';
  card.style.animationDelay = `${Math.min(index * 0.06, 0.5)}s`;
  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'button');
  card.setAttribute('aria-label', photo.title);

  const catLabel = photo.category;

  card.innerHTML = `
    ${photo.featured ? '<div class="photo-featured-badge">⭐ Featured</div>' : ''}
    <div class="photo-zoom-icon">🔍</div>
    ${photo.image_url
      ? `<img src="${photo.image_url}" alt="${photo.title}" loading="lazy" />`
      : `<div class="photo-placeholder">📷</div>`
    }
    <div class="photo-overlay">
      <span class="photo-cat">${catLabel}</span>
      <div class="photo-title-overlay">${photo.title}</div>
    </div>
  `;

  const open = () => {
    if (photo.detail_images && photo.detail_images.length > 0) openProjectModal(photo);
    else openLightbox(filteredPhotos.indexOf(photo));
  };
  card.addEventListener('click', open);
  card.addEventListener('keypress', e => { if (e.key === 'Enter') open(); });

  return card;
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
let lbIndex = 0;

function openLightbox(index) {
  lbIndex = index;
  showLightboxPhoto(lbIndex);
  $('#lightbox')?.classList.add('open');
  $('#lb-backdrop')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  $('#lightbox')?.classList.remove('open');
  $('#lb-backdrop')?.classList.remove('open');
  document.body.style.overflow = '';
}

function showLightboxPhoto(idx) {
  if (!filteredPhotos.length) return;
  lbIndex = ((idx % filteredPhotos.length) + filteredPhotos.length) % filteredPhotos.length;
  const photo = filteredPhotos[lbIndex];

  const img = $('#lb-img');
  const loader = $('.lb-loader');
  if (!img) return;

  // Show loader
  img.style.opacity = '0';
  loader?.classList.add('visible');

  img.onload = () => {
    img.style.opacity = '1';
    loader?.classList.remove('visible');
    img.style.animation = 'none';
    img.offsetHeight; // reflow
    img.style.animation = 'lbIn .35s cubic-bezier(0.34, 1.56, 0.64, 1)';
  };
  img.src = photo.image_url || '';
  img.alt = photo.title;

  $('#lb-category').textContent = photo.category || '';
  $('#lb-title').textContent = photo.title || '';
  $('#lb-desc').textContent = photo.description || '';
  $('#lb-counter').textContent = `${lbIndex + 1} / ${filteredPhotos.length}`;

  const meta = [];
  if (photo.location) meta.push(`📍 ${photo.location}`);
  if (photo.shoot_date) meta.push(`📅 ${photo.shoot_date}`);
  $('#lb-meta').textContent = meta.join('  ·  ');

  // Nav buttons
  const prevBtn = $('#lb-prev');
  const nextBtn = $('#lb-next');
  if (prevBtn) prevBtn.disabled = filteredPhotos.length <= 1;
  if (nextBtn) nextBtn.disabled = filteredPhotos.length <= 1;
}

function initLightbox() {
  $('#lb-close')?.addEventListener('click', closeLightbox);
  $('#lb-backdrop')?.addEventListener('click', closeLightbox);
  $('#lb-prev')?.addEventListener('click', () => showLightboxPhoto(lbIndex - 1));
  $('#lb-next')?.addEventListener('click', () => showLightboxPhoto(lbIndex + 1));

  document.addEventListener('keydown', (e) => {
    if (!$('#lightbox')?.classList.contains('open')) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') showLightboxPhoto(lbIndex - 1);
    if (e.key === 'ArrowRight') showLightboxPhoto(lbIndex + 1);
  });

  // Swipe support
  let startX = 0;
  $('#lightbox')?.addEventListener('touchstart', e => { startX = e.changedTouches[0].screenX; }, { passive: true });
  $('#lightbox')?.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].screenX - startX;
    if (Math.abs(dx) > 50) showLightboxPhoto(dx > 0 ? lbIndex - 1 : lbIndex + 1);
  });
}

// ─── Services ─────────────────────────────────────────────────────────────────
async function loadServices() {
  const grid = $('#services-grid');
  if (!grid) return;
  try {
    const services = await fetchJSON('/api/services');
    if (!services.length) { grid.innerHTML = ''; return; }
    grid.innerHTML = '';
    services.forEach(s => {
      const card = document.createElement('div');
      card.className = 'service-card reveal-up';
      card.innerHTML = `
        <span class="service-icon">${s.icon || '📷'}</span>
        <div class="service-name">${s.name}</div>
        <p class="service-desc">${s.description || ''}</p>
        <span class="service-arrow">Tìm hiểu thêm →</span>
      `;
      grid.appendChild(card);
    });
    initReveal();
  } catch (err) { console.warn('Services:', err); }
}

// ─── About ────────────────────────────────────────────────────────────────────
async function loadAbout() {
  try {
    const data = await fetchJSON('/api/about');
    if (!data) return;

    if (data.name) {
      [['#hero-name'], ['#about-name-display'], ['#footer-name']].forEach(([sel]) => {
        const el = $(sel);
        if (el) el.textContent = data.name;
      });
      document.title = `${data.name} | Photography`;
    }
    if (data.title) {
      const el = $('#about-title-display');
      if (el) el.textContent = data.title;
    }
    if (data.bio) {
      const el = $('#about-bio-display');
      if (el) el.textContent = data.bio;
    }
    // Avatar
    const img = $('#about-portrait-img');
    const ph  = $('#about-portrait-ph');
    if (img && data.avatar_url) {
      img.src = data.avatar_url;
      img.style.display = 'block';
      if (ph) ph.style.display = 'none';
    }
    // Social
    if (data.instagram) { 
      [$('#about-insta'), $('#c-insta'), $('#f-insta')].forEach(el => { if(el) el.href = data.instagram; }); 
    }
    if (data.facebook)  { 
      [$('#about-fb'), $('#c-fb'), $('#f-fb')].forEach(el => { if(el) el.href = data.facebook; }); 
    }
    if (data.email) {
      [$('#about-email'), $('#c-email'), $('#f-email')].forEach(el => { if(el) el.href = `mailto:${data.email}`; }); 
      if ($('#c-email-val')) $('#c-email-val').textContent = data.email;
    }
    if (data.phone) {
      $('#c-phone').href = `tel:${data.phone.replace(/\s/g,'')}`;
      $('#c-phone-val').textContent = data.phone;
    }

  } catch (err) { console.warn('About:', err); }
}

// ─── Scroll Reveal ────────────────────────────────────────────────────────────
const revealObs = new IntersectionObserver((entries) => {
  entries.forEach((e, i) => {
    if (e.isIntersecting) {
      setTimeout(() => e.target.classList.add('visible'), i * 80);
      revealObs.unobserve(e.target);
    }
  });
}, { threshold: 0.1 });

function initReveal() {
  $$('.reveal-up, .reveal-left, .reveal-right').forEach(el => {
    if (!el.classList.contains('visible')) revealObs.observe(el);
  });
}

// ─── Counter animation ────────────────────────────────────────────────────────
function animCount(el, target, duration = 1500) {
  const start = performance.now();
  const update = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.floor(eased * target) + (target >= 100 ? '+' : '');
    if (p < 1) requestAnimationFrame(update);
    else el.textContent = target + (target >= 100 ? '+' : '');
  };
  requestAnimationFrame(update);
}

// ─── Stats counter ────────────────────────────────────────────────────────────
function initStatCounters() {
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => {
      if (e.isIntersecting) {
        const count = parseInt(e.target.textContent);
        if (!isNaN(count)) animCount(e.target, count);
        obs.unobserve(e.target);
      }
    });
  }, { threshold: 0.5 });
  $$('.stat-num').forEach(el => obs.observe(el));
}

// ─── Fetch JSON helper ────────────────────────────────────────────────────────
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ─── Footer Year ─────────────────────────────────────────────────────────────
function initFooterYear() {
  const el = $('#footer-year');
  if (el) el.textContent = new Date().getFullYear();
}

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  initCursor();
  initNavbar();
  initLightbox();
  initProjectModal();
  initFooterYear();
  initStatCounters();

  // Add hero reveal delay classes
  $$('.hero-content .reveal-up').forEach((el, i) => {
    el.style.transitionDelay = `${(i * 0.15) + 0.2}s`;
    setTimeout(() => el.classList.add('visible'), (i * 150) + 900);
  });

  await Promise.allSettled([loadAbout(), loadGallery(), loadServices(), loadHeroImages()]);
  initReveal();
}

document.addEventListener('DOMContentLoaded', init);

// ─── Project Detail Modal ─────────────────────────────────────────────────────
function initProjectModal() {
  $('#pm-close')?.addEventListener('click', closeProjectModal);
  $('#project-modal')?.addEventListener('click', e => {
    if (e.target.id === 'project-modal') closeProjectModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.getElementById('project-modal')?.classList.contains('open')) {
      closeProjectModal();
    }
  });
}

function openProjectModal(photo) {
  const modal = $('#project-modal');
  if (!modal) return;
  
  $('#pm-category').textContent = photo.category || '';
  $('#pm-title').textContent = photo.title || '';
  $('#pm-desc').textContent = photo.description || '';
  
  const loc = photo.location ? photo.location : '';
  const dt = photo.shoot_date ? new Date(photo.shoot_date).toLocaleDateString('vi-VN') : '';
  const meta = [loc, dt].filter(Boolean).join(' • ');
  $('#pm-meta').textContent = meta;
  
  const masonry = $('#pm-masonry');
  masonry.innerHTML = '';
  
  const allImgs = [];
  if (photo.image_url) allImgs.push(photo.image_url);
  if (Array.isArray(photo.detail_images)) allImgs.push(...photo.detail_images);
  
  allImgs.forEach((src, idx) => {
    const img = document.createElement('img');
    img.src = src;
    img.alt = `${photo.title} ${idx + 1}`;
    img.loading = 'lazy';
    img.onload = () => img.classList.add('loaded');
    masonry.appendChild(img);
  });
  
  modal.scrollTop = 0;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeProjectModal() {
  $('#project-modal')?.classList.remove('open');
  if (!$('#lightbox')?.classList.contains('open')) document.body.style.overflow = '';
}

