const { User } = require('./schemas');

function mapUser(doc) {
  if (!doc) return null;
  const u = doc.toObject ? doc.toObject() : doc;
  return {
    id: String(u._id),
    discord_id: u.discord_id,
    username: u.username,
    avatar: u.avatar,
    role: u.role,
    created_at: u.created_at,
    updated_at: u.updated_at
  };
}

async function findByDiscordId(discordId) {
  const row = await User.findOne({ discord_id: discordId }).lean();
  return row ? mapUser(row) : null;
}

async function createOrUpdateDiscordUser({ discordId, username, avatar }) {
  let user = await User.findOne({ discord_id: discordId });
  if (!user) {
    const defaultRole = discordId === process.env.DEFAULT_ADMIN_DISCORD_ID ? 'admin' : 'user';
    user = await User.create({
      discord_id: discordId,
      username,
      avatar,
      role: defaultRole
    });
    return mapUser(user);
  }
  user.username = username;
  user.avatar = avatar;
  await user.save();
  return mapUser(user);
}

async function updateUserRole(id, role) {
  await User.findByIdAndUpdate(id, { role });
}

async function listUsers() {
  const rows = await User.find().sort({ created_at: -1 }).lean();
  return rows.map(mapUser);
}

module.exports = { findByDiscordId, createOrUpdateDiscordUser, updateUserRole, listUsers };
