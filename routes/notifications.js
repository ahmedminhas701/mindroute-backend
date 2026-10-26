const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const Notification = require('../models/Notification');
const { protect } = require('../middleware/auth');

router.use(protect);

const owner = req => String(req.user._id);
const clean = (s, max) => String(s == null ? '' : s).replace(/[<>]/g, '').trim().slice(0, max);

// GET /api/notifications - the caller's own, newest first
router.get('/', async (req, res) => {
  try {
    const list = await Notification.find({ userId: owner(req) })
      .sort({ createdAt: -1 }).limit(100)
      .select('type title body read createdAt').lean();
    res.json(list.map(n => ({ ...n, read: !!n.read })));
  } catch (err) {
    console.error('GET /notifications failed:', err);
    res.status(500).json({ message: 'Failed to load notifications.' });
  }
});

// PATCH /api/notifications/read-all
const markAll = async (req, res) => {
  try {
    const r = await Notification.updateMany({ userId: owner(req), read: { $ne: true } }, { $set: { read: true } });
    res.json({ updated: r.modifiedCount });
  } catch (err) {
    console.error('PATCH read-all failed:', err);
    res.status(500).json({ message: 'Failed to update notifications.' });
  }
};
router.patch('/read-all', markAll);
router.patch('/mark-all-read', markAll);   // alias for older client code

// PATCH /api/notifications/:id/read
router.patch('/:id/read', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid notification id.' });
    const r = await Notification.updateOne({ _id: req.params.id, userId: owner(req) }, { $set: { read: true } });
    if (!r.matchedCount) return res.status(404).json({ message: 'Notification not found.' });
    res.json({ message: 'Marked as read.' });
  } catch (err) {
    console.error('PATCH read failed:', err);
    res.status(500).json({ message: 'Failed to update the notification.' });
  }
});

// POST /api/notifications - creates a notification for the CALLER only
router.post('/', async (req, res) => {
  try {
    const title = clean(req.body.title, 120);
    if (!title) return res.status(400).json({ message: 'A title is required.' });
    const type = Notification.TYPES.includes(req.body.type) ? req.body.type : 'system';
    const n = await Notification.create({ userId: owner(req), type, title, body: clean(req.body.body, 1000), read: false });
    res.status(201).json({ _id: n._id, type: n.type, title: n.title, body: n.body, read: n.read, createdAt: n.createdAt });
  } catch (err) {
    console.error('POST /notifications failed:', err);
    res.status(500).json({ message: 'Failed to create the notification.' });
  }
});

// DELETE /api/notifications/:id and DELETE /api/notifications (clear all) - own only
router.delete('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid notification id.' });
    const r = await Notification.deleteOne({ _id: req.params.id, userId: owner(req) });
    if (!r.deletedCount) return res.status(404).json({ message: 'Notification not found.' });
    res.json({ message: 'Deleted.' });
  } catch (err) {
    console.error('DELETE /notifications/:id failed:', err);
    res.status(500).json({ message: 'Failed to delete the notification.' });
  }
});

router.delete('/', async (req, res) => {
  try {
    const r = await Notification.deleteMany({ userId: owner(req) });
    res.json({ deleted: r.deletedCount });
  } catch (err) {
    console.error('DELETE /notifications failed:', err);
    res.status(500).json({ message: 'Failed to clear notifications.' });
  }
});

module.exports = router;