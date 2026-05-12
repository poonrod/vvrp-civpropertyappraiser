require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const csurf = require('csurf');

const authRoutes = require('./routes/authRoutes');
const publicRoutes = require('./routes/publicRoutes');
const propertyRoutes = require('./routes/propertyRoutes');
const adminRoutes = require('./routes/adminRoutes');
const businessRoutes = require('./routes/businessRoutes');
const postalRoutes = require('./routes/postalRoutes');
const propertyRequestRoutes = require('./routes/propertyRequestRoutes');
const moduleRoutes = require('./routes/moduleRoutes');
const { getMongoClientOptions } = require('./config/db');
const { loadModules } = require('./middleware/moduleMiddleware');

const app = express();

/**
 * Evennode and similar hosts send X-Forwarded-For. Trust must not be false there or
 * express-rate-limit throws ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
 * Case-insensitive false / 0 / off only when you truly run without a proxy (local dev).
 */
function parseTrustProxySetting() {
  const raw = process.env.TRUST_PROXY;
  if (raw == null || String(raw).trim() === '') return 1;
  const s = String(raw).trim().toLowerCase();
  if (s === 'false' || s === '0' || s === 'no' || s === 'off') return false;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 0) return n;
  return 1;
}

const trustProxySetting = parseTrustProxySetting();

// Reverse proxies (Evennode, etc.) send X-Forwarded-For — required for express-rate-limit + req.ip.
app.set('trust proxy', trustProxySetting);

function sessionSecretOrExit() {
  const raw = process.env.SESSION_SECRET;
  const s = raw != null ? String(raw).trim() : '';
  if (s) return s;
  if (process.env.NODE_ENV === 'development') {
    return 'dev-only-session-secret-not-for-production';
  }
  console.error(
    '[SAPA] SESSION_SECRET is missing. In Evennode: App → Environment variables → add SESSION_SECRET (e.g. output of: openssl rand -hex 32)'
  );
  process.exit(1);
}

function sessionCookieSecure() {
  if (process.env.SESSION_COOKIE_SECURE === 'false') return false;
  if (process.env.SESSION_COOKIE_SECURE === 'true') return true;
  const base = process.env.BASE_URL || '';
  if (base.startsWith('http://')) return false;
  return process.env.NODE_ENV === 'production';
}

const mongoUrl = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/sapa';
const sessionStore =
  process.env.USE_MEMORY_SESSION === 'true'
    ? undefined
    : MongoStore.create({
        mongoUrl,
        mongoOptions: getMongoClientOptions(),
        touchAfter: 24 * 3600
      });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '2mb' }));
app.use(methodOverride('_method'));

// Resolve once so express-session always receives an explicit string (avoids deprecated req.secret fallback).
const sessionSecret = sessionSecretOrExit();
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    proxy: trustProxySetting !== false,
    cookie: {
      httpOnly: true,
      secure: sessionCookieSecure(),
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24
    }
  })
);
app.use(flash());
app.use(csurf());

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.use(loadModules);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.csrfToken = req.csrfToken();
  res.locals.flashError = req.flash('error');
  next();
});

app.use('/auth', loginLimiter, authRoutes);
app.use('/', publicRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/postals', postalRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/property-requests', propertyRequestRoutes);
app.use('/api/modules', moduleRoutes);
app.use('/admin', adminRoutes);

app.use((err, req, res, next) => {
  if (err.code === 'EBADCSRFTOKEN') {
    if (req.path && req.path.startsWith('/api')) {
      return res.status(403).json({ error: 'Invalid CSRF token' });
    }
    return res.status(403).send('Invalid CSRF token');
  }
  console.error(err);
  return res.status(500).send('Internal server error');
});

module.exports = app;
