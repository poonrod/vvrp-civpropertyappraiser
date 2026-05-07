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

  try {
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
    if (!tokenRes.ok || !tokenJson.access_token) {
      console.error('[auth] Discord token error:', tokenRes.status, tokenJson);
      req.flash('error', tokenJson.error_description || tokenJson.message || 'Discord login failed');
      return res.redirect('/auth/login');
    }

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` }
    });
    const discordUser = await userRes.json();
    if (!userRes.ok || !discordUser.id) {
      console.error('[auth] Discord user error:', userRes.status, discordUser);
      req.flash('error', 'Could not read Discord profile.');
      return res.redirect('/auth/login');
    }

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

    try {
      await LoginLog.create({
        user_id: new mongoose.Types.ObjectId(user.id),
        ip_address: req.ip || 'unknown',
        user_agent: req.get('user-agent') || 'unknown'
      });
    } catch (logErr) {
      console.error('[auth] LoginLog:', logErr.message);
    }

    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('[auth] session.save:', saveErr);
        req.flash('error', 'Session could not be saved. If using http://, set SESSION_COOKIE_SECURE=false on the server.');
        return res.redirect('/auth/login');
      }
      return res.redirect('/admin');
    });
  } catch (e) {
    console.error('[auth] discordCallback:', e);
    req.flash('error', 'Login failed. Try again.');
    return res.redirect('/auth/login');
  }
}

function logout(req, res) {
  req.session.destroy(() => res.redirect('/'));
}

module.exports = { loginPage, discordCallback, logout };
