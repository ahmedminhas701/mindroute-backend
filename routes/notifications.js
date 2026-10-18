const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Notification = require('../models/Notification');
const User = require('../models/User');
const { protect, restrictTo } = require('../middleware/auth');
const V = require('../utils/validate');

router.use(protect);

// ── What was wrong with this file ────────────────────────────────────────────
//
// 1. POST took `userId` straight from the request body:
//
//        userId: userId || req.user._id
//
//    so ANY logged-in user - a student included - could post a notification
//    into any other account's bell by supplying that account's id. Since the
//    bell renders the title and body, that is a channel for sending arbitrary
//    messages that appear to come from the academy. Only admins and teachers
//    may now address someone else; a student's POST is always filed against
//    their own id, whatever the body says.
//
// 2. `type`, `title` and `body` were stored unvalidated and unbounded. A
//    notification with no title rendered as an empty row in the dropdown that
//    still counted toward the unread badge, so the badge showed "3" over a list
//    that looked like it had one item in it.
//
// 3. No route had a try/catch. A malformed :id (anything that isn't a 24-char
//    ObjectId) makes Mongoose throw a CastError, which surfaced as a bare 500
//    with a stack-trace message rather than "Notification not found."
//
// Ownership itself was already handled correctly: every query is scoped by
// `userId: req.user._id`, so nobody could read or mark another user's items.
// That scoping is kept and made explicit below.

const TYPES = [
  'assignment', 'grade', 'schedule', 'fee', 'announcement', 'system',
  'upload', 'due', 'live', 'change', 'overdue', 'quiz',
];

/** True if `v` could be a Mongoose ObjectId, so we can 404 instead of throwing. */
function isObjectId(v) {
  return mongoose.Types.ObjectId.isValid(String(v || '')) && String(v).length === 24;
}

// GET /api/notifications - only ever the caller's own.
router.get('/', async (req, res) => {
  try {
    const notifs = await Notification.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(100)      // the bell shows a handful; an unbounded find grows forever
      .lean();
    res.json(notifs);
  } catch (err) {
    console.error('GET /notifications failed:', err);
    res.status(500).json({ message: 'Failed to load notifications.' });
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const count = await Notification.countDocuments({ userId: req.user._id, read: false });
    res.json({ count });
  } catch (err) {
    console.error('GET /notifications/unread-count failed:', err);
    res.status(500).json({ message: 'Failed to count notifications.' });
  }
});

// POST /api/notifications
router.post('/', async (req, res) => {
  try {
    const errors = {};

    const title = V.normalizeText(req.body.title, { label: 'Title', required: true, min: 2, max: 120 });
    if (!title.ok) errors.title = title.error;

    const body = V.normalizeText(req.body.body, { label: 'Message', max: 1000 });
    if (!body.ok) errors.body = body.error;

    // Free-text types produced unstyled bell rows, because the client picks an
    // icon per known type and had no fallback.
    const type = V.normalizeEnum(req.body.type, { label: 'Type', values: TYPES, default: 'system' });
    if (!type.ok) errors.type = type.error;

    // Targeting someone else is a privileged action. This is the actual fix for
    // the hole described at the top of the file.
    let target = String(req.user._id);
    if (req.body.userId && String(req.body.userId) !== String(req.user._id)) {
      if (req.user.role !== 'admin' && req.user.role !== 'teacher') {
        return res.status(403).json({ message: 'You can only create notifications for yourself.' });
      }
      if (!isObjectId(req.body.userId)) {
        errors.userId = 'That recipient id is not valid.';
      } else {
        const exists = await User.exists({ _id: req.body.userId });
        if (!exists) errors.userId = 'That recipient no longer has an account.';
        else target = String(req.body.userId);
      }
    }

    if (Object.keys(errors).length) {
      return res.status(400).json({ message: V.firstError(errors) || 'Please correct the highlighted fields.', errors });
    }

    const notif = await Notification.create({
      userId: target,
      type: type.value,
      title: title.value,
      body: body.value || '',
      read: false,
    });
    res.status(201).json(notif);
  } catch (err) {
    console.error('POST /notifications failed:', err);
    res.status(500).json({ message: 'Failed to create the notification.' });
  }
});

// PATCH /api/notifications/read-all
//
// Declared BEFORE /:id/read on purpose. The two don't actually collide (one is
// a single path segment, the other is two), but keeping the literal route above
// the parameterised one is the habit that prevents the collision when someone
// later adds PATCH /:id.
router.patch('/read-all', async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.user._id, read: false },
      { read: true },
    );
    res.json({ message: 'All notifications marked read.', modified: result.modifiedCount || 0 });
  } catch (err) {
    console.error('PATCH /notifications/read-all failed:', err);
    res.status(500).json({ message: 'Failed to mark notifications read.' });
  }
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ message: 'Notification not found.' });
    const notif = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { read: true },
      { new: true },
    );
    if (!notif) return res.status(404).json({ message: 'Notification not found.' });
    res.json(notif);
  } catch (err) {
    console.error('PATCH /notifications/:id/read failed:', err);
    res.status(500).json({ message: 'Failed to update the notification.' });
  }
});

// DELETE /api/notifications/:id
router.delete('/:id', async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).json({ message: 'Notification not found.' });
    const notif = await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    if (!notif) return res.status(404).json({ message: 'Notification not found.' });
    res.json({ message: 'Notification removed.' });
  } catch (err) {
    console.error('DELETE /notifications/:id failed:', err);
    res.status(500).json({ message: 'Failed to remove the notification.' });
  }
});

// DELETE /api/notifications - admin housekeeping: clear the caller's own list.
router.delete('/', restrictTo('admin', 'teacher', 'student'), async (req, res) => {
  try {
    const result = await Notification.deleteMany({ userId: req.user._id });
    res.json({ message: 'Notifications cleared.', removed: result.deletedCount || 0 });
  } catch (err) {
    console.error('DELETE /notifications failed:', err);
    res.status(500).json({ message: 'Failed to clear notifications.' });
  }
});

module.exports = router;
