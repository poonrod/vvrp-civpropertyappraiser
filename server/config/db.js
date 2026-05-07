const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

mongoose.set('strictQuery', false);

/**
 * Shared MongoDB driver options (TLS + CA) for Mongoose and connect-mongo.
 * Set MONGODB_TLS_CA_FILE to the path of Evennode's evennode.pem (app working directory or absolute).
 */
function getMongoClientOptions() {
  const caPath = process.env.MONGODB_TLS_CA_FILE;
  if (!caPath) return {};
  const resolved = path.isAbsolute(caPath) ? caPath : path.join(process.cwd(), caPath);
  if (!fs.existsSync(resolved)) {
    console.warn(`[SAPA] MONGODB_TLS_CA_FILE not found: ${resolved}`);
    return {};
  }
  return {
    tls: true,
    tlsCAFile: resolved
  };
}

async function connectDb() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sapa';
  await mongoose.connect(uri, getMongoClientOptions());
}

module.exports = { mongoose, connectDb, getMongoClientOptions };
