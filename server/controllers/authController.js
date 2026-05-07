const mongoose = require('mongoose');
const { createOrUpdateDiscordUser } = require('../models/userModel');
const { LoginLog } = require('../models/schemas');

function loginPage(req, res) {
  const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${process.env.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.DISCORD_REDIRECT_URI)}&response_type=code&scope=identify`;
  res.render('login', { authUrl });
}

async function discordCallback(req, res) {
  const { code } = req.query;
  if (!code) return res.redirect('/auth/login');

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI
    })
  });

  const tokenJson = await tokenRes.json();
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` }
  });
  const discordUser = await userRes.json();

  const user = await createOrUpdateDiscordUser({
    discordId: discordUser.id,
    username: discordUser.username,
    avatar: discordUser.avatar
  });

  req.session.user = {
    id: user.id,
    discordId: user.discord_id,
    username: user.username,
    avatar: user.avatar,
    role: user.role
  };

  await LoginLog.create({
    user_id: new mongoose.Types.ObjectId(user.id),
    ip_address: req.ip || 'unknown',
    user_agent: req.get('user-agent') || 'unknown'
  });

  return res.redirect('/admin');
}

function logout(req, res) {
  req.session.destroy(() => res.redirect('/'));
}

module.exports = { loginPage, discordCallback, logout };
