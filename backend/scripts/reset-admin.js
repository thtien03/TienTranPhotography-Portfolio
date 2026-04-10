const { DatabaseSync } = require('node:sqlite');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_PATH = path.join(__dirname, '..', 'data', 'portfolio.db');

if (!fs.existsSync(DB_PATH)) {
  console.error('❌ Database file not found at:', DB_PATH);
  process.exit(1);
}

const db = new DatabaseSync(DB_PATH);

const username = process.env.ADMIN_USERNAME || 'admin';
const password = process.env.ADMIN_PASSWORD || 'admin123';
const hash = bcrypt.hashSync(password, 10);

try {
  const existing = db.prepare('SELECT id FROM admin_users WHERE username = ?').get(username);
  
  if (existing) {
    db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').run(hash, existing.id);
    console.log(`✅ Password updated for user: ${username}`);
  } else {
    db.prepare('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)').run(username, hash);
    console.log(`✅ New admin user created: ${username}`);
  }
  console.log(`🔑 Credentials set to: ${username} / ${password}`);
} catch (err) {
  console.error('❌ Error resetting admin:', err.message);
  process.exit(1);
}
