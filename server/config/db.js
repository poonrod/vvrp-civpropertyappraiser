const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

mongoose.set('strictQuery', false);

let warnedTlsCaMissing = false;

/** Evennode MongoDB CA — committed public cert at repo root (same cwd as package.json on deploy). */
const BUNDLED_MONGO_CA = path.join(process.cwd(), 'evennode-mongodb-ca.pem');

/**
 * Shared MongoDB driver options (TLS + CA) for Mongoose and connect-mongo.
 * MONGODB_TLS_CA_FILE: path under cwd or absolute. If missing, falls back to evennode-mongodb-ca.pem when present.
 */
function getMongoClientOptions() {
  const cwd = process.cwd();
  const envPath = process.env.MONGODB_TLS_CA_FILE;
  const tryPaths = [];
  if (envPath) {
    tryPaths.push(path.isAbsolute(envPath) ? envPath : path.join(cwd, envPath));
  }
  if (fs.existsSync(BUNDLED_MONGO_CA)) tryPaths.push(BUNDLED_MONGO_CA);

  let resolved = null;
  for (const p of tryPaths) {
    if (fs.existsSync(p)) {
      resolved = p;
      break;
    }
  }

  if (!resolved) {
    if (envPath && !warnedTlsCaMissing) {
      warnedTlsCaMissing = true;
      console.warn(
        `[SAPA] MONGODB_TLS_CA_FILE not found (${envPath}). Remove it to use default TLS trust, or rely on bundled evennode-mongodb-ca.pem at repo root after deploy.`
      );
    }
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
