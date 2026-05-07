const express = require('express');
const pool = require('../config/db');

const router = express.Router();

router.get('/', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM map_configs ORDER BY id DESC LIMIT 1');
  const config = rows[0] || null;
  res.render('index', { config });
});

module.exports = router;
