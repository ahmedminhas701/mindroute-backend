const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
  q: {
    type: String,
    required: [true, 'Question text is required.'],
    trim: true,
    maxlength: 1000,
  },
  options: {
    type: [String],
    validate: {
      validator: arr => Array.isArray(arr) && arr.length >= 2,
      message: 'Each question must have at least 2 options.',
    },
  },
  correct: {
    type: Number,
    required: true,
    min: 0,
    default: 0,
  },
  explanation: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: '',
  },
}, { _id: true });

const quizSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Quiz title is required.'],
    trim: true,
    maxlength: 200,
  },
  courseId: {
    type: Number,
    required: [true, 'Course ID is required.'],
    index: true,
  },
  batchId: {
    type: String,
    trim: true,
    default: '',
  },
  teacherId: {
    type: String,
    trim: true,
    default: '',
  },
  timeLimit: {
    type: Number,
    default: 15, // in minutes (0 = untimed)
    min: 0,
    max: 180,
  },
  dueDate: {
    type: String,
    default: '',
    validate: {
      validator: v => !v || /^\d{4}-\d{2}-\d{2}$/.test(v),
      message: 'Due date must be YYYY-MM-DD.',
    },
  },
  published: {
    type: Boolean,
    default: false,
    index: true,
  },
  questions: [questionSchema],
}, { timestamps: true });

quizSchema.index({ courseId: 1, published: 1 });

module.exports = mongoose.model('Quiz', quizSchema);
