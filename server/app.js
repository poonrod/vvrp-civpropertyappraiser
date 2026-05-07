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
const { getMongoClientOptions } = require('./config/db');

const app = express();

// Reverse proxies (Evennode, etc.) send X-Forwarded-For — required for express-rate-limit + req.ip.
// Default: trust first hop. Set TRUST_PROXY=false only when nothing proxies (no XFF header).
if (process.env.TRUST_PROXY === 'false' || process.env.TRUST_PROXY === '0') {
  app.set('trust proxy', false);
} else {
  app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);
}

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
app.use(
  session({
    secret: sessionSecretOrExit(),
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
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

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.csrfToken = req.csrfToken();
  res.locals.flashError = req.flash('error');
  next();
});

app.use('/auth', loginLimiter, authRoutes);
app.use('/', publicRoutes);
app.use('/api/properties', propertyRoutes);
app.use('/api/businesses', businessRoutes);
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
