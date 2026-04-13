const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DB_DIR, 'portfolio.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ─── Promise-compatible wrappers ──────────────────────────────────────────────
db.runAsync = (sql, params = []) => {
  const stmt = db.prepare(sql);
  const result = stmt.run(...params);
  return Promise.resolve(result);
};
db.getAsync = (sql, params = []) => {
  const stmt = db.prepare(sql);
  const row = stmt.get(...params);
  return Promise.resolve(row);
};
db.allAsync = (sql, params = []) => {
  const stmt = db.prepare(sql);
  const rows = stmt.all(...params);
  return Promise.resolve(rows);
};

// ─── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS about (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'Your Name',
    title TEXT NOT NULL DEFAULT 'Photographer',
    bio TEXT DEFAULT '',
    avatar_url TEXT DEFAULT '',
    email TEXT DEFAULT '',
    instagram TEXT DEFAULT '',
    facebook TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    resume_url TEXT DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    category TEXT DEFAULT 'Other',
    image_url TEXT DEFAULT '',
    detail_images TEXT DEFAULT '[]',
    location TEXT DEFAULT '',
    shoot_date TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    order_index INTEGER DEFAULT 0,
    visible INTEGER DEFAULT 1,
    featured INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS services (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '',
    description TEXT DEFAULT '',
    order_index INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS admin_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS hero_images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    image_url TEXT NOT NULL,
    caption TEXT DEFAULT '',
    order_index INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS client_albums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_email TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    drive_folder_id TEXT NOT NULL,
    cover_image TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    visible INTEGER DEFAULT 1,
    order_index INTEGER DEFAULT 0
  );
`);

// ─── Auto-Seed Default Categories ─────────────────────────────────────────────
(function seedCategories() {
  try {
    const stmt = db.prepare("SELECT COUNT(*) AS c FROM categories");
    const count = stmt.get().c;
    
    if (count === 0) {
      const defaults = [
        ['All', 'Tất Cả', 1, 0],
        ['Wedding', 'Cưới Hỏi', 1, 1],
        ['Portrait', 'Chân Dung', 1, 2],
        ['Event', 'Sự Kiện', 1, 3],
        ['Product', 'Sản Phẩm', 1, 4]
      ];
      
      const insertStmt = db.prepare('INSERT INTO categories (identifier, display_name, visible, order_index) VALUES (?, ?, ?, ?)');
      defaults.forEach(cat => {
        insertStmt.run(...cat);
      });
      console.log('Seeded default categories');
    }
  } catch (e) {
    console.error('Failed to seed categories:', e);
  }
})();

// ─── Migrations ───────────────────────────────────────────────────────────────
try {
  db.exec("ALTER TABLE photos ADD COLUMN detail_images TEXT DEFAULT '[]'");
} catch (e) { /* Column already exists */ }
try {
  db.exec("ALTER TABLE client_albums ADD COLUMN status TEXT DEFAULT 'draft'");
} catch (e) { /* Column already exists */ }
try {
  db.exec("ALTER TABLE client_albums ADD COLUMN client_name TEXT DEFAULT ''");
} catch (e) { /* Column already exists */ }
try {
  db.exec("ALTER TABLE client_albums ADD COLUMN last_selection TEXT DEFAULT ''");
} catch (e) { /* Column already exists */ }
try {
  db.exec("ALTER TABLE client_albums ADD COLUMN is_public INTEGER DEFAULT 0");
} catch (e) { /* Column already exists */ }

// Access requests table
db.exec(`
  CREATE TABLE IF NOT EXISTS access_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    album_id INTEGER NOT NULL,
    email TEXT NOT NULL,
    name TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Unified admin notifications table
