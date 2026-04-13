const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db/database');
const auth = require('../middleware/auth');
const sharp = require('sharp');

const JWT_SECRET = process.env.JWT_SECRET || 'portfolio_secret';

// ─── Multer ───────────────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (/jpeg|jpg|png|gif|webp|svg/.test(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only image files allowed!'));
  },
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB to allow large original hero shots
});

// ─── Auth ─────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
    const user = await db.getAsync('SELECT * FROM admin_users WHERE username = ?', [username]);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Invalid credentials.' });
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, username: user.username });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/verify', auth, (req, res) => res.json({ valid: true, user: req.user }));

// ─── Upload ───────────────────────────────────────────────────────────────────
router.post('/upload', auth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });

  try {
    const ext = path.extname(req.file.originalname).toLowerCase();
    const isSvg = ext === '.svg';
    const isGif = ext === '.gif';
    let finalFilename = req.file.filename;

    // Không nén svg hoặc gif
    if (!isSvg && !isGif) {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      finalFilename = uniqueSuffix + '.webp';
      const outputFilePath = path.join(UPLOADS_DIR, finalFilename);

      await sharp(req.file.path)
        .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 })
        .toFile(outputFilePath);

      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    }

    res.json({ url: `/uploads/${finalFilename}`, filename: finalFilename });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Sharp upload err:', error);
    res.status(500).json({ error: 'Failed to process image: ' + error.message });
  }
});

// ─── Upload Hero (Bypass compression completely — perfect quality + no OOM crash) ───
router.post('/upload-hero', auth, upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded.' });
  try {
    // Keep the exact original file from Multer for Hero background
    const finalFilename = req.file.filename;
    res.json({ url: `/uploads/${finalFilename}`, filename: finalFilename });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error('Bypass hero upload err:', error);
    res.status(500).json({ error: 'Failed to process hero image: ' + error.message });
  }
});

