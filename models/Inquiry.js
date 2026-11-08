const mongoose = require('mongoose');

const inquirySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required.'],
    trim: true,
    maxlength: 80,
  },
  email: {
    type: String,
    required: [true, 'Email is required.'],
    trim: true,
    lowercase: true,
    maxlength: 120,
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Please enter a valid email address.'],
  },
  phone: {
    type: String,
    trim: true,
    maxlength: 30,
    default: '',
  },
  subject: {
    type: String,
    required: [true, 'Subject is required.'],
    trim: true,
    maxlength: 120,
    default: 'Admissions Inquiry',
  },
  message: {
    type: String,
    required: [true, 'Message is required.'],
    trim: true,
    maxlength: 3000,
  },
  status: {
    type: String,
    enum: ['unread', 'read', 'replied'],
    default: 'unread',
    index: true,
  },
  replyNote: {
    type: String,
    trim: true,
    maxlength: 2000,
    default: '',
  },
  repliedAt: {
    type: Date,
    default: null,
  },
}, { timestamps: true });

inquirySchema.index({ createdAt: -1 });

module.exports = mongoose.model('Inquiry', inquirySchema);
