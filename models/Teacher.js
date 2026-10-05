const mongoose = require('mongoose');
const V = require('../utils/validate');

// See models/Student.js for why these schema-level validators exist alongside
// the rule engine in public/js/validation.js — short version: the rule engine
// gives good error messages, the schema guarantees nothing bad gets stored even
// through a route or script that forgets to call it.

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

const teacherSchema = new mongoose.Schema({
  id:    { type: String, required: true, unique: true, trim: true },
  name:  { type: String, required: [true, 'Full name is required.'], trim: true, minlength: 2, maxlength: 60 },
  email: {
    type: String, required: [true, 'Email is required.'], unique: true,
    lowercase: true, trim: true, validate: emailValidator,
  },
  phone: { type: String, required: [true, 'Phone number is required.'], trim: true, validate: phoneValidator },

  // Plural on purpose. This was `subject: String` until 2026-08-30; a teacher
  // in this academy routinely covers two or three (Bio + Chem is the common
  // pair). Batch.subjectTeachers maps ONE subject to one teacher, so the
  // singular field silently prevented assigning the same teacher to a second
  // subject in the same batch.
  //
  // ★ Every entry MUST match a Subject document's name exactly, including case.
  //   All subject matching in this codebase is exact string comparison — see
  //   enrollStudentsInBatchCourses(). "biology" and "Biology" are two different
  //   subjects as far as the code is concerned, and a mismatch makes a course
  //   silently vanish from the student's and teacher's course list with no
  //   error anywhere. That is exactly why the UI now offers a dropdown built
  //   from the Subject collection instead of a text box, and why the routes
  //   verify these names against the DB before saving.
  subjects: {
    type: [String],
    default: [],
    validate: {
      validator: arr => Array.isArray(arr) && arr.length > 0,
      message: 'Select at least one subject.',
    },
  },

  // ── Fields added 2026-08-30 ───────────────────────────────────────────────
  // A teacher record with only name/email/phone/subjects isn't enough to staff
  // a batch — there was no record of what anyone was qualified to teach.
  qualification: {
    type: String,
    enum: { values: V.QUALIFICATIONS, message: 'Qualification must be one of: ' + V.QUALIFICATIONS.join(', ') + '.' },
  },
  specialization: { type: String, trim: true, maxlength: 120 },   // free text: "Organic Chemistry"
  experience:     { type: Number, min: 0, max: 60, default: 0 },  // years
  gender:         { type: String, enum: { values: V.GENDERS, message: 'Gender must be Male, Female or Other.' } },
  cnic:           { type: String, trim: true, validate: cnicValidator },
  dob:            { type: String, validate: dateValidator },
  city:           { type: String, trim: true, maxlength: 60, default: '' },
  address:        { type: String, trim: true, maxlength: 200 },

  status:    { type: String, enum: V.STATUSES, default: 'active' },
  courseIds: { type: [Number], default: [] },
  joinDate:  { type: String, validate: dateValidator },
}, { timestamps: true });

module.exports = mongoose.model('Teacher', teacherSchema);
