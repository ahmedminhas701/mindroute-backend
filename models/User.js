const mongoose = require('mongoose');

// ── The login record ─────────────────────────────────────────────────────────
//
// One User per Student/Teacher/Admin. The profile (Student, Teacher) holds the
// academic data; this holds only what's needed to sign in.
const userSchema = new mongoose.Schema({
  email: {
    type: String,
    unique: true,
    required: [true, 'Email is required.'],
    // lowercase + trim at the schema level as well as in the routes. The unique
    // index is case-SENSITIVE, so without this " Ayesha@Mindroute.pk " and
    // "ayesha@mindroute.pk" are two different users that both satisfy the index
    // - and only one of them can ever log in, because routes/auth.js looks up
    // the lowercased form.
    lowercase: true,
    trim: true,
    // Deliberately the same pragmatic pattern as normalizeEmail() in
    // public/js/validation.js. Its job is to reject "hello" and "a@b", which
    // used to create real, unusable login accounts.
    match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'That does not look like a valid email address.'],
    maxlength: [120, 'Email is too long (max 120 characters).'],
  },
  role: {
    type: String,
    enum: {
      values: ['student', 'teacher', 'admin'],
      message: '{VALUE} is not a valid role.',
    },
    required: [true, 'Role is required.'],
  },
  name: {
    type: String,
    trim: true,
    maxlength: [60, 'Name is too long (max 60 characters).'],
  },
  password: {
    type: String,
    required: [true, 'Password is required.'],
    // select:false means every query omits it unless explicitly asked for with
    // .select('+password'). routes/auth.js is the only place that does.
    select: false,
    // NOTE: there is deliberately NO minlength here. This field holds a bcrypt
    // HASH, which is always 60 characters - a minlength would validate the hash
    // and pass every time, including for the plaintext password "a". The real
    // check has to happen before hashing, and it does: routes/students.js,
    // routes/teachers.js and routes/auth.js all reject a plaintext password
    // shorter than 6 characters. If you add another account-creation path, that
    // check has to go there too; the schema cannot do it for you.
  },
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
