const Teacher = require('../models/Teacher');
const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Verifies the JWT from the Authorization header and attaches req.user.
// This is the server-side replacement for the client-only requireLogin()
// guard in app.js - that guard stays in the frontend too, but this is
// the check that actually can't be bypassed by editing localStorage.
exports.protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ message: 'Not authenticated.' });

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select('-password');
    if (!user) return res.status(401).json({ message: 'User no longer exists.' });

    if (user.role === 'teacher') {
      const t = await Teacher.findOne({ email: user.email }, { status: 1 }).lean();
      if (t && t.status === 'inactive') return res.status(403).json({ message: 'This account is inactive.' });
    }
    req.user = user; // { _id, email, role, name, ... }
    
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

// Role gate - mirrors the pageRole check requireLogin() in app.js was
// missing (see TECHNICAL_REFERENCE.md §5.1). Usage: restrictTo('admin')
exports.restrictTo = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({ message: 'Not authorized for this action.' });
  }
  next();
};