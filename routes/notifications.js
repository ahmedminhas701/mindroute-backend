const express = require('express');
const router = express.Router();

const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');

router.use(protect);

// NOTE: app.js's NOTIFICATIONS array is one global, shared mock list (no
// per-user scoping). Assuming your Notification model has a userId field
// so real users only see their own — adjust the `{ userId: req.user._id }`
// filters below to `{}` if you're intentionally keeping notifications global.

// GET /api/notifications — replaces reading NOTIFICATIONS + renderNotifBell()
router.get('/', async (req, res) => {
  const notifs = await Notification.find({ userId: req.user._id }).sort({ createdAt: -1 });
  res.json(notifs);
});

// GET /api/notifications/unread-count — mirrors unreadCount()
router.get('/unread-count', async (req, res) => {
  const count = await Notification.countDocuments({ userId: req.user._id, read: false });
  res.json({ count });
});

// POST /api/notifications — system-generated (e.g. after an assignment
// submission or schedule change), mirrors the NOTIFICATIONS.unshift(...)
// calls scattered through app.js (submitAssignment(), submitAddClass(), etc.)
router.post('/', async (req, res) => {
  const { userId, type, title, body } = req.body;
  const notif = await Notification.create({
    userId: userId || req.user._id,
    type, title, body,
    read: false,
  });
  res.status(201).json(notif);
});

// PATCH /api/notifications/:id/read — mirrors the notif-item onclick handler
router.patch('/:id/read', async (req, res) => {
  const notif = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id },
    { read: true },
    { new: true }
  );
  if (!notif) return res.status(404).json({ message: 'Notification not found.' });
  res.json(notif);
});

// PATCH /api/notifications/read-all — mirrors markAllRead()
router.patch('/read-all', async (req, res) => {
  await Notification.updateMany({ userId: req.user._id, read: false }, { read: true });
  res.json({ message: 'All notifications marked read.' });
});

// DELETE /api/notifications/:id
router.delete('/:id', async (req, res) => {
  const notif = await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
  if (!notif) return res.status(404).json({ message: 'Notification not found.' });
  res.json({ message: 'Notification removed.' });
});

module.exports = router;
