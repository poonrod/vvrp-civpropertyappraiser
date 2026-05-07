const pool = require('../config/db');

async function findByDiscordId(discordId) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE discord_id = ?', [discordId]);
  return rows[0] || null;
}

async function createOrUpdateDiscordUser({ discordId, username, avatar }) {
  const existing = await findByDiscordId(discordId);
  if (!existing) {
    const defaultRole = discordId === process.env.DEFAULT_ADMIN_DISCORD_ID ? 'admin' : 'user';
    const [result] = await pool.execute(
      'INSERT INTO users (discord_id, username, avatar, role) VALUES (?, ?, ?, ?)',
      [discordId, username, avatar, defaultRole]
    );
    return { id: result.insertId, discord_id: discordId, username, avatar, role: defaultRole };
  }
  await pool.execute('UPDATE users SET username = ?, avatar = ? WHERE id = ?', [username, avatar, existing.id]);
  return { ...existing, username, avatar };
}

async function updateUserRole(id, role) {
  await pool.execute('UPDATE users SET role = ? WHERE id = ?', [role, id]);
}

async function listUsers() {
  const [rows] = await pool.query('SELECT * FROM users ORDER BY created_at DESC');
  return rows;
}

module.exports = { findByDiscordId, createOrUpdateDiscordUser, updateUserRole, listUsers };