db.exec(`
  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    album_id INTEGER,
    album_title TEXT DEFAULT '',
    email TEXT NOT NULL,
    name TEXT DEFAULT '',
    message TEXT DEFAULT '',
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ─── Seed ─────────────────────────────────────────────────────────────────────
function seedData() {
  const aboutCount = db.prepare('SELECT COUNT(*) as c FROM about').get();
  if (aboutCount.c === 0) {
    db.prepare(`INSERT INTO about (name, title, bio, email, instagram, facebook, phone) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(
        'Nguyễn Văn A',
        'Professional Photographer',
        'Tôi là một nhiếp ảnh gia chuyên nghiệp với hơn 5 năm kinh nghiệm. Đam mê ghi lại những khoảnh khắc đẹp nhất, từ đám cưới lãng mạn đến chân dung cảm xúc và sự kiện hoành tráng. Mỗi bức ảnh là một câu chuyện được kể bằng ánh sáng.',
        'contact@photographer.com',
        'https://instagram.com',
        'https://facebook.com',
        '0901 234 567'
      );
  }

  const servicesCount = db.prepare('SELECT COUNT(*) as c FROM services').get();
  if (servicesCount.c === 0) {
    const ins = db.prepare('INSERT INTO services (name, icon, description, order_index) VALUES (?, ?, ?, ?)');
    [
      ['Wedding', '💍', 'Ghi lại những khoảnh khắc thiêng liêng và lãng mạn nhất trong ngày trọng đại của bạn.', 1],
      ['Portrait', '🎭', 'Chân dung nghệ thuật thể hiện cá tính và cảm xúc chân thật nhất của bạn.', 2],
      ['Event', '🎊', 'Ghi lại toàn bộ không khí và những khoảnh khắc đáng nhớ của sự kiện.', 3],
      ['Product', '📦', 'Ảnh sản phẩm chuyên nghiệp, nổi bật và thu hút giúp tăng doanh số bán hàng.', 4],
    ].forEach(s => ins.run(...s));
  }

  const photosCount = db.prepare('SELECT COUNT(*) as c FROM photos').get();
  if (photosCount.c === 0) {
    // Seed với ảnh placeholder từ Unsplash (phân theo thể loại)
    const ins = db.prepare(`
      INSERT INTO photos (title, description, category, image_url, location, shoot_date, tags, order_index, visible, featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    [
      // Wedding
      ['Đám cưới Minh & Lan', 'Lễ cưới tại nhà thờ Đức Bà, TP.HCM', 'Wedding', 'https://images.unsplash.com/photo-1519741497674-611481863552?w=800&q=80', 'Nhà thờ Đức Bà, TP.HCM', '2025-12-15', '["Wedding","Outdoors","Romantic"]', 1, 1, 1],
      ['Tiệc cưới An & Ngọc', 'Không khí ấm áp và hạnh phúc trong buổi tiệc', 'Wedding', 'https://images.unsplash.com/photo-1606800052052-a08af7148866?w=800&q=80', 'Khách sạn Rex, TP.HCM', '2025-11-08', '["Wedding","Reception","Elegant"]', 2, 1, 1],
      ['Pre-wedding Tuấn & Hoa', 'Bộ ảnh pre-wedding tại Đà Lạt lãng mạn', 'Wedding', 'https://images.unsplash.com/photo-1537633552985-df8429e8048b?w=800&q=80', 'Đà Lạt', '2025-10-20', '["Pre-wedding","Dalat","Nature"]', 3, 1, 0],
      // Portrait
      ['Chân dung nghệ thuật - Mai', 'Series chân dung trong ánh sáng vàng', 'Portrait', 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=800&q=80', 'Studio', '2025-12-01', '["Portrait","Studio","Golden Hour"]', 4, 1, 1],
      ['Lifestyle - Hùng', 'Ảnh lifestyle ngoài trời tự nhiên và năng động', 'Portrait', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80', 'Phố đi bộ Nguyễn Huệ', '2025-11-15', '["Portrait","Lifestyle","Urban"]', 5, 1, 0],
      ['Headshot doanh nhân', 'Ảnh chân dung chuyên nghiệp cho doanh nhân', 'Portrait', 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=800&q=80', 'Văn phòng', '2025-10-05', '["Portrait","Professional","Corporate"]', 6, 1, 0],
      // Event
      ['Gala Dinner ABC Corp', 'Sự kiện gala dinner thường niên sang trọng', 'Event', 'https://images.unsplash.com/photo-1511578314322-379afb476865?w=800&q=80', 'Sofitel Sài Gòn Plaza', '2025-12-10', '["Event","Gala","Corporate"]', 7, 1, 1],
      ['Concert Âm nhạc mùa hè', 'Show âm nhạc sôi động tại sân khấu ngoài trời', 'Event', 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=800&q=80', 'Nhà hát TP.HCM', '2025-08-20', '["Event","Music","Concert"]', 8, 1, 0],
      ['Lễ kỷ niệm 10 năm', 'Buổi lễ kỷ niệm thành lập công ty hoành tráng', 'Event', 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80', 'Gem Center', '2025-09-15', '["Event","Anniversary","Corporate"]', 9, 1, 0],
      // Product
      ['Mỹ phẩm La Roche', 'Chụp sản phẩm mỹ phẩm cao cấp', 'Product', 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=800&q=80', 'Studio', '2025-11-20', '["Product","Cosmetics","CleanBackground"]', 10, 1, 1],
      ['Đồng hồ luxury', 'Bộ ảnh đồng hồ với ánh sáng dramatic', 'Product', 'https://images.unsplash.com/photo-1523170335258-f87a2faf0cdf?w=800&q=80', 'Studio', '2025-10-10', '["Product","Watch","Luxury"]', 11, 1, 0],
      ['Thực phẩm - Food styling', 'Chụp ảnh ẩm thực chuyên nghiệp', 'Product', 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80', 'Studio', '2025-09-25', '["Product","Food","Styling"]', 12, 1, 0],
    ].forEach(p => ins.run(...p));
  }

  const adminCount = db.prepare('SELECT COUNT(*) as c FROM admin_users').get();
  if (adminCount.c === 0) {
    const username = process.env.ADMIN_USERNAME || 'admin';
    const password = process.env.ADMIN_PASSWORD || 'admin123';
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`✅ Admin created: ${username} / ${password}`);
  }

  const heroCount = db.prepare('SELECT COUNT(*) as c FROM hero_images').get();
  if (heroCount.c === 0) {
    const ins = db.prepare('INSERT INTO hero_images (image_url, order_index) VALUES (?, ?)');
    [
      ['https://images.unsplash.com/photo-1519741497674-611481863552?w=1600&q=80', 1],
      ['https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?w=1600&q=80', 2],
      ['https://images.unsplash.com/photo-1511578314322-379afb476865?w=1600&q=80', 3]
    ].forEach(h => ins.run(...h));
  }
}

seedData();
console.log('✅ Database ready');

module.exports = db;
