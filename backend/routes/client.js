const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const { Readable } = require('stream');
const db = require('../db/database');

const JWT_SECRET = process.env.JWT_SECRET || 'portfolio_secret';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const DRIVE_API_KEY = process.env.DRIVE_API_KEY;

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);

// ─── Helper: tạo session token và redirect ───────────────────────────────────
async function createSessionAndRedirect(res, email, name, picture) {
  const token = jwt.sign({ email, name, picture }, JWT_SECRET + '_client', { expiresIn: '7d' });
  // Redirect về client portal với token trong URL hash (không lưu server log)
  res.redirect(`/client#token=${token}`);
}

// ─── GET /api/client/auth/google ─────────────────────────────────────────────
// Bắt đầu luồng OAuth — redirect sang Google
router.get('/auth/google', (req, res) => {
  const redirectUri = `${req.protocol}://${req.get('host')}/api/client/auth/google/callback`;
  const scope = 'openid email profile';
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${GOOGLE_CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}` +
    `&access_type=online` +
    `&prompt=select_account`;
  res.redirect(authUrl);
});

// ─── GET /api/client/auth/google/callback ─────────────────────────────────────
// Google redirect về đây sau khi user đồng ý
router.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) {
    return res.redirect('/client?error=auth_failed');
  }
  try {
    const redirectUri = `${req.protocol}://${req.get('host')}/api/client/auth/google/callback`;
    // Đổi code lấy tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.id_token) throw new Error('No id_token received');

    // Xác thực id_token
    const ticket = await googleClient.verifyIdToken({
      idToken: tokenData.id_token,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, name, picture } = payload;
    await createSessionAndRedirect(res, email, name, picture);
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.redirect('/client?error=auth_failed');
  }
});


// ─── Middleware: Xác thực client JWT ─────────────────────────────────────────
function clientAuth(req, res, next) {
  // Accept token from Authorization header OR ?token= query param (for direct download links)
  const auth = req.headers.authorization;
  const queryToken = req.query.token;
  const rawToken = (auth && auth.startsWith('Bearer ')) ? auth.slice(7) : queryToken;
  if (!rawToken) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const decoded = jwt.verify(rawToken, JWT_SECRET + '_client');
    req.clientUser = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── POST /api/client/auth ────────────────────────────────────────────────────
// Nhận Google ID token từ public_html, xác thực và trả về JWT của riêng mình
router.post('/auth', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing credential' });

    // Xác thực token Google
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    // Kiểm tra email có được phép xem album nào không
    const albumCount = await db.getAsync(
      'SELECT COUNT(*) as c FROM client_albums WHERE LOWER(client_email) = LOWER(?)',
      [email]
    );

    // Tạo JWT của hệ thống cho client
    const token = jwt.sign({ email, name, picture }, JWT_SECRET + '_client', { expiresIn: '7d' });

    res.json({
      token,
      user: { email, name, picture },
      has_albums: albumCount.c > 0
    });
  } catch (err) {
    console.error('Client auth error:', err.message);
    res.status(401).json({ error: 'Google authentication failed: ' + err.message });
  }
});

// ─── GET /api/client/me ────────────────────────────────────────────────────────
// Trả về thông tin user từ token
router.get('/me', clientAuth, (req, res) => {
  res.json({ user: req.clientUser });
});

