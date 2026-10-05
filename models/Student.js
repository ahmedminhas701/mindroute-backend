const mongoose = require('mongoose');
const V = require('../utils/validate');

// ── Schema-level validation ──────────────────────────────────────────────────
//
// The rule engine in public/js/validation.js is the primary gate: it produces
// the friendly, field-specific messages the admin sees in the modal. These
// Mongoose validators are the LAST line of defence, and they exist because:
//
//   1. Not every write goes through a route I've hardened. seed.js, a future
//      import script, or a route added next month all bypass the rule engine
//      but cannot bypass the schema.
//   2. `runValidators: true` on findOneAndUpdate makes PUT/PATCH safe too.
//   3. They document the real shape of the data next to the data itself.
//
// Deliberately NOT enforced here: cross-field rules (paidAmount <= totalFee).
// Mongoose validators only see one path at a time and `this` is unreliable in
// update validators, so those live in V.crossCheckStudent() instead.

// Reusable validator factories that delegate to the shared rules, so a regex
// is never written twice.
const phoneValidator = {
  validator: v => v === '' || v === null || v === undefined || V.normalizePhone(v).ok,
  message: props => V.normalizePhone(props.value).error || 'Invalid phone number.',
};
const emailValidator = {
  validator: v => V.normalizeEmail(v).ok,
  message: props => V.normalizeEmail(props.value).error || 'Invalid email address.',
};
const cnicValidator = {
  validator: v => v === '' || v === null || v === undefined || V.normalizeCNIC(v).ok,
  message: props => V.normalizeCNIC(props.value).error || 'Invalid CNIC.',
};
const dateValidator = {
  validator: v => v === '' || v === null || v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v),
  message: 'Dates must be stored as YYYY-MM-DD.',
};

const attendanceRowSchema = new mongoose.Schema({
  subject:  { type: String, trim: true },
  total:    { type: Number, min: 0, default: 0 },
  attended: { type: Number, min: 0, default: 0 },
  missed:   { type: Number, min: 0, default: 0 },
}, { _id: false });

const quizScoreSchema = new mongoose.Schema({
  id: String, topic: String, subject: String, topicId: String,
  // A quiz score of -5 out of 0 used to be storable: both routes took the
  // client's numbers as gospel. min/max here plus a check in the route.
  score:    { type: Number, min: 0, default: 0 },
  total:    { type: Number, min: 1, default: 1 },
  date: String,
  feedback: { type: String, maxlength: 2000 },
  isAIRetry: Boolean, courseId: Number,
  attemptNum: { type: Number, min: 1, default: 1 },
}, { _id: false });

const assignmentSchema = new mongoose.Schema({
  id: String, topicId: String, title: String, course: String, courseId: Number,
  dueDate: { type: String, validate: dateValidator },
  submitted: { type: Boolean, default: false },
  submittedOn: String,
  marks:      { type: Number, min: 0, default: null },
  totalMarks: { type: Number, min: 1, default: null },
  grade: String,
  feedback: { type: String, maxlength: 2000 },
  approved: Boolean, manualGrade: Boolean,
  answerText: { type: String, maxlength: 20000 },
  fileUrl: String, fileName: String,
}, { _id: false });

const feeSchema = new mongoose.Schema({
  label:   { type: String, trim: true, maxlength: 120 },
  amount:  { type: Number, min: 0, default: 0 },
  dueDate: { type: String, validate: dateValidator },
  status:  { type: String, enum: V.FEE_STATUSES, default: 'Pending' },
}, { _id: false });

const studentSchema = new mongoose.Schema({
  // `required` matters as much as `unique` here. A unique index on a field that
  // is allowed to be missing does NOT prevent duplicates the way you'd expect:
  // the first document without the field stores null, and the *second* one
  // collides on null and throws a raw E11000 that used to reach the browser as
  // an unhandled 500.
  id:     { type: String, required: true, unique: true, trim: true },
  name:   { type: String, required: [true, 'Full name is required.'], trim: true, minlength: 2, maxlength: 60 },
  rollNo: { type: String, required: [true, 'Roll number is required.'], trim: true, uppercase: true, maxlength: 20 },
  email:  {
    type: String, required: [true, 'Email is required.'], unique: true,
    lowercase: true, trim: true, validate: emailValidator,
  },
  phone:  { type: String, required: [true, 'Phone number is required.'], trim: true, validate: phoneValidator },

  // ── Fields added 2026-08-30 ───────────────────────────────────────────────
  // The old record held name / rollNo / email / phone / city and nothing else,
  // which isn't enough to actually run an academy: there was no way to contact
  // a guardian, no date of birth, and no identity document.
  gender:         { type: String, enum: { values: V.GENDERS, message: 'Gender must be Male, Female or Other.' } },
  dob:            { type: String, validate: dateValidator },
  cnic:           { type: String, trim: true, validate: cnicValidator },
  guardianName:   { type: String, trim: true, maxlength: 60 },
  guardianPhone:  { type: String, trim: true, validate: phoneValidator },
  address:        { type: String, trim: true, maxlength: 200 },
  previousSchool: { type: String, trim: true, maxlength: 100 },

  batch:     { type: String, trim: true, default: '' },
  entryTest: { type: String, trim: true, default: '' },
  city:      { type: String, trim: true, maxlength: 60, default: '' },
  joinDate:  { type: String, validate: dateValidator },

  enrolledCourseIds: { type: [Number], default: [] },

  // Was an unbounded Number, so 500 or -20 were both storable and both then
  // rendered as a progress bar 500% wide.
  attendance: { type: Number, min: 0, max: 100, default: 0 },

  feeStatus:  { type: String, enum: V.FEE_STATUSES, default: 'Pending' },
  totalFee:   { type: Number, min: 0, default: 0 },
  paidAmount: { type: Number, min: 0, default: 0 },
  nextDue:    { type: String, validate: dateValidator },

  attendanceDetail: [attendanceRowSchema],
  quizScores: [quizScoreSchema],
  assignments: [assignmentSchema],
  fees: [feeSchema],

  topicProgress: { type: Map, of: Boolean, default: {} },
  lastTopic:     { type: Map, of: String,  default: {} },   // courseId (string) -> topicId
}, { timestamps: true });

// Derived, never stored — keeps "how much is still owed" in one place instead
// of being recomputed inline on the fees page, the dashboard and the admin table.
studentSchema.virtual('balance').get(function () {
  return Math.max(0, (this.totalFee || 0) - (this.paidAmount || 0));
});
studentSchema.set('toJSON', { virtuals: true });
studentSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Student', studentSchema);
