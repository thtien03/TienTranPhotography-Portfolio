require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust First Proxy (Hostinger Nginx Proxy)
app.set('trust proxy', 1);

// ─── Middleware ───────────────────────────────────────────────────────────────
// Security headers
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));
// GZIP compression
app.use(compression());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Static Files ─────────────────────────────────────────────────────────────
const FRONTEND_DIR = path.join(__dirname, '..', 'public_html');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

// Ensure uploads dir exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Chiến lược Cache Tĩnh: Sủ dụng ETags (Xác nhận thay đổi) thay vì nhớ chết 1 năm.
// Trình duyệt sẽ luôn hỏi Server file có mới không, nếu không đổi sẽ dùng Cache gốc.
const staticOptions = { 
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  }
};

app.use(express.static(FRONTEND_DIR, staticOptions));
app.use('/uploads', express.static(UPLOADS_DIR, staticOptions));

// ─── API Routes ───────────────────────────────────────────────────────────────
const apiRoutes = require('./routes/api');
const adminRoutes = require('./routes/admin');
const clientRoutes = require('./routes/client');

app.use('/api', apiRoutes);
app.use('/api/admin/login', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 phút
  max: 5, // Tối đa 5 lần
  message: { error: 'Đăng nhập sai quá 5 lần. Vui lòng thử lại sau 15 phút để bảo vệ hệ thống.' }
}));
app.use('/api/admin', adminRoutes);
app.use('/api/client', clientRoutes);

// ─── Admin SPA fallback ───────────────────────────────────────────────────────
app.get('/admin', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'admin', 'index.html'));
});

app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'admin', 'index.html'));
});

// ─── Client Portal fallback ───────────────────────────────────────────────────
app.get('/client', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'client', 'index.html'));
});

app.get('/client/*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'client', 'index.html'));
});


// ─── Catch-all → Portfolio ─────────────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Portfolio server running at http://localhost:${PORT}`);
  console.log(`📁 Admin panel: http://localhost:${PORT}/admin`);
  console.log(`🔑 Default login: admin / admin123\n`);
});
