const Teacher = require('../models/Teacher');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const router = express.Router();

const User = require('../models/User');
const { protect, restrictTo } = require('../middleware/auth');
const { secondsUntilAllowed, recordFailure, clearKey } = require('../middleware/rateLimit');
const V = require('../utils/validate');

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// Burns the same CPU as a real comparison so a missing account can't be told
// apart from a wrong password by response time.
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

// Only FAILED logins count. The lock applies to any email string equally
// (existing or not), so it reveals nothing about which accounts exist.
const LOGIN_WINDOW_MS    = 10 * 60 * 1000;
const MAX_FAILS_PER_EMAIL = 8;
const MAX_FAILS_PER_IP    = 40;

// POST /api/auth/login
// Contract: no `role` accepted; every credential failure returns the same
// 401 message; no token is minted on failure; unexpected errors are generic.
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const normalized = email.toLowerCase().trim();
    const ipKey    = `login-ip|${req.ip}`;
    const emailKey = `login-email|${normalized}`;

    const wait = secondsUntilAllowed([[ipKey, MAX_FAILS_PER_IP], [emailKey, MAX_FAILS_PER_EMAIL]]);
    if (wait > 0) {
      const mins = Math.ceil(wait / 60);
      res.set('Retry-After', String(wait));
      return res.status(429).json({
        message: `Too many failed attempts. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
        retryAfterSec: wait,
      });
    }

    const user = await User.findOne({ email: normalized }).select('+password');
    const passwordOk = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

    if (!user || !passwordOk) {
      recordFailure(ipKey, LOGIN_WINDOW_MS);
      recordFailure(emailKey, LOGIN_WINDOW_MS);
      return res.status(401).json({ message: 'Invalid email or password.' });
    }
    if (user.role === 'teacher') {
      const t = await Teacher.findOne({ email: user.email }, { status: 1 }).lean();
      if (t && t.status === 'inactive') {
        return res.status(403).json({ message: 'This account is inactive. Please contact your administrator.' });
      }
    }

    clearKey(emailKey);   // email only: clearing the IP bucket would let an attacker with one valid account reset their own strikes

    res.json({
      token: signToken(user),
      user: { id: user._id, email: user.email, role: user.role, name: user.name },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

// GET /api/auth/me - used on page load instead of reading sessionStorage('mr_user')
router.get('/me', protect, (req, res) => {
  const { _id, email, role, name } = req.user;
  res.json({ id: _id, email, role, name });
});

// POST /api/auth/logout - stateless JWT, so this is just a client-side
// contract (frontend discards the token). Kept as a route so the client
// has one consistent endpoint to call, and so it's easy to swap in
// refresh-token/blacklist logic later without changing the frontend.
router.post('/logout', protect, (req, res) => {
  res.json({ message: 'Logged out.' });
});

// POST /api/auth/create-admin - only an existing admin can create another
// admin. No public registration path for this role, on purpose.
router.post('/create-admin', protect, restrictTo('admin'), async (req, res) => {
  try {
    // This route used to accept whatever came in: `if (!name || !email ||
    // !password)` and straight into bcrypt. So an admin could create an admin
    // account with the email "hello" and the password "a" - the two things every
    // other creation path in the app already refuses. The same shared validator
    // the student and teacher forms use is applied here.
    const errors = {};

    const nameR = V.normalizePersonName(req.body.name, 'Name');
    if (!nameR.ok) errors.name = nameR.error;

    const emailR = V.normalizeEmail(req.body.email);
    if (!emailR.ok) errors.email = emailR.error;

    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password.length < 8) {
      errors.password = 'Password must be at least 8 characters.';
    } else if (password.length > 72) {
      // bcrypt silently truncates at 72 bytes, so anything longer gives the
      // admin a false sense of a very long password.
      errors.password = 'Password must be 72 characters or fewer.';
    }

    if (Object.keys(errors).length) {
      return res.status(400).json({
        message: V.firstError(errors) || 'Please correct the highlighted fields.',
        errors,
      });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: nameR.value,
      email: emailR.value,
      password: hashed,
      role: 'admin',
    });
    res.status(201).json({ id: user._id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'That email is already registered.' });
    console.error('POST /auth/create-admin failed:', err);
    res.status(400).json({ message: 'Failed to create the admin account.' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', protect, async (req, res) => {
  try {
    const current = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
    const next    = typeof req.body.newPassword === 'string' ? req.body.newPassword : '';
    const key = `change-pw|${req.user._id}`;

    const wait = secondsUntilAllowed([[key, 5]]);
    if (wait > 0) {
      const mins = Math.ceil(wait / 60);
      return res.status(429).json({ message: `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` });
    }
    if (!current) {
      return res.status(400).json({ message: 'Enter your current password.', errors: { currentPassword: 'Enter your current password.' } });
    }
    if (next.length < 8 || next.length > 72) {
      const m = 'The new password must be 8 to 72 characters.';
      return res.status(400).json({ message: m, errors: { newPassword: m } });
    }
    if (next === current) {
      const m = 'The new password must be different from the current one.';
      return res.status(400).json({ message: m, errors: { newPassword: m } });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user || !(await bcrypt.compare(current, user.password))) {
      recordFailure(key, 10 * 60 * 1000);
      const m = 'Your current password is not correct.';
      return res.status(400).json({ message: m, errors: { currentPassword: m } });
    }
    await User.updateOne({ _id: user._id }, { $set: { password: await bcrypt.hash(next, 10) } });
    clearKey(key);
    res.json({ message: 'Password updated.' });
  } catch (err) {
    console.error('POST /auth/change-password failed:', err);
    res.status(500).json({ message: 'Could not change the password. Please try again.' });
  }
});


module.exports = router;