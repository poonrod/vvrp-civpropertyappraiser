const express = require('express');
const { loginPage, discordCallback, logout } = require('../controllers/authController');

const router = express.Router();
router.get('/login', loginPage);
router.get('/discord/callback', discordCallback);
router.post('/logout', logout);

module.exports = router;