router.delete('/upload/:filename', auth, (req, res) => {
  try {
    const filePath = path.join(UPLOADS_DIR, req.params.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Photos CRUD ──────────────────────────────────────────────────────────────
router.get('/photos', auth, async (req, res) => {
  try {
    const photos = await db.allAsync('SELECT * FROM photos ORDER BY order_index ASC, created_at DESC');
    res.json(photos.map(p => ({ 
      ...p, 
      tags: JSON.parse(p.tags || '[]'),
      detail_images: JSON.parse(p.detail_images || '[]')
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/photos', auth, async (req, res) => {
  try {
    const { title, description, category, image_url, detail_images, location, shoot_date, tags, order_index, visible, featured } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required.' });
    const result = await db.runAsync(
      `INSERT INTO photos (title, description, category, image_url, detail_images, location, shoot_date, tags, order_index, visible, featured)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [title, description || '', category || 'Wedding', image_url || '', JSON.stringify(detail_images || []), location || '',
       shoot_date || '', JSON.stringify(tags || []), order_index || 0,
       visible !== undefined ? (visible ? 1 : 0) : 1, featured ? 1 : 0]
    );
    const newPhoto = await db.getAsync('SELECT * FROM photos WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ ...newPhoto, tags: JSON.parse(newPhoto.tags || '[]'), detail_images: JSON.parse(newPhoto.detail_images || '[]') });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/photos/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const existing = await db.getAsync('SELECT * FROM photos WHERE id = ?', [id]);
    if (!existing) return res.status(404).json({ error: 'Photo not found.' });
    const { title, description, category, image_url, detail_images, location, shoot_date, tags, order_index, visible, featured } = req.body;
    await db.runAsync(
      `UPDATE photos SET title=?, description=?, category=?, image_url=?, detail_images=?, location=?, shoot_date=?,
       tags=?, order_index=?, visible=?, featured=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      [
        title || existing.title,
        description !== undefined ? description : existing.description,
        category || existing.category,
        image_url !== undefined ? image_url : existing.image_url,
        JSON.stringify(detail_images || JSON.parse(existing.detail_images || '[]')),
        location !== undefined ? location : existing.location,
        shoot_date !== undefined ? shoot_date : existing.shoot_date,
        JSON.stringify(tags || JSON.parse(existing.tags || '[]')),
        order_index !== undefined ? order_index : existing.order_index,
        visible !== undefined ? (visible ? 1 : 0) : existing.visible,
        featured !== undefined ? (featured ? 1 : 0) : existing.featured,
        id
      ]
    );
    const updated = await db.getAsync('SELECT * FROM photos WHERE id = ?', [id]);
    res.json({ ...updated, tags: JSON.parse(updated.tags || '[]'), detail_images: JSON.parse(updated.detail_images || '[]') });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/photos/:id', auth, async (req, res) => {
  try {
    const existing = await db.getAsync('SELECT * FROM photos WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Photo not found.' });
    await db.runAsync('DELETE FROM photos WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/photos/:id/toggle', auth, async (req, res) => {
  try {
    const photo = await db.getAsync('SELECT * FROM photos WHERE id = ?', [req.params.id]);
    if (!photo) return res.status(404).json({ error: 'Photo not found.' });
    await db.runAsync('UPDATE photos SET visible = ? WHERE id = ?', [photo.visible ? 0 : 1, req.params.id]);
    res.json({ visible: !photo.visible });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── About ────────────────────────────────────────────────────────────────────
router.get('/about', auth, async (req, res) => {
  try {
    const about = await db.getAsync('SELECT * FROM about LIMIT 1');
    res.json(about || {});
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/about', auth, async (req, res) => {
  try {
    const { name, title, bio, avatar_url, email, instagram, facebook, phone, resume_url } = req.body;
    const existing = await db.getAsync('SELECT * FROM about LIMIT 1');
    if (existing) {
      await db.runAsync(
        `UPDATE about SET name=?, title=?, bio=?, avatar_url=?, email=?, instagram=?, facebook=?, phone=?, resume_url=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`,
        [name||existing.name, title||existing.title,
         bio!==undefined?bio:existing.bio,
         avatar_url!==undefined?avatar_url:existing.avatar_url,
         email||existing.email,
         instagram!==undefined?instagram:existing.instagram,
         facebook!==undefined?facebook:existing.facebook,
         phone!==undefined?phone:existing.phone,
         resume_url!==undefined?resume_url:existing.resume_url,
         existing.id]
      );
    } else {
      await db.runAsync(
        `INSERT INTO about (name, title, bio, avatar_url, email, instagram, facebook, phone, resume_url) VALUES (?,?,?,?,?,?,?,?,?)`,
        [name, title, bio, avatar_url, email, instagram, facebook, phone, resume_url]
      );
    }
    const updated = await db.getAsync('SELECT * FROM about LIMIT 1');
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Categories ───────────────────────────────────────────────────────────────
router.get('/categories', auth, async (req, res) => {
  try {
    const categories = await db.allAsync('SELECT * FROM categories ORDER BY order_index ASC');
    res.json(categories);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/categories/:identifier/toggle', auth, async (req, res) => {
  try {
    const existing = await db.getAsync('SELECT * FROM categories WHERE identifier = ?', [req.params.identifier]);
    if (!existing) return res.status(404).json({ error: 'Category not found.' });
    if (existing.identifier === 'All') return res.status(400).json({ error: 'Không thể ẩn danh mục Tất cả.' });
    
    const newVisible = existing.visible ? 0 : 1;
    await db.runAsync('UPDATE categories SET visible = ? WHERE identifier = ?', [newVisible, req.params.identifier]);
    res.json({ success: true, visible: newVisible });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Services ─────────────────────────────────────────────────────────────────
router.get('/services', auth, async (req, res) => {
  try {
    const services = await db.allAsync('SELECT * FROM services ORDER BY order_index ASC');
    res.json(services);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/services', auth, async (req, res) => {
  try {
    const { name, icon, description, order_index } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required.' });
    const result = await db.runAsync(
      'INSERT INTO services (name, icon, description, order_index) VALUES (?,?,?,?)',
      [name, icon||'📷', description||'', order_index||0]
    );
    const service = await db.getAsync('SELECT * FROM services WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(service);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/services/:id', auth, async (req, res) => {
  try {
    const existing = await db.getAsync('SELECT * FROM services WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Service not found.' });
    const { name, icon, description, order_index } = req.body;
    await db.runAsync(
      'UPDATE services SET name=?, icon=?, description=?, order_index=? WHERE id=?',
      [name||existing.name, icon!==undefined?icon:existing.icon,
       description!==undefined?description:existing.description,
       order_index!==undefined?order_index:existing.order_index, req.params.id]
    );
    const updated = await db.getAsync('SELECT * FROM services WHERE id = ?', [req.params.id]);
    res.json(updated);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/services/:id', auth, async (req, res) => {
  try {
    const existing = await db.getAsync('SELECT * FROM services WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Service not found.' });
    await db.runAsync('DELETE FROM services WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Change Password ──────────────────────────────────────────────────────────
router.put('/change-password', auth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await db.getAsync('SELECT * FROM admin_users WHERE id = ?', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    if (!bcrypt.compareSync(currentPassword, user.password_hash)) return res.status(401).json({ error: 'Current password is incorrect.' });
    await db.runAsync('UPDATE admin_users SET password_hash = ? WHERE id = ?', [bcrypt.hashSync(newPassword, 10), user.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Hero / Background Images ──────────────────────────────────────────────────
router.get('/hero', auth, async (req, res) => {
  try {
    const heroImages = await db.allAsync('SELECT * FROM hero_images ORDER BY order_index ASC, created_at DESC');
    res.json(heroImages);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/hero', auth, async (req, res) => {
  try {
    const { image_url, caption, order_index } = req.body;
    if (!image_url) return res.status(400).json({ error: 'Image URL is required' });
    const result = await db.runAsync(
      'INSERT INTO hero_images (image_url, caption, order_index) VALUES (?,?,?)',
      [image_url, caption || '', order_index || 0]
    );
    const newHero = await db.getAsync('SELECT * FROM hero_images WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json(newHero);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/hero/:id', auth, async (req, res) => {
  try {
    const existing = await db.getAsync('SELECT * FROM hero_images WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Hero image not found.' });
    await db.runAsync('DELETE FROM hero_images WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/hero/reorder', auth, async (req, res) => {
  try {
    const { items } = req.body; // array of {id, order_index}
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Invalid payload' });
    for (let item of items) {
      await db.runAsync('UPDATE hero_images SET order_index = ? WHERE id = ?', [item.order_index, item.id]);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Client Albums (Admin quản lý) ───────────────────────────────────────────
// Helper: chuẩn hóa danh sách email từ string hoặc array
function normalizeEmails(raw) {
  if (!raw) return '';
  const arr = Array.isArray(raw) ? raw : String(raw).split(',');
  return arr.map(e => e.trim().toLowerCase()).filter(Boolean).join(',');
}

router.get('/client-albums', auth, async (req, res) => {
  try {
    const albums = await db.allAsync('SELECT * FROM client_albums ORDER BY created_at DESC');
    res.json(albums.map(a => ({
      ...a,
      client_emails: a.client_email ? a.client_email.split(',').filter(Boolean) : []
    })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/client-albums', auth, async (req, res) => {
  try {
    const { client_emails, client_name, title, description, drive_folder_id, cover_image, status, is_public } = req.body;
    if (!title || !drive_folder_id) return res.status(400).json({ error: 'title và drive_folder_id là bắt buộc.' });
    let folderId = drive_folder_id;
    const match = drive_folder_id.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (match) folderId = match[1];
    const emailStr = normalizeEmails(client_emails);
    const result = await db.runAsync(
      'INSERT INTO client_albums (client_email, client_name, title, description, drive_folder_id, cover_image, status, is_public) VALUES (?,?,?,?,?,?,?,?)',
      [emailStr, client_name || '', title, description || '', folderId, cover_image || '', status || 'draft', is_public ? 1 : 0]
    );
    const album = await db.getAsync('SELECT * FROM client_albums WHERE id = ?', [result.lastInsertRowid]);
    res.status(201).json({ ...album, client_emails: album.client_email ? album.client_email.split(',').filter(Boolean) : [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/client-albums/:id', auth, async (req, res) => {
  try {
    const existing = await db.getAsync('SELECT * FROM client_albums WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Album not found.' });
    const { client_emails, client_name, title, description, drive_folder_id, cover_image, status, is_public } = req.body;
    let folderId = drive_folder_id || existing.drive_folder_id;
    const driveMatch = folderId.match(/folders\/([a-zA-Z0-9_-]+)/);
    if (driveMatch) folderId = driveMatch[1];
    const emailStr = client_emails !== undefined ? normalizeEmails(client_emails) : existing.client_email;
    await db.runAsync(
      'UPDATE client_albums SET client_email=?, client_name=?, title=?, description=?, drive_folder_id=?, cover_image=?, status=?, is_public=? WHERE id=?',
      [
        emailStr,
        client_name !== undefined ? client_name : (existing.client_name || ''),
        title || existing.title,
        description !== undefined ? description : existing.description,
        folderId,
        cover_image !== undefined ? cover_image : existing.cover_image,
        status !== undefined ? status : (existing.status || 'draft'),
        is_public !== undefined ? (is_public ? 1 : 0) : (existing.is_public || 0),
        req.params.id
      ]
    );
    const updated = await db.getAsync('SELECT * FROM client_albums WHERE id = ?', [req.params.id]);
    res.json({ ...updated, client_emails: updated.client_email ? updated.client_email.split(',').filter(Boolean) : [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/client-albums/:id', auth, async (req, res) => {
  try {
    const existing = await db.getAsync('SELECT * FROM client_albums WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'Album not found.' });
    await db.runAsync('DELETE FROM client_albums WHERE id = ?', [req.params.id]);
    await db.runAsync('DELETE FROM access_requests WHERE album_id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const DRIVE_API_KEY = process.env.DRIVE_API_KEY;

router.get('/client-albums/:id/selection', auth, async (req, res) => {
  try {
    const album = await db.getAsync('SELECT * FROM client_albums WHERE id = ?', [req.params.id]);
    if (!album) return res.status(404).json({ error: 'Album not found.' });
    
    let selection = null;
    try { selection = album.last_selection ? JSON.parse(album.last_selection) : null; } catch {}

    let allPhotos = [];
    if (album.drive_folder_id && DRIVE_API_KEY) {
      const folderId = album.drive_folder_id;
      let pageToken = '';
      do {
        const driveUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType+contains+'image/'&key=${DRIVE_API_KEY}&fields=nextPageToken,files(id,name,mimeType,thumbnailLink,imageMediaMetadata,createdTime,size)&pageSize=1000${pageToken ? '&pageToken=' + pageToken : ''}`;
        const fetchResponse = await fetch(driveUrl);
        if (fetchResponse.ok) {
          const driveData = await fetchResponse.json();
          if (driveData.files && driveData.files.length) {
            allPhotos.push(...driveData.files);
          }
          pageToken = driveData.nextPageToken;
        } else {
          pageToken = null;
        }
      } while (pageToken);
      
      // format allPhotos similar to client
      allPhotos = allPhotos.map(file => {
        let name = file.name || file.id;
        const hasExt = /\.(jpg|jpeg|png|gif|webp|heic|raw|tif|tiff)$/i.test(name);
        if (!hasExt) {
          const mime = file.mimeType || '';
          const ext = mime.includes('png') ? '.png' : mime.includes('webp') ? '.webp' :
                      mime.includes('gif') ? '.gif' : mime.includes('heic') ? '.heic' : '.jpg';
          name = name + ext;
        }
        return {
          id: file.id,
          name: name,
          thumbnail: `https://lh3.googleusercontent.com/d/${file.id}=w800`,
          url: `https://lh3.googleusercontent.com/d/${file.id}=w3000`,
          createdTime: file.createdTime || null,
          size: file.size || null
        };
      });
    }

    res.json({ album, selection, allPhotos });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Unified Notifications ────────────────────────────────────────────────────
// Returns all unread notifications (access requests + selections + comments)
router.get('/notifications', auth, async (req, res) => {
  try {
    // 1. Pending access requests
    const accessRequests = await db.allAsync(`
      SELECT ar.id, 'access_request' as type,
             ar.album_id, ca.title as album_title,
             ar.email, ar.name, '' as message,
             ar.status, ar.created_at
      FROM access_requests ar
      LEFT JOIN client_albums ca ON ca.id = ar.album_id
      WHERE ar.status = 'pending'
    `);

    // 2. Unread general notifications (selections, comments)
    const generalNotifs = await db.allAsync(`
      SELECT id, type, album_id, album_title, email, name, message,
             'unread' as status, created_at
      FROM notifications
      WHERE is_read = 0
      ORDER BY created_at DESC
    `);

    const all = [...accessRequests, ...generalNotifs]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ count: all.length, notifications: all });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mark a general notification as read
router.put('/notifications/:id/read', auth, async (req, res) => {
  try {
    await db.runAsync('UPDATE notifications SET is_read = 1 WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mark ALL notifications as read
router.post('/notifications/read-all', auth, async (req, res) => {
  try {
    await db.runAsync('UPDATE notifications SET is_read = 1');
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Access Request Management ─────────────────────────────────────────────────
router.get('/access-requests', auth, async (req, res) => {
  try {
    const requests = await db.allAsync(`
      SELECT ar.*, ca.title as album_title
      FROM access_requests ar
      LEFT JOIN client_albums ca ON ca.id = ar.album_id
      ORDER BY ar.created_at DESC
    `);
    res.json(requests);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/access-requests/:id', auth, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be approved or rejected.' });
    }
    const request = await db.getAsync('SELECT * FROM access_requests WHERE id = ?', [req.params.id]);
    if (!request) return res.status(404).json({ error: 'Request not found.' });

    await db.runAsync('UPDATE access_requests SET status = ? WHERE id = ?', [status, req.params.id]);

    if (status === 'approved') {
      const album = await db.getAsync('SELECT * FROM client_albums WHERE id = ?', [request.album_id]);
      if (album) {
        const existing = album.client_email || '';
        const emails = existing.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
        const newEmail = request.email.toLowerCase();
        if (!emails.includes(newEmail)) {
          emails.push(newEmail);
          await db.runAsync(
            'UPDATE client_albums SET client_email = ? WHERE id = ?',
            [emails.join(','), request.album_id]
          );
        }
      }
    }

    res.json({ success: true, status });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
