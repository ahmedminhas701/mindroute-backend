const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const router = express.Router();

const User = require('../models/User');
const { protect, restrictTo } = require('../middleware/auth');

function signToken(user) {
  return jwt.sign(
    { id: user._id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// POST /api/auth/login
// Replaces the plaintext MOCK_USERS check in setupLogin() (app.js §21).
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const token = signToken(user);
    res.json({
      token,
      user: { id: user._id, email: user.email, role: user.role, name: user.name },
    });
  } catch (err) {
    res.status(500).json({ message: 'Login failed.', error: err.message });
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
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, and password are required.' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email: email.toLowerCase().trim(), password: hashed, role: 'admin' });
    res.status(201).json({ id: user._id, email: user.email, name: user.name, role: user.role });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ message: 'That email is already registered.' });
    res.status(400).json({ message: 'Failed to create admin.', error: err.message });
  }
});


module.exports = router;