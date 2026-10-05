const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const router = express.Router();

const User = require('../models/User');
const { protect, restrictTo } = require('../middleware/auth');
const { rateLimit, resetRateLimit } = require('../middleware/rateLimit');
const V = require('../utils/validate');

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// A bcrypt hash of a string nobody will ever submit. Used to burn roughly the
// same CPU time on the "no such user" path as on the "wrong password" path.
//
// Without this, a missing user returns in ~1ms while a real user with a wrong
// password takes ~60ms (bcrypt cost 10). That timing difference is a usable
// account-enumeration oracle: an attacker can discover which email addresses
// have accounts without ever guessing a password. Comparing against a dummy
// hash makes both paths cost the same.
const DUMMY_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

const LOGIN_PATH_KEY = '/api/auth/login';

// 8 attempts per 15 minutes, counted per IP *and* per submitted email.
// See middleware/rateLimit.js for why both keys are tracked.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  keyFn: req => [
    req.ip,
    typeof req.body?.email === 'string' ? req.body.email.toLowerCase().trim() : null,
  ],
  message: 'Too many login attempts. Please wait a few minutes and try again.',
});

// POST /api/auth/login
//
// SECURITY CONTRACT — do not weaken any of these four points:
//
//   1. This route does NOT accept a `role` field, and must never start doing so.
//      The client used to send the value of a "Login As" dropdown, and login.html
//      compared it against the real role and reported the mismatch. Because that
//      check ran only AFTER a successful credential check, the resulting message
//      ("That account is not a student.") told the attacker their guessed password
//      was correct, and process-of-elimination revealed the true role in at most
//      three tries. The dropdown is gone; the account's role is whatever the
//      server says it is.
//
//   2. Every failure returns the SAME status and the SAME message. Never
//      distinguish "no such account" from "wrong password", and never vary the
//      wording by role, account status, or anything else about the account.
//
//   3. No token is minted on any failure path. A token issued and then discarded
//      client-side is still a valid token sitting in the response body, readable
//      from the browser's network tab.
//
//   4. Unexpected errors return a generic message. err.message here can carry
//      Mongoose/driver internals (index names, connection strings in some
//      failure modes) straight to the browser.
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const normalized = email.toLowerCase().trim();
    const user = await User.findOne({ email: normalized }).select('+password');

    // Always run one bcrypt comparison, whether or not the user exists.
    const passwordOk = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

    if (!user || !passwordOk) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    // Successful login clears this account's strikes so a user who mistyped
    // their password twice before getting it right isn't left near the limit.
    resetRateLimit(LOGIN_PATH_KEY, normalized, req.ip);

    const token = signToken(user);
    res.json({
      token,
      user: { id: user._id, email: user.email, role: user.role, name: user.name },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

// GET /api/auth/me — used on page load instead of reading sessionStorage('mr_user')
router.get('/me', protect, (req, res) => {
  const { _id, email, role, name } = req.user;
  res.json({ id: _id, email, role, name });
});

// POST /api/auth/logout — stateless JWT, so this is just a client-side
// contract (frontend discards the token). Kept as a route so the client
// has one consistent endpoint to call, and so it's easy to swap in
// refresh-token/blacklist logic later without changing the frontend.
router.post('/logout', protect, (req, res) => {
  res.json({ message: 'Logged out.' });
});

// POST /api/auth/create-admin — only an existing admin can create another
// admin. No public registration path for this role, on purpose.
router.post('/create-admin', protect, restrictTo('admin'), async (req, res) => {
  try {
    // This route used to accept whatever came in: `if (!name || !email ||
    // !password)` and straight into bcrypt. So an admin could create an admin
    // account with the email "hello" and the password "a" — the two things every
    // other creation path in the app already refuses. The same shared validator
    // the student and teacher forms use is applied here.
    const errors = {};

    const nameR = V.normalizePersonName(req.body.name, 'Name');
    if (!nameR.ok) errors.name = nameR.error;

    const emailR = V.normalizeEmail(req.body.email);
    if (!emailR.ok) errors.email = emailR.error;

    const password = typeof req.body.password === 'string' ? req.body.password : '';
    if (password.length < 6) {
      errors.password = 'Password must be at least 6 characters.';
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


module.exports = router;