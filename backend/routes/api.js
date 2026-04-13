const express = require('express');
const router = express.Router();
const db = require('../db/database');

// GET /api/about
router.get('/about', async (req, res) => {
  try {
    const about = await db.getAsync('SELECT * FROM about LIMIT 1');
    res.json(about || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/photos
router.get('/photos', async (req, res) => {
  try {
    const { category, featured } = req.query;
    // Only fetch photos whose category is visible in the categories table
    let query = 'SELECT * FROM photos WHERE visible = 1 AND category IN (SELECT identifier FROM categories WHERE visible = 1)';
    const params = [];

    if (category && category !== 'All') {
      query += ' AND category = ?';
      params.push(category);
    }
    if (featured === 'true') {
      query += ' AND featured = 1';
    }
    query += ' ORDER BY order_index ASC, created_at DESC';

    const photos = await db.allAsync(query, params);
    const result = photos.map(p => ({ 
      ...p, 
      tags: JSON.parse(p.tags || '[]'),
      detail_images: JSON.parse(p.detail_images || '[]')
    }));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/categories
router.get('/categories', async (req, res) => {
  try {
    const rows = await db.allAsync('SELECT identifier, display_name FROM categories WHERE visible = 1 ORDER BY order_index ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/services
router.get('/services', async (req, res) => {
  try {
    const services = await db.allAsync('SELECT * FROM services ORDER BY order_index ASC');
    res.json(services);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/hero
router.get('/hero', async (req, res) => {
  try {
    const heroImages = await db.allAsync('SELECT * FROM hero_images ORDER BY order_index ASC, created_at DESC');
    res.json(heroImages);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