// ─── GET /api/client/albums ───────────────────────────────────────────────────
router.get('/albums', clientAuth, async (req, res) => {
  try {
    const allAlbums = await db.allAsync(
      'SELECT id, title, description, cover_image, created_at, client_email, is_public, status FROM client_albums ORDER BY created_at DESC'
    );
    const email = req.clientUser.email.toLowerCase();

    // Get this user's access requests
    const userRequests = await db.allAsync(
      'SELECT album_id, status FROM access_requests WHERE LOWER(email) = LOWER(?)',
      [email]
    );
    const requestMap = {};
    userRequests.forEach(r => { requestMap[r.album_id] = r.status; });

    const queryAlbumId = req.query.album;

    const albums = allAlbums.map(a => {
      const emailList = a.client_email
        ? a.client_email.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
        : [];
      const emailMatch = emailList.includes(email);
      const hasAccess = !!(a.is_public || emailMatch);
      const { client_email, ...rest } = a;
      return {
        ...rest,
        // We evaluate 'emailMatch' directly on 'a' for mapping, and keep 'has_access' logic
        has_access: hasAccess,
        request_status: hasAccess ? null : (requestMap[a.id] || null)
      };
    }).filter(a => {
      // Find the original DB record to extract emailMatch again
      const original = allAlbums.find(x => x.id === a.id);
      const emailList = original.client_email
        ? original.client_email.split(',').map(e => e.trim().toLowerCase()).filter(Boolean)
        : [];
      const emailMatch = emailList.includes(email);
      const requested = requestMap[a.id];
      const isSharedViaQuery = queryAlbumId && String(a.id) === String(queryAlbumId);
      
      // Keep only if explicitly mapped to email, or previously requested/interacted with, or explicitly opening URL
      return emailMatch || requested || isSharedViaQuery;
    });

    res.json(albums);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/client/albums/:id/photos ───────────────────────────────────────
// Lấy danh sách ảnh từ Google Drive folder của album đó
router.get('/albums/:id/photos', clientAuth, async (req, res) => {
  try {
    // Kiểm tra album có cho phép email này truy cập không
    const album = await db.getAsync('SELECT * FROM client_albums WHERE id = ?', [req.params.id]);
    if (!album) return res.status(403).json({ error: 'Album not found.' });
    const userEmail = req.clientUser.email.toLowerCase();
    const allowed = album.is_public ||
      (album.client_email ? album.client_email.split(',').map(e => e.trim()).includes(userEmail) : false);
    if (!allowed) return res.status(403).json({ error: 'Access denied.' });

    // 🔔 Create admin notification for album view (throttle to once per hour per user)
    const existingNotif = await db.getAsync(
      "SELECT id FROM notifications WHERE type = 'view' AND album_id = ? AND email = ? AND created_at > datetime('now', '-1 hour')",
      [req.params.id, userEmail]
    );

    if (!existingNotif) {
      const msg = `đã truy cập vào album`;
      await db.runAsync(
        'INSERT INTO notifications (type, album_id, album_title, email, name, message) VALUES (?,?,?,?,?,?)',
        ['view', req.params.id, album.title, userEmail, req.clientUser.name || '', msg]
      );
    }

    // Gọi Google Drive API để lấy TOÀN BỘ danh sách ảnh trong folder (có phân trang)
    const folderId = album.drive_folder_id;
    let allFiles = [];
    let pageToken = '';

    do {
      const driveUrl = `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+mimeType+contains+'image/'&key=${DRIVE_API_KEY}&fields=nextPageToken,files(id,name,mimeType,thumbnailLink,imageMediaMetadata,createdTime,size)&pageSize=1000${pageToken ? '&pageToken=' + pageToken : ''}`;
      
      const fetchResponse = await fetch(driveUrl);
      if (!fetchResponse.ok) {
        const errText = await fetchResponse.text();
        throw new Error('Drive API error: ' + errText);
      }
      const driveData = await fetchResponse.json();
      if (driveData.files && driveData.files.length) {
        allFiles.push(...driveData.files);
      }
      pageToken = driveData.nextPageToken;
    } while (pageToken);

    // Chuyển đổi thành định dạng phù hợp cho public_html
    const photos = allFiles.map(file => {
      // Đảm bảo tên file luôn có extension đúng (một số file Drive không có extension)
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
        name,
        thumbnail: `https://lh3.googleusercontent.com/d/${file.id}=w800`,
        url: `https://lh3.googleusercontent.com/d/${file.id}=w3000`,
        createdTime: file.createdTime || null,  // thời gian upload
        size: file.size ? parseInt(file.size) : null, // dung lượng byte
      };
    });

    res.json({ album, photos });
  } catch (err) {
    console.error('Drive fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/client/albums/:id/download-file ─────────────────────────────────
// Proxy tải ảnh từ lh3.googleusercontent.com (=s0 = chất lượng gốc) về client
router.get('/albums/:id/download-file', clientAuth, async (req, res) => {
  try {
    const album = await db.getAsync('SELECT * FROM client_albums WHERE id = ?', [req.params.id]);
    if (!album) return res.status(404).json({ error: 'Album not found.' });
    const userEmail = req.clientUser.email.toLowerCase();
    const allowed = album.is_public ||
      (album.client_email ? album.client_email.split(',').map(e => e.trim().toLowerCase()).includes(userEmail) : false);
    if (!allowed) return res.status(403).json({ error: 'Access denied.' });

    const { fileId, fileName } = req.query;
    if (!fileId) return res.status(400).json({ error: 'fileId is required.' });

    // Dùng lh3.googleusercontent.com với =s0 — chất lượng gốc, không cần OAuth
    // Đây là cùng CDN đang serve thumbnail của app, chắc chắn accessible
    const lh3Url = `https://lh3.googleusercontent.com/d/${fileId}=s0`;
    const lh3Res = await fetch(lh3Url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': 'https://drive.google.com/'
      }
    });

    if (!lh3Res.ok) {
      throw new Error(`lh3 error ${lh3Res.status}`);
    }

    const contentType = lh3Res.headers.get('content-type') || 'image/jpeg';
    const contentLength = lh3Res.headers.get('content-length');

    // Đảm bảo tên file có đúng extension
    let safeFileName = (fileName || fileId).replace(/[^a-zA-Z0-9._\- ()]/g, '_');
    if (!safeFileName.match(/\.(jpg|jpeg|png|gif|webp|heic|raw|tif|tiff)$/i)) {
      const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
      safeFileName += ext;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${safeFileName}"`);
    if (contentLength) res.setHeader('Content-Length', contentLength);

    // Stream ảnh về client (Readable.fromWeb vì Node 18+ fetch trả về Web ReadableStream)
    Readable.fromWeb(lh3Res.body).pipe(res);
  } catch (err) {
    console.error('Download proxy error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});


// ─── POST /api/client/albums/:id/request-access ─────────────────────────────────
router.post('/albums/:id/request-access', clientAuth, async (req, res) => {
  try {
    const album = await db.getAsync('SELECT * FROM client_albums WHERE id = ?', [req.params.id]);
    if (!album) return res.status(404).json({ error: 'Album not found.' });
    const userEmail = req.clientUser.email.toLowerCase();
    // Check if already has access
    const hasAccess = album.is_public ||
      (album.client_email ? album.client_email.split(',').map(e => e.trim()).includes(userEmail) : false);
    if (hasAccess) return res.status(400).json({ error: 'Bạn đã có quyền truy cập album này.' });
    // Check if already requested
    const existing = await db.getAsync(
      'SELECT * FROM access_requests WHERE album_id = ? AND LOWER(email) = LOWER(?)',
      [req.params.id, userEmail]
    );
    if (existing) {
      if (existing.status === 'pending') return res.json({ status: 'pending', message: 'Đã gửi yêu cầu, đang chờ phê duyệt.' });
      if (existing.status === 'rejected') {
        // Allow re-request
        await db.runAsync('UPDATE access_requests SET status=?, created_at=CURRENT_TIMESTAMP WHERE id=?', ['pending', existing.id]);
        return res.json({ status: 'pending', message: 'Yêu cầu đã được gửi lại.' });
      }
    }
    await db.runAsync(
      'INSERT INTO access_requests (album_id, email, name, status) VALUES (?,?,?,?)',
      [req.params.id, userEmail, req.clientUser.name || '', 'pending']
    );
    res.json({ status: 'pending', message: 'Yêu cầu đã được gửi!' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── POST /api/client/albums/:id/submit ───────────────────────────────────────
router.post('/albums/:id/submit', clientAuth, async (req, res) => {
  try {
    const album = await db.getAsync('SELECT * FROM client_albums WHERE id = ?', [req.params.id]);
    if (!album) return res.status(404).json({ error: 'Album not found.' });
    const userEmail = req.clientUser.email.toLowerCase();
    const allowed = album.is_public ||
      (album.client_email ? album.client_email.split(',').map(e => e.trim().toLowerCase()).includes(userEmail) : false);
    if (!allowed) return res.status(403).json({ error: 'Access denied.' });

    const { selected_photos, later_photos } = req.body;
    if (!Array.isArray(selected_photos)) {
      return res.status(400).json({ error: 'selected_photos must be an array.' });
    }

    const selectionData = JSON.stringify({
      submitted_by: userEmail,
      submitted_at: new Date().toISOString(),
      photos: selected_photos,
      later_photos: later_photos || [],
      count: selected_photos.length
    });

    await db.runAsync(
      'UPDATE client_albums SET last_selection=?, status=? WHERE id=?',
      [selectionData, 'selected', req.params.id]
    );

    // 🔔 Create admin notification
    const commentedPhotos = selected_photos.filter(p => p.comment && p.comment.trim());
    const msg = `Đã chọn ${selected_photos.length} ảnh${commentedPhotos.length ? ` và ghi chú ${commentedPhotos.length} ảnh` : ''}.`;
    await db.runAsync(
      'INSERT INTO notifications (type, album_id, album_title, email, name, message) VALUES (?,?,?,?,?,?)',
      ['selection', req.params.id, album.title, userEmail, req.clientUser.name || '', msg]
    );

    res.json({ success: true, count: selected_photos.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/client/albums/:id/comment ──────────────────────────────────────
// Client để lại ghi chú/yêu cầu chỉnh sửa cho một ảnh
router.post('/albums/:id/comment', clientAuth, async (req, res) => {
  try {
    const album = await db.getAsync('SELECT * FROM client_albums WHERE id = ?', [req.params.id]);
    if (!album) return res.status(404).json({ error: 'Album not found.' });
    const userEmail = req.clientUser.email.toLowerCase();
    const allowed = album.is_public ||
      (album.client_email ? album.client_email.split(',').map(e => e.trim().toLowerCase()).includes(userEmail) : false);
    if (!allowed) return res.status(403).json({ error: 'Access denied.' });

    const { photo_id, photo_name, comment } = req.body;
    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: 'Comment is required.' });
    }

    const msg = `📸 ${photo_name || 'Ảnh #' + photo_id}: "${comment.trim()}"`;
    await db.runAsync(
      'INSERT INTO notifications (type, album_id, album_title, email, name, message) VALUES (?,?,?,?,?,?)',
      ['comment', req.params.id, album.title, userEmail, req.clientUser.name || '', msg]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.clientAuth = clientAuth;
