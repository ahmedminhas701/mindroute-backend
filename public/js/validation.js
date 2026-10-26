// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  MIND ROUTE - SHARED VALIDATION                                          ║
// ╚══════════════════════════════════════════════════════════════════════════╝
//
// ONE implementation, used by BOTH the browser and the server.
//
// Why it lives in public/js/ and not utils/: the browser can only load scripts
// from under public/, and the server can require() anything. So the module
// lives where the browser can reach it, and utils/validate.js is a one-line
// re-export so server code can write require('../utils/validate') naturally.
//
// This matters more than it looks. Before this file existed, the only shared
// validation helper in the entire project was validateThresholdOrder() in
// routes/thresholds.js. Everything else was ad hoc, which is how the app ended
// up accepting "hello" as a phone number, "hello" as an email address (creating
// a real login account with that username), negative fees, attendance of 500%,
// and a paidAmount larger than the totalFee.
//
// THE RULE: client-side validation exists to give the user a fast, specific
// error message. It is NOT a security boundary - anyone can open devtools and
// POST whatever they like. Every rule here is therefore run AGAIN on the
// server. Never add a check to only one side.
//
// Usage (both environments):
//   const V = require('../utils/validate');        // server
//   MRValidate.validate(body, MRValidate.STUDENT_RULES)   // browser
//
//   const { ok, values, errors } = V.validate(input, V.STUDENT_RULES);
//   // ok      -> boolean
//   // values  -> cleaned/normalised values, safe to write to the DB
//   // errors  -> { fieldName: 'human readable message' }

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();               // Node (server routes, seed.js)
  } else {
    root.MRValidate = factory();              // browser (window.MRValidate)
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ── Primitive normalisers ───────────────────────────────────────────────
  // Each returns { ok, value, error }. `value` is the cleaned form to store -
  // always store the normalised value, never the raw input, otherwise
  // "0300 1234567" and "0300-1234567" become two different strings that no
  // lookup will ever match.

  /**
   * Pakistani mobile number.
   *
   * Accepts anything a human might reasonably type:
   *   03001234567 · 0300-1234567 · 0300 123 4567 · (0300) 1234567
   *   +923001234567 · 0092 300 1234567 · 923001234567
   * and normalises every one of them to the single canonical form 0300-1234567,
   * which is the format seed.js already uses.
   *
   * Rejected on purpose: landlines, foreign numbers, and anything that isn't 11
   * digits starting 03. This is an LMS for Pakistani MDCAT/ECAT students where
   * the number is used to reach the student or their guardian, so a mobile is
   * what's actually wanted. If you ever need landlines, add a separate rule
   * type rather than loosening this one.
   */
  function normalizePhone(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return { ok: false, value: '', error: 'Phone number is required.' };
    }
    let digits = String(raw).replace(/[\s\-().]/g, '');

    if (digits.startsWith('+')) digits = digits.slice(1);
    if (digits.startsWith('0092')) digits = '0' + digits.slice(4);   // 0092300... -> 0300...
    else if (digits.startsWith('92') && digits.length === 12) digits = '0' + digits.slice(2);

    if (!/^\d+$/.test(digits)) {
      return { ok: false, value: '', error: 'Phone number can only contain digits, spaces, dashes and an optional +92.' };
    }
    if (!/^03\d{9}$/.test(digits)) {
      return {
        ok: false,
        value: '',
        error: 'Enter a valid Pakistani mobile number, e.g. 0300-1234567 (11 digits starting 03).',
      };
    }
    return { ok: true, value: digits.slice(0, 4) + '-' + digits.slice(4), error: null };
  }

  /**
   * CNIC / B-Form number - 13 digits, canonical form 35202-1234567-1.
   * Students under 18 have a B-Form, which uses the identical 13-digit format,
   * so one rule covers both.
   */
  function normalizeCNIC(raw) {
    if (raw === null || raw === undefined) return { ok: false, value: '', error: 'CNIC is required.' };
    const digits = String(raw).replace(/[\s\-]/g, '');
    if (!/^\d{13}$/.test(digits)) {
      return { ok: false, value: '', error: 'CNIC / B-Form must be 13 digits, e.g. 35202-1234567-1.' };
    }
    // First digit is the province/region code; 0 is never valid.
    if (digits[0] === '0') {
      return { ok: false, value: '', error: 'CNIC / B-Form cannot start with 0.' };
    }
    return {
      ok: true,
      value: digits.slice(0, 5) + '-' + digits.slice(5, 12) + '-' + digits.slice(12),
      error: null,
    };
  }

  /**
   * Email. Deliberately a pragmatic pattern, not RFC 5322 - the goal is to
   * reject "hello" and "a@b", not to litigate exotic-but-legal addresses.
   * Always lowercased, because User lookups are done on the lowercased form
   * and a mixed-case duplicate would slip past the unique index check.
   */
  function normalizeEmail(raw) {
    if (raw === null || raw === undefined) return { ok: false, value: '', error: 'Email is required.' };
    const value = String(raw).trim().toLowerCase();
    if (!value) return { ok: false, value: '', error: 'Email is required.' };
    if (value.length > 120) return { ok: false, value: '', error: 'Email is too long (max 120 characters).' };
    if (/\s/.test(value)) return { ok: false, value: '', error: 'Email cannot contain spaces.' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value)) {
      return { ok: false, value: '', error: "That doesn't look like a valid email address." };
    }
    return { ok: true, value, error: null };
  }

  /**
   * A person's name. Allows unicode letters (so "Ayesha Noor" and names with
   * accents both work), spaces, apostrophes, hyphens and dots - and requires at
   * least two actual letters, which is what rejects "1", "..." and "".
   */
  function normalizePersonName(raw, label) {
    const field = label || 'Name';
    if (raw === null || raw === undefined) return { ok: false, value: '', error: field + ' is required.' };
    const value = String(raw).trim().replace(/\s+/g, ' ');
    if (!value) return { ok: false, value: '', error: field + ' is required.' };
    if (value.length < 2)  return { ok: false, value: '', error: field + ' is too short.' };
    if (value.length > 60) return { ok: false, value: '', error: field + ' is too long (max 60 characters).' };

    // Count letters using a unicode-aware test where available, with an ASCII
    // fallback for older engines that don't support \p{L}.
    let letterCount;
    try {
      letterCount = (value.match(/\p{L}/gu) || []).length;
    } catch (e) {
      letterCount = (value.match(/[A-Za-z]/g) || []).length;
    }
    if (letterCount < 2) {
      return { ok: false, value: '', error: field + ' must contain at least two letters.' };
    }
    let hasBadChar;
    try {
      hasBadChar = /[^\p{L}\s.'\-]/u.test(value);
    } catch (e) {
      hasBadChar = /[^A-Za-z\s.'\-]/.test(value);
    }
    if (hasBadChar) {
      return { ok: false, value: '', error: field + ' can only contain letters, spaces, apostrophes, hyphens and dots.' };
    }
    return { ok: true, value, error: null };
  }

  /** Roll number / staff id - uppercased, alphanumeric plus - and /. */
  function normalizeRollNo(raw) {
    if (raw === null || raw === undefined) return { ok: false, value: '', error: 'Roll number is required.' };
    const value = String(raw).trim().toUpperCase().replace(/\s+/g, '');
    if (!value) return { ok: false, value: '', error: 'Roll number is required.' };
    if (!/^[A-Z0-9\-/]{3,20}$/.test(value)) {
      return {
        ok: false,
        value: '',
        error: 'Roll number must be 3-20 characters, letters/digits/dashes only (e.g. MR-2024-001).',
      };
    }
    return { ok: true, value, error: null };
  }

  /** Whole number within an inclusive range. Rejects "60,000" and "abc" instead
   *  of silently turning them into 60 and NaN, which is what parseInt did. */
  function toInt(raw, opts) {
    const o = opts || {};
    const label = o.label || 'Value';
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      return { ok: false, value: null, error: label + ' is required.' };
    }
    const str = String(raw).trim();
    if (!/^-?\d+$/.test(str)) {
      return { ok: false, value: null, error: label + ' must be a whole number (digits only, no commas).' };
    }
    const n = parseInt(str, 10);
    if (typeof o.min === 'number' && n < o.min) {
      return { ok: false, value: null, error: label + ' cannot be less than ' + o.min + '.' };
    }
    if (typeof o.max === 'number' && n > o.max) {
      return { ok: false, value: null, error: label + ' cannot be more than ' + o.max + '.' };
    }
    return { ok: true, value: n, error: null };
  }

  /** YYYY-MM-DD date, optionally constrained to produce an age in [minAge, maxAge]. */
  function normalizeDate(raw, opts) {
    const o = opts || {};
    const label = o.label || 'Date';
    if (!raw) return { ok: false, value: '', error: label + ' is required.' };
    const value = String(raw).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return { ok: false, value: '', error: label + ' must be a valid date (YYYY-MM-DD).' };
    }
    const d = new Date(value + 'T00:00:00Z');
    if (isNaN(d.getTime())) {
      return { ok: false, value: '', error: label + ' is not a real date.' };
    }
    // Catches 2024-02-31, which Date would otherwise roll forward to March 2.
    if (d.toISOString().slice(0, 10) !== value) {
      return { ok: false, value: '', error: label + ' is not a real date.' };
    }

    const now = new Date();
    if (o.mustBePast && d.getTime() > now.getTime()) {
      return { ok: false, value: '', error: label + ' cannot be in the future.' };
    }
    if (typeof o.minAge === 'number' || typeof o.maxAge === 'number') {
      const age = Math.floor((now - d) / (365.2425 * 24 * 60 * 60 * 1000));
      if (typeof o.minAge === 'number' && age < o.minAge) {
        return { ok: false, value: '', error: 'Age must be at least ' + o.minAge + ' (check the date of birth).' };
      }
      if (typeof o.maxAge === 'number' && age > o.maxAge) {
        return { ok: false, value: '', error: 'Age cannot be over ' + o.maxAge + ' (check the date of birth).' };
      }
    }
    return { ok: true, value, error: null };
  }

  /** Free text with a length cap and whitespace collapsed. */
  function normalizeText(raw, opts) {
    const o = opts || {};
    const label = o.label || 'Value';
    const max = o.max || 500;
    if (raw === null || raw === undefined) {
      return o.required
        ? { ok: false, value: '', error: label + ' is required.' }
        : { ok: true, value: '', error: null };
    }
    const value = String(raw).trim().replace(/[ \t]+/g, ' ');
    if (/[<>]/.test(value)) {
      return { ok: false, value: '', error: label + ' cannot contain < or >.' };
    }
    // `required` is opt-in so every existing caller keeps treating blank as an
    // acceptable empty string. Without it, a route that genuinely needs the
    // field had to write its own emptiness check next to this call, and half of
    // them forgot to.
    if (o.required && !value) {
      return { ok: false, value: '', error: label + ' is required.' };
    }
    if (value.length > max) {
      return { ok: false, value: '', error: label + ' is too long (max ' + max + ' characters).' };
    }
    if (o.min && value.length < o.min) {
      return { ok: false, value: '', error: label + ' must be at least ' + o.min + ' characters.' };
    }
    return { ok: true, value, error: null };
  }

  /** One of a fixed set. This is what makes a <select> trustworthy - a select
   *  in the browser is just a suggestion; the server has to enforce it.
   *
   *  Pass `default` to make the field optional: a blank value resolves to the
   *  default instead of erroring. Callers that omit `default` keep the old
   *  behaviour, where blank is "Choose a ...". */
  function normalizeEnum(raw, opts) {
    const o = opts || {};
    const label = o.label || 'Value';
    const allowed = o.values || [];
    if (raw === null || raw === undefined || String(raw).trim() === '') {
      if (Object.prototype.hasOwnProperty.call(o, 'default')) {
        return { ok: true, value: o.default, error: null };
      }
      return { ok: false, value: '', error: 'Choose a ' + label.toLowerCase() + '.' };
    }
    const value = String(raw).trim();
    if (allowed.indexOf(value) === -1) {
      return { ok: false, value: '', error: label + ' must be one of: ' + allowed.join(', ') + '.' };
    }
    return { ok: true, value, error: null };
  }

  // ── Escaping helpers ────────────────────────────────────────────────────

  /**
   * Escape a string for safe interpolation into an HTML template.
   *
   * This project builds most of its UI with `el.innerHTML = \`...${value}...\``.
   * Any user-controlled value in one of those templates is a stored-XSS hole:
   * a student could put <img src=x onerror=...> in an assignment answer and it
   * would execute in the teacher's browser when they opened the grading modal.
   */
  function escapeHtml(raw) {
    if (raw === null || raw === undefined) return '';
    return String(raw)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /** Escape for use inside a single-quoted JS string in an inline onclick=""
   *  attribute - e.g. onclick="removeSubject('${jsAttr(name)}')". */
  function escapeJsAttr(raw) {
    if (raw === null || raw === undefined) return '';
    return String(raw).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;')
      .replace(/</g, '\\u003C').replace(/\r?\n/g, ' ');
  }

  /** Escape user input before putting it inside a RegExp. Without this,
   *  a search box is a ReDoS vector: "(a+)+$" will hang the event loop. */
  function escapeRegex(raw) {
    return String(raw === null || raw === undefined ? '' : raw)
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Only allow through the keys explicitly listed.
   *
   * Every write route in this project used to do `Model.create(req.body)` or
   * `findOneAndUpdate(id, req.body)`, which lets a caller set ANY field - a
   * student could PUT {attendance: 100, feeStatus: 'Paid', enrolledCourseIds:
   * [1,2,3]} to their own record. Whitelist first, always.
   */
  function pick(obj, allowedKeys) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    allowedKeys.forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
    });
    return out;
  }

  // Keys that must never be accepted from a request body, no matter what.
  // Assigning to __proto__ / constructor / prototype can poison Object.prototype
  // for the whole process.
  const FORBIDDEN_KEYS = ['__proto__', 'constructor', 'prototype', '$where', '$ne', '$gt'];

  function isSafeKey(key) {
    return typeof key === 'string' && FORBIDDEN_KEYS.indexOf(key) === -1 && key[0] !== '$';
  }

  // ── The rule engine ─────────────────────────────────────────────────────

  const TYPES = {
    personName: function (v, r) { return normalizePersonName(v, r.label); },
    email:      function (v)    { return normalizeEmail(v); },
    phone:      function (v, r) {
      const res = normalizePhone(v);
      if (!res.ok && r.label) res.error = res.error.replace(/^Phone number/, r.label);
      return res;
    },
    cnic:       function (v)    { return normalizeCNIC(v); },
    rollNo:     function (v)    { return normalizeRollNo(v); },
    int:        function (v, r) { return toInt(v, r); },
    date:       function (v, r) { return normalizeDate(v, r); },
    text:       function (v, r) { return normalizeText(v, r); },
    enum:       function (v, r) { return normalizeEnum(v, r); },
  };

  /**
   * validate(input, rules, options)
   *
   * rules is { fieldName: { type, label, required, ...typeOptions } }
   *
   * options.partial - when true, fields absent from `input` are skipped rather
   * than reported as missing. Use it for PATCH-style partial updates. Note that
   * a field which IS present is still fully validated.
   */
  function validate(input, rules, options) {
    const o = options || {};
    const values = {};
    const errors = {};
    const src = input && typeof input === 'object' ? input : {};

    Object.keys(rules).forEach(function (field) {
      const rule = rules[field];
      const present = Object.prototype.hasOwnProperty.call(src, field);
      const raw = src[field];
      const isBlank = raw === null || raw === undefined || String(raw).trim() === '';

      if (o.partial && !present) return;

      if (isBlank) {
        if (rule.required) {
          errors[field] = (rule.label || field) + ' is required.';
        } else if (rule.default !== undefined) {
          values[field] = rule.default;
        } else {
          // Optional and empty - store an explicit empty so a cleared field
          // actually clears in the DB instead of keeping its old value.
          values[field] = rule.type === 'int' ? null : '';
        }
        return;
      }

      const handler = TYPES[rule.type];
      if (!handler) { errors[field] = 'Unknown validation type for ' + field + '.'; return; }

      const res = handler(raw, rule);
      if (res.ok) values[field] = res.value;
      else errors[field] = res.error;
    });

    return { ok: Object.keys(errors).length === 0, values: values, errors: errors };
  }

  /** Turns an errors object into one readable sentence, for a toast. */
  function firstError(errors) {
    const keys = Object.keys(errors || {});
    return keys.length ? errors[keys[0]] : null;
  }

  function allErrors(errors) {
    return Object.keys(errors || {}).map(function (k) { return errors[k]; }).join(' ');
  }

  // ── Shared option lists ─────────────────────────────────────────────────
  // Exported so the <select> options and the server-side enum check can never
  // drift apart. Add a value here and both sides pick it up.

  const GENDERS   = ['Male', 'Female', 'Other'];
  const FEE_STATUSES = ['Paid', 'Partial', 'Pending', 'Overdue'];
  const STATUSES  = ['active', 'inactive'];
  const DAYS      = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const CLASS_TYPES = ['Lecture', 'Practical', 'Test', 'Revision', 'Online'];
  const QUALIFICATIONS = ['MBBS', 'BS', 'BSc', 'MSc', 'MPhil', 'PhD', 'MA', 'MEd', 'Other'];

  // ── Entity rule sets ────────────────────────────────────────────────────

  const STUDENT_RULES = {
    name:          { type: 'personName', label: 'Full name',        required: true },
    rollNo:        { type: 'rollNo',     label: 'Roll number',      required: true },
    email:         { type: 'email',      label: 'Email',            required: true },
    phone:         { type: 'phone',      label: 'Phone number',     required: true },
    gender:        { type: 'enum',       label: 'Gender',           required: true, values: GENDERS },
    dob:           { type: 'date',       label: 'Date of birth',    required: true, mustBePast: true, minAge: 10, maxAge: 60 },
    city:          { type: 'text',       label: 'City',             required: true, max: 60, min: 2 },
    guardianName:  { type: 'personName', label: "Guardian's name",  required: true },
    guardianPhone: { type: 'phone',      label: "Guardian's phone", required: true },
    // Optional but still format-checked when supplied.
    cnic:          { type: 'cnic',       label: 'CNIC / B-Form',    required: false },
    address:       { type: 'text',       label: 'Address',          required: false, max: 200 },
    previousSchool:{ type: 'text',       label: 'Previous school / college', required: false, max: 100 },
    batch:         { type: 'text',       label: 'Batch',            required: false, max: 60 },
    entryTest:     { type: 'text',       label: 'Entry test',       required: false, max: 40 },
    feeStatus:     { type: 'enum',       label: 'Fee status',       required: true, values: FEE_STATUSES },
    totalFee:      { type: 'int',        label: 'Total fee',        required: true, min: 0, max: 10000000 },
    paidAmount:    { type: 'int',        label: 'Paid amount',      required: true, min: 0, max: 10000000 },
    attendance:    { type: 'int',        label: 'Attendance',       required: false, min: 0, max: 100, default: 0 },
  };

  const TEACHER_RULES = {
    name:          { type: 'personName', label: 'Full name',       required: true },
    email:         { type: 'email',      label: 'Email',           required: true },
    phone:         { type: 'phone',      label: 'Phone number',    required: true },
    gender:        { type: 'enum',       label: 'Gender',          required: true, values: GENDERS },
    cnic:          { type: 'cnic',       label: 'CNIC',            required: true },
    qualification: { type: 'enum',       label: 'Qualification',   required: true, values: QUALIFICATIONS },
    experience:    { type: 'int',        label: 'Years of experience', required: true, min: 0, max: 60 },
    status:        { type: 'enum',       label: 'Status',          required: false, values: STATUSES, default: 'active' },
    dob:           { type: 'date',       label: 'Date of birth',   required: false, mustBePast: true, minAge: 18, maxAge: 80 },
    city:          { type: 'text',       label: 'City',            required: false, max: 60 },
    address:       { type: 'text',       label: 'Address',         required: false, max: 200 },
    specialization:{ type: 'text',       label: 'Specialization',  required: false, max: 120 },
  };

  /**
   * Cross-field checks that a per-field rule engine can't express.
   * Returns an errors object in the same shape as validate().
   */
  function crossCheckStudent(values) {
    const errors = {};
    if (typeof values.totalFee === 'number' && typeof values.paidAmount === 'number') {
      if (values.paidAmount > values.totalFee) {
        errors.paidAmount = 'Paid amount (' + values.paidAmount + ') cannot be more than the total fee (' + values.totalFee + ').';
      }
    }
    if (values.phone && values.guardianPhone && values.phone === values.guardianPhone) {
      errors.guardianPhone = "Guardian's phone should be different from the student's own number.";
    }
    // A fee status that contradicts the numbers is a data-integrity problem:
    // reports and the fee filter both key off feeStatus, so "Paid" with money
    // outstanding quietly hides a debt.
    if (typeof values.totalFee === 'number' && typeof values.paidAmount === 'number') {
      if (values.feeStatus === 'Paid' && values.paidAmount < values.totalFee) {
        errors.feeStatus = 'Fee status is "Paid" but the paid amount is less than the total fee.';
      }
      if (values.feeStatus === 'Pending' && values.paidAmount > 0) {
        errors.feeStatus = 'Fee status is "Pending" but some amount has already been paid - use "Partial".';
      }
    }
    return errors;
  }

  return {
    // primitives
    normalizePhone: normalizePhone,
    normalizeCNIC: normalizeCNIC,
    normalizeEmail: normalizeEmail,
    normalizePersonName: normalizePersonName,
    normalizeRollNo: normalizeRollNo,
    normalizeDate: normalizeDate,
    normalizeText: normalizeText,
    normalizeEnum: normalizeEnum,
    toInt: toInt,
    // escaping / safety
    escapeHtml: escapeHtml,
    esc: escapeHtml,
    escapeJsAttr: escapeJsAttr,
    escapeRegex: escapeRegex,
    pick: pick,
    isSafeKey: isSafeKey,
    FORBIDDEN_KEYS: FORBIDDEN_KEYS,
    // engine
    validate: validate,
    firstError: firstError,
    allErrors: allErrors,
    crossCheckStudent: crossCheckStudent,
    // rule sets + option lists
    STUDENT_RULES: STUDENT_RULES,
    TEACHER_RULES: TEACHER_RULES,
    GENDERS: GENDERS,
    FEE_STATUSES: FEE_STATUSES,
    STATUSES: STATUSES,
    DAYS: DAYS,
    CLASS_TYPES: CLASS_TYPES,
    QUALIFICATIONS: QUALIFICATIONS,
  };
}));
