const { getSetting } = require('../models/appSettingModel');
const { getDefaultModules } = require('../config/moduleDefinitions');

let cachedModules = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 5000;

async function loadModules(req, res, next) {
  try {
    const now = Date.now();
    if (cachedModules && now < cacheExpiry) {
      res.locals.modules = cachedModules;
      return next();
    }
    const stored = await getSetting('modules');
    const defaults = getDefaultModules();
    const merged = { ...defaults, ...(stored && typeof stored === 'object' ? stored : {}) };
    cachedModules = merged;
    cacheExpiry = now + CACHE_TTL_MS;
    res.locals.modules = merged;
  } catch (err) {
    console.error('[moduleMiddleware] Failed to load modules:', err.message);
    res.locals.modules = getDefaultModules();
  }
  next();
}

function invalidateModuleCache() {
  cachedModules = null;
  cacheExpiry = 0;
}

function requireModule(moduleKey) {
  return (req, res, next) => {
    if (res.locals.modules && res.locals.modules[moduleKey]) {
      return next();
    }
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Feature not enabled' });
    }
    return res.status(404).send('Feature not enabled');
  };
}

module.exports = { loadModules, invalidateModuleCache, requireModule };
