const express = require('express');
const router = express.Router();

const Inquiry = require('../models/Inquiry');
const { protect, restrictTo } = require('../middleware/auth');
const V = require('../utils/validate');

// POST /api/inquiries - Public endpoint from homepage
router.post('/', async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;

    const nameR = V.normalizePersonName ? V.normalizePersonName(name, 'Your name') : { ok: !!name, value: String(name || '').trim() };
    if (!nameR.ok) return res.status(400).json({ message: nameR.error || 'Please provide your name.' });

    const emailR = V.normalizeEmail(email);
    if (!emailR.ok) return res.status(400).json({ message: emailR.error || 'Please provide a valid email.' });

    const cleanMsg = String(message || '').trim();
    if (!cleanMsg || cleanMsg.length < 10) {
      return res.status(400).json({ message: 'Please write a message of at least 10 characters.' });
    }
    if (cleanMsg.length > 3000) {
      return res.status(400).json({ message: 'Message is too long (maximum 3,000 characters).' });
    }

    const cleanPhone = phone ? String(phone).trim().slice(0, 30) : '';
    const cleanSub = String(subject || 'Admissions Inquiry').trim().slice(0, 120);

    const inquiry = await Inquiry.create({
      name: nameR.value,
      email: emailR.value,
      phone: cleanPhone,
      subject: cleanSub,
      message: cleanMsg,
      status: 'unread',
    });

    res.status(201).json({
      message: 'Thank you for reaching out. Your inquiry has been received by our admissions team.',
      id: inquiry._id,
    });
  } catch (err) {
    console.error('POST /api/inquiries failed:', err);
    res.status(500).json({ message: 'Failed to submit inquiry. Please try again or call our office.' });
  }
});

// GET /api/inquiries - Admin only
router.get('/', protect, restrictTo('admin'), async (req, res) => {
  try {
    const filter = {};
    if (req.query.status && ['unread', 'read', 'replied'].includes(req.query.status)) {
      filter.status = req.query.status;
    }
    const list = await Inquiry.find(filter).sort({ createdAt: -1 }).lean();
    const unreadCount = await Inquiry.countDocuments({ status: 'unread' });
    res.json({ inquiries: list, unreadCount });
  } catch (err) {
    console.error('GET /api/inquiries failed:', err);
    res.status(500).json({ message: 'Failed to load inquiries.' });
  }
});

// PATCH /api/inquiries/:id - Admin updates status / note
router.patch('/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    const { status, replyNote } = req.body;
    const update = {};
    if (status && ['unread', 'read', 'replied'].includes(status)) {
      update.status = status;
      if (status === 'replied') update.repliedAt = new Date();
    }
    if (replyNote !== undefined) update.replyNote = String(replyNote).trim().slice(0, 2000);

    const doc = await Inquiry.findByIdAndUpdate(req.params.id, update, { returnDocument: 'after' });
    if (!doc) return res.status(404).json({ message: 'Inquiry not found.' });

    res.json({ message: 'Inquiry updated.', inquiry: doc, status: doc.status, replyNote: doc.replyNote });
  } catch (err) {
    console.error('PATCH /api/inquiries failed:', err);
    res.status(500).json({ message: 'Failed to update inquiry.' });
  }
});

// DELETE /api/inquiries/:id - Admin deletes inquiry
router.delete('/:id', protect, restrictTo('admin'), async (req, res) => {
  try {
    const doc = await Inquiry.findByIdAndDelete(req.params.id);
    if (!doc) return res.status(404).json({ message: 'Inquiry not found.' });
    res.json({ message: 'Inquiry deleted.' });
  } catch (err) {
    console.error('DELETE /api/inquiries failed:', err);
    res.status(500).json({ message: 'Failed to delete inquiry.' });
  }
});

module.exports = router;
