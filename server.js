require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const multer = require('multer');
const compression = require('compression');
const app = express();


// ── What was wrong with this file ────────────────────────────────────────────
//
// 1. `app.use(compression())` sat AFTER every route registration. Express runs
//    middleware in the order it's added, so by the time compression was reached
//    the route had already sent its response. It compressed exactly nothing -
//    the only handlers below it were /api/health and the 404. It's now first,
//    where it can actually wrap the response stream.
//
// 2. Nothing served public/. The frontend had to be opened some other way (off
//    disk, or a separate dev server), which is why app.js hard-coded
//    'http://localhost:3000/api' and why cors() had to be wide open. Serving the
//    pages from the same origin as the API removes both problems: app.js now
//    derives its API base from location.origin.
//
// 3. express.json() had no size limit, so it defaulted to 100kb but with no
//    stated intent, and the error a client got when exceeding it was a raw
//    stack. Stated explicitly now.
//
// 4. The error handler returned `error: err.message` to the client. For a
//    Mongoose failure that message names collections, fields and index names.
//    It's logged in full server-side and only echoed to the client in
//    development.

const IS_PROD = process.env.NODE_ENV === 'production';

app.disable('x-powered-by');
// Behind Render/Heroku/nginx, req.ip is the proxy's address unless this is set. The login lockout
// then counts every user as ONE client, so 40 wrong passwords anywhere would lock everybody out.
if (process.env.TRUST_PROXY) {
  app.set('trust proxy', /^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY);
}
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (IS_PROD) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  next();
});

// Compression first - it has to wrap the handlers whose output it compresses.
app.use(compression());

// CORS. Same-origin now that Express serves the pages, so this only matters for
// a separately-hosted frontend. CORS_ORIGIN can be a comma-separated list; with
// nothing set it stays permissive so local development keeps working.
const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
app.use(cors(corsOrigins.length ? { origin: corsOrigins } : {}));

app.use(express.json({ limit: '1mb' }));

// Serves files saved by middleware/upload.js - a submitted assignment's
// fileUrl ('/uploads/169...-abc.pdf') is fetchable directly at this path.
app.use('/api/files', require('./routes/files'));
// Only needed if you added the lecture-video upload feature; delete this line if you did not.
app.use('/uploads/videos', express.static(path.join(__dirname, 'uploads', 'videos')));

// The frontend. Registered before the API routes is fine - none of the page
// paths start with /api - and it means http://localhost:<PORT>/ opens the app.
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/students', require('./routes/students'));
app.use('/api/teachers', require('./routes/teachers'));
app.use('/api/batches', require('./routes/batches'));
app.use('/api/courses', require('./routes/courses'));
app.use('/api/tests', require('./routes/tests'));
app.use('/api/thresholds', require('./routes/thresholds'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/ai', require('./routes/ai'));
app.use('/api/subjects', require('./routes/subjects'));
app.use('/api/attendance', require('./routes/attendance'));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// / → the login page, so the root URL isn't a bare directory listing or 404.
app.get('/', (req, res) => res.redirect('/login.html'));

// ── 404 + error handling ─────────────────────────────────────────────
//
// JSON for /api/*, plain text for everything else. Returning a JSON body for a
// mistyped page URL was confusing: it looked like an API failure rather than a
// wrong link.
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ message: 'Route not found.' });
  }
  res.status(404).type('text/plain').send('Page not found.');
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message === 'Unsupported file type.') {
    return res.status(400).json({ message: err.message });
  }
  // A body that isn't valid JSON, or one over the limit, arrives here. Both used
  // to come back as a 500 "Server error", which reads as a server bug when it's
  // actually a bad request.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'That request body was not valid JSON.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'That request was too large (limit 1MB).' });
  }

  console.error(err.stack);
  res.status(err.status || 500).json({
    message: 'Server error.',
    ...(IS_PROD ? {} : { error: err.message }),
  });
});

// ── Start ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;

if (require.main === module) {
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI is not set. Add it to .env as a single unbroken line, with no quotes.');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not set. Add any long random string to .env - without it no login can succeed.');
    process.exit(1);
  }

  if (IS_PROD && process.env.JWT_SECRET.length < 32) {
    console.error('JWT_SECRET is too short for production. Use at least 32 random characters.');
    process.exit(1);
  }

  mongoose.connect(process.env.MONGO_URI)
    .then(() => {
      console.log('MongoDB connected.');
      app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Open the app at http://localhost:${PORT}/login.html`);
      });
    })
    .catch(err => {
      console.error('MongoDB connection failed:', err.message);
      process.exit(1);
    });
}

module.exports = app;

// if (!process.env.MONGO_URI) {
//   console.error('MONGO_URI is not set...');
//   process.exit(1);
// }
// console.log('DEBUG server.js MONGO_URI:', JSON.stringify(process.env.MONGO_URI));  // add this line temporarily
