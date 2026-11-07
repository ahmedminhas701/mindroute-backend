const Teacher = require('../models/Teacher');
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const router = express.Router();

const User = require('../models/User');
const { protect, restrictTo } = require('../middleware/auth');
const {
  secondsUntilAllowed,
  recordFailure,
  clearKey,
  unlockAccount,
  clearAllBuckets,
} = require('../middleware/rateLimit');
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

// Lockout windows and thresholds:
// We use a composite (IP + Email) key as the primary lock to prevent Denial-of-Service /
// Account Lockout attacks where an attacker continuously guesses wrong passwords to
// lock out the real admin on a different IP.
const LOGIN_WINDOW_MS        = 10 * 60 * 1000;
const MAX_FAILS_PER_PAIR     = 5;   // 5 failed attempts from a specific IP for an email blocks that IP
const MAX_FAILS_PER_IP       = 30;  // 30 failed attempts across all emails from an IP blocks that IP
const MAX_FAILS_PER_EMAIL    = 40;  // High global threshold against distributed botnet attacks

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (typeof email !== 'string' || typeof password !== 'string' || !email.trim() || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const normalized = email.toLowerCase().trim();
    const clientIp = (req.headers && req.headers['x-forwarded-for']
      ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
      : '') || req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
    const pairKey  = `login-pair|${clientIp}|${normalized}`;
    const ipKey    = `login-ip|${clientIp}`;
    const emailKey = `login-email|${normalized}`;

    // Emergency admin recovery bypass check
    const recoveryKey = req.headers['x-admin-recovery-key'] || req.body.adminRecoveryKey;
    const isEmergencyBypass = !!(recoveryKey && (
      recoveryKey === process.env.ADMIN_RECOVERY_KEY ||
      recoveryKey === process.env.JWT_SECRET
    ));

    if (isEmergencyBypass) {
      clearKey(pairKey);
      clearKey(emailKey);
    } else {
      const wait = secondsUntilAllowed([
        [pairKey, MAX_FAILS_PER_PAIR],
        [ipKey, MAX_FAILS_PER_IP],
        [emailKey, MAX_FAILS_PER_EMAIL],
      ]);
      if (wait > 0) {
        const mins = Math.ceil(wait / 60);
        res.set('Retry-After', String(wait));
        return res.status(429).json({
          message: `Too many failed attempts. Please try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
          retryAfterSec: wait,
        });
      }
    }

    const user = await User.findOne({ email: normalized }).select('+password');
    const passwordOk = await bcrypt.compare(password, user ? user.password : DUMMY_HASH);

    if (!user || !passwordOk) {
      recordFailure(pairKey, LOGIN_WINDOW_MS);
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

    clearKey(pairKey);
    clearKey(emailKey);

    res.json({
      token: signToken(user),
      user: { id: user._id, email: user.email, role: user.role, name: user.name },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

// POST /api/auth/unlock - emergency unlock endpoint
router.post('/unlock', async (req, res) => {
  try {
    const recoveryKey = req.headers['x-admin-recovery-key'] || req.body.recoveryKey;
    const isBearer = (req.headers.authorization && req.headers.authorization.startsWith('Bearer '));
    let isAdmin = false;
    if (isBearer) {
      try {
        const decoded = jwt.verify(req.headers.authorization.slice(7), process.env.JWT_SECRET);
        if (decoded && decoded.role === 'admin') isAdmin = true;
      } catch (_) {}
    }
    const isKeyValid = recoveryKey && (recoveryKey === process.env.ADMIN_RECOVERY_KEY || recoveryKey === process.env.JWT_SECRET);
    if (!isAdmin && !isKeyValid) {
      return res.status(403).json({ message: 'Unauthorized. Admin token or recovery key required.' });
    }

    const { email, all } = req.body;
    if (all) {
      const cleared = clearAllBuckets();
      return res.json({ message: `Cleared ${cleared} rate limit bucket(s).` });
    }
    if (!email) return res.status(400).json({ message: 'Provide an email or set all: true.' });
    const cleared = unlockAccount(email);
    return res.json({ message: `Unlocked "${email}". Reset ${cleared} lockout bucket(s).` });
  } catch (err) {
    console.error('Unlock error:', err);
    res.status(500).json({ message: 'Unlock operation failed.' });
  }
});

// GET /api/auth/me - used on page load instead of reading sessionStorage('mr_user')
router.get('/me', protect, (req, res) => {
  const { _id, email, role, name } = req.user;
  res.json({ id: _id, email, role, name });
});

// POST /api/auth/logout - stateless JWT
router.post('/logout', protect, (req, res) => {
  res.json({ message: 'Logged out.' });
});

// POST /api/auth/create-admin - only an existing admin can create another admin
router.post('/create-admin', protect, restrictTo('admin'), async (req, res) => {
  try {
    const errors = {};
    const nameR = V.normalizePersonName(req.body.name, 'Admin name');
    if (!nameR.ok) errors.name = nameR.error;

    const emailR = V.normalizeEmail(req.body.email);
    if (!emailR.ok) errors.email = emailR.error;

    const pw = typeof req.body.password === 'string' ? req.body.password : '';
    if (!pw) errors.password = 'Password is required.';
    else if (pw.length < 8) errors.password = 'Password must be at least 8 characters.';
    else if (pw.length > 72) errors.password = 'Password is too long (max 72 characters).';

    if (Object.keys(errors).length) {
      return res.status(400).json({ message: V.firstError(errors), errors });
    }

    const exists = await User.findOne({ email: emailR.value });
    if (exists) {
      return res.status(409).json({ message: 'An account with that email already exists.', errors: { email: 'Email already in use.' } });
    }

    const user = await User.create({
      name: nameR.value,
      email: emailR.value,
      password: await bcrypt.hash(pw, 10),
      role: 'admin',
    });

    res.status(201).json({
      message: 'Admin account created.',
      user: { id: user._id, email: user.email, role: user.role, name: user.name },
    });
  } catch (err) {
    console.error('create-admin failed:', err);
    res.status(500).json({ message: 'Failed to create admin.' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Enter your current password and a new password.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.', errors: { newPassword: 'At least 8 characters.' } });
    }
    if (newPassword.length > 72) {
      return res.status(400).json({ message: 'New password is too long (max 72 characters).', errors: { newPassword: 'Too long.' } });
    }

    const user = await User.findById(req.user._id).select('+password');
    if (!user) return res.status(404).json({ message: 'User not found.' });

    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      return res.status(400).json({ message: 'Current password is not correct.', errors: { currentPassword: 'Wrong password.' } });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    res.json({ message: 'Password updated.' });
  } catch (err) {
    console.error('change-password failed:', err);
    res.status(500).json({ message: 'Failed to update password.' });
  }
});

module.exports = router;
