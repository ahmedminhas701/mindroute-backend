// ╔══════════════════════════════════════════════════════════════╗
// ║  MIND ROUTE LMS - app.js                                     ║
// ║  Single source of truth for all mock data + page logic.      ║
// ║                                                                ║
// ║  FILE MAP (search for these headers to jump around):         ║
// ║   1.  Storage helpers (generic localStorage read/write)      ║
// ║   2.  Entry tests                                            ║
// ║   3.  Users (mock login accounts)                             ║
// ║   4.  Teacher data & helpers                                  ║
// ║   5.  Students database                                       ║
// ║   6.  Teachers DB & Batches (admin data)                      ║
// ║   7.  Teacher schedule                                        ║
// ║   8.  Notifications                                           ║
// ║   9.  Courses database                                        ║
// ║  10.  Session & small DOM utils                               ║
// ║  11.  Course / progress / grading helpers                     ║
// ║  12.  Due-date helpers                                        ║
// ║  13.  Notification renderer                                   ║
// ║  14.  Sidebar setup                                            ║
// ║  15.  Grading thresholds                                       ║
// ║  16.  Page router (DOMContentLoaded)                           ║
// ║  17.  Student pages                                            ║
// ║  18.  Messaging (student ↔ teacher mock chat)                  ║
// ║  19.  Teacher pages                                            ║
// ║  20.  Admin pages (SPA: students / teachers / batches / tests) ║
// ║  21.  Login                                                    ║
// ║  22.  Toast notifications                                      ║
// ║  23.  AI Study Assistant + AI-generated quiz re-attempts       ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

// One-time integrity check: if a saved array is empty (corrupted state
// from a previous session), wipe it so the hard-coded defaults reload.
// (function checkDataIntegrity() {
//   try {
//     const students = JSON.parse(localStorage.getItem('mr_students_db') || 'null');
//     if (Array.isArray(students) && students.length === 0) {
//       localStorage.removeItem('mr_students_db');
//     }
//     const batches = JSON.parse(localStorage.getItem('mr_batches') || 'null');
//     if (Array.isArray(batches) && batches.length === 0) {
//       localStorage.removeItem('mr_batches');
//     }
//     const teachers = JSON.parse(localStorage.getItem('mr_teachers_db') || 'null');
//     if (Array.isArray(teachers) && teachers.length === 0) {
//       localStorage.removeItem('mr_teachers_db');
//     }
//     // COURSES is a plain object keyed by course id, not an array, so it
//     // needs its own emptiness check instead of the Array.isArray() one above.
//     const courses = JSON.parse(localStorage.getItem('mr_courses') || 'null');
//     if (courses && typeof courses === 'object' && !Array.isArray(courses) && Object.keys(courses).length === 0) {
//       localStorage.removeItem('mr_courses');
//     }
//     const tests = JSON.parse(localStorage.getItem('mr_tests') || 'null');
//     if (Array.isArray(tests) && tests.length === 0) {
//       localStorage.removeItem('mr_tests');
//     }
//     const thresholds = JSON.parse(localStorage.getItem('mr_thresholds') || 'null');
//     if (Array.isArray(thresholds) && thresholds.length === 0) {
//       localStorage.removeItem('mr_thresholds');
//     }
//   } catch (e) {
//     // Corrupt JSON, clear everything and start fresh.
//     ['mr_students_db', 'mr_batches', 'mr_teachers_db', 'mr_courses',
//      'mr_tests', 'mr_notifs', 'mr_thresholds', 'mr_teacher_schedule'].forEach(k => {
//       localStorage.removeItem(k);
//     });
//   }
// })();

'use strict';

// ── Where the API lives ──────────────────────────────────────────────────
//
// This was a hard-coded 'http://localhost:3000/api'. That worked only as long
// as two unrelated things stayed in step: this line, and PORT in .env. server.js
// reads `process.env.PORT || 5000`, so deleting the PORT line from .env moves
// the server to 5000 while every page keeps asking for 3000 - and the only
// symptom is that all data silently fails to load, on every page, with nothing
// but a network error in the console to explain it.
//
// Express now serves public/ itself (see server.js), so when a page is opened
// from the server the API is on the same origin and can be addressed relatively.
// The literal is kept as a fallback for opening the HTML straight off disk with
// file://, where location.origin is 'null' and a relative URL can't resolve.
const API_BASE = (location.protocol === 'http:' || location.protocol === 'https:')
  ? location.origin + '/api'
  : 'http://localhost:3000/api';

// ── Session (from earlier chunk) ──
function saveSession(token, user) {
  localStorage.setItem('mr_token', token);
  localStorage.setItem('mr_user', JSON.stringify(user));
}
function getSession() { return JSON.parse(localStorage.getItem('mr_user') || 'null'); }
function getToken()   { return localStorage.getItem('mr_token'); }
function clearSession() {
  localStorage.removeItem('mr_token');
  localStorage.removeItem('mr_user');
}

async function apiFetch(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && path !== '/auth/login') {
    clearSession();
    window.location.href = loginPagePath();
    throw new Error('Session expired.');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

// ── Data globals - populated by loadAppData(), not hardcoded anymore ──
let ENTRY_TESTS = [];
let TEACHERS_DB = [];
let STUDENTS_DB = [];
let SUBJECTS_DB = [];
let BATCHES = [];
let TEACHER_SCHEDULE = [];
let NOTIFICATIONS = [];
let GRADE_THRESHOLDS = [];
let COURSES = {};
let CURRENT_STUDENT = null;
let CURRENT_TEACHER = null;
const notifColors = { upload: 'si-blue', due: 'si-orange', live: 'si-blue', change: 'si-navy', overdue: 'si-red', schedule: 'si-green', quiz: 'si-orange' };

async function loadAppData() {
  const session = getSession();
  if (!session) return;



  // Everyone needs these - course catalog, entry tests, schedule, thresholds, notifications
  const [courseList, tests, schedule, thresholds, notifs, subjects] = await Promise.all([
    apiFetch('/courses'),
    apiFetch('/tests'),
    apiFetch('/schedule'),
    apiFetch('/thresholds'),
    apiFetch('/notifications'),
    apiFetch('/subjects'),
  ]);

  COURSES = {};
  courseList.forEach(c => { COURSES[c.id] = c; });
  ENTRY_TESTS = tests;
  TEACHER_SCHEDULE = schedule;
  GRADE_THRESHOLDS = thresholds;
  NOTIFICATIONS = notifs;
  SUBJECTS_DB = subjects;

  // Batches + teacher directory - needed by student dashboard too (teacher-name lookup)
  [BATCHES, TEACHERS_DB] = await Promise.all([
    apiFetch('/batches'),
    apiFetch('/teachers'),
  ]);

  if (session.role === 'student') {
    CURRENT_STUDENT = await apiFetch('/students/me');
    primeProgressCache(CURRENT_STUDENT.topicProgress); // from earlier chunk
  }
  if (session.role === 'teacher') {
    CURRENT_TEACHER = await apiFetch('/teachers/me');
  }
  if (session.role === 'admin' || session.role === 'teacher') {
    STUDENTS_DB = await apiFetch('/students');
  }
}





// Replaces the old TEACHERS_DB.find()/STUDENTS_DB.find() lookups -
// these now just return the already-loaded current-user record.
function getActiveStudent() { return CURRENT_STUDENT; }
function getActiveTeacher() { return CURRENT_TEACHER; }


// ══════════════════════════════════════════════════════════════════════════
//  SHARED UI HELPERS
//
//  Everything below is used by more than one page. They live here, above the
//  page renderers, so there is exactly one implementation of each - the bug
//  class this project kept hitting was two copies of the same function (one
//  in app.js, one in an inline <script>) drifting apart until the page ran
//  the wrong one.
// ══════════════════════════════════════════════════════════════════════════

// ── HTML escaping ────────────────────────────────────────────────────────
//
// Almost every list in this app is built with `innerHTML +=` and template
// literals. That means any value that came from a form - a student's name, a
// course title, a subject - is parsed as HTML. A name like
//   Ali <img src=x onerror=alert(1)>
// executes. Even without malice it breaks the page: a name containing & or <
// silently mangles the row.
//
// `esc()` is the short name so there's no excuse not to use it at every
// interpolation point. It delegates to the shared validator so the browser and
// the server escape identically.
function esc(v) {
  if (v === null || v === undefined) return '';
  if (window.MRValidate && window.MRValidate.escapeHtml) return window.MRValidate.escapeHtml(v);
  return String(v).replace(/[&<>"'`=/]/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
    "'": '&#39;', '`': '&#96;', '=': '&#61;', '/': '&#47;',
  }[c]));
}

/** Escaping for a value going inside a single-quoted onclick="..." attribute. */
function escAttr(v) {
  if (window.MRValidate && window.MRValidate.escapeJsAttr) return window.MRValidate.escapeJsAttr(v);
  return String(v === null || v === undefined ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

const HONORIFICS = /^(mr|mrs|ms|miss|dr|prof|sir|madam|engr)\.?$/i;
function nameParts(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  const core = parts.filter(p => !HONORIFICS.test(p));
  return core.length ? core : parts;
}
function firstName(name)  { return nameParts(name)[0] || ''; }
function initialsOf(name) { return nameParts(name).map(w => w[0]).join('').slice(0, 2).toUpperCase(); }

/** One date format everywhere: "30 Aug 2026". Accepts YYYY-MM-DD or any date string. */
function fmtDate(v) {
  if (!v) return '-';
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s.slice(0, 10) + 'T00:00:00') : new Date(s);
  return isNaN(d.getTime()) ? s : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** One fee-status colour mapping for every page. */
function feeBadgeClass(status) {
  return status === 'Paid' ? 'badge-green' : status === 'Partial' ? 'badge-orange' : 'badge-red';
}

/** Returns the URL only if it is a plain http(s) or same-site path, else ''. */
function safeHref(u) {
  const s = String(u == null ? '' : u).trim();
  return /^(https?:\/\/[^\s"'<>`\\]+|\/(?!\/)[^\s"'<>`\\]*)$/i.test(s) ? s : '';
}


// ── Teacher reference resolution ─────────────────────────────────────────
//
// `Course.teacher` used to store a teacher's display NAME. The server now
// stores the teacher's ID ('T001') instead, because a name is not a stable
// key: renaming a teacher used to orphan every course they taught, and two
// teachers with the same name were indistinguishable.
//
// The display layer therefore can't print `c.teacher` raw any more. This
// resolves either form - an id, or a legacy name - to the current display
// name, so a database that still holds old name-based values keeps rendering
// correctly instead of showing 'T001' to students.
function teacherLabel(ref) {
  if (!ref) return 'Unassigned';
  const byId = TEACHERS_DB.find(t => t.id === ref);
  if (byId) return byId.name;
  const byName = TEACHERS_DB.find(t => t.name === ref);
  if (byName) return byName.name;
  // Not in the directory: either a deleted teacher or a free-text legacy
  // value. Show the raw value rather than 'undefined' - an admin seeing
  // 'T007' in the teacher column is a usable clue; 'undefined' is not.
  return String(ref);
}

/** The Teacher record behind a Course.teacher value, or null. */
function teacherFromRef(ref) {
  if (!ref) return null;
  return TEACHERS_DB.find(t => t.id === ref) || TEACHERS_DB.find(t => t.name === ref) || null;
}

// ── <select> population ──────────────────────────────────────────────────
//
// CRITICAL TIMING NOTE: every dropdown in this app must be filled when the
// MODAL OPENS, never at page-parse time. The option lists come from
// SUBJECTS_DB / TEACHERS_DB / ENTRY_TESTS, which are empty until the async
// loadAppData() resolves. Code that populated a <select> during
// DOMContentLoaded produced a permanently empty dropdown, which is exactly
// why free-text subject inputs survived in this codebase - people needed a
// way around a dropdown that never had anything in it.
/**
 * @param {string} elId          id of the <select>
 * @param {Array}  items         strings, or objects
 * @param {object} opts
 *   value/label - key names when items are objects (default 'value'/'label')
 *   selected    - value to preselect
 *   placeholder - text for a leading empty option; pass null for none
 *   emptyText   - what to show when items is empty
 */
function populateSelect(elId, items, opts = {}) {
  const el = typeof elId === 'string' ? document.getElementById(elId) : elId;
  if (!el) return null;
  const {
    value = 'value', label = 'label', selected = '',
    placeholder = '- Select -', emptyText = null,
  } = opts;

  const list = Array.isArray(items) ? items : [];
  let html = '';
  if (!list.length && emptyText) {
    html = `<option value="">${esc(emptyText)}</option>`;
    el.innerHTML = html;
    el.value = '';
    return el;
  }
  if (placeholder !== null) html += `<option value="">${esc(placeholder)}</option>`;
  list.forEach(item => {
    const v = (item && typeof item === 'object') ? item[value] : item;
    const l = (item && typeof item === 'object') ? item[label] : item;
    html += `<option value="${esc(v)}">${esc(l)}</option>`;
  });
  el.innerHTML = html;
  // Assign after the options exist - setting .value first is a no-op because
  // a <select> silently rejects a value with no matching <option>.
  el.value = selected == null ? '' : String(selected);
  return el;
}

/**
 * The canonical subject names, sorted, as plain strings.
 *
 * SUBJECTS_DB holds raw Subject documents ({ _id, name, isCore }), but older
 * code paths sometimes handed it an array of bare strings. Rather than have
 * every caller re-derive the name defensively - which it was doing in three
 * separate places, and getting subtly different results - there is one reader.
 */
function subjectNames() {
  return (SUBJECTS_DB || [])
    .map(s => (typeof s === 'string' ? s : s && s.name))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

/** Subject dropdown, fed from the canonical Subject collection. */
function populateSubjectSelect(elId, selected = '', opts = {}) {
  return populateSelect(elId, subjectNames(), {
    selected,
    placeholder: opts.placeholder !== undefined ? opts.placeholder : '- Select subject -',
    emptyText: 'No subjects yet - add one on the Entry Tests page',
    ...opts,
  });
}

/**
 * Teacher dropdown. Option VALUES are teacher ids, because that is what the
 * server stores. `subject` narrows the list to teachers who actually teach it -
 * assigning a Chemistry teacher to a Biology course is rejected by the API, so
 * the form shouldn't offer it.
 */
function populateTeacherSelect(elId, selected = '', subject = '') {
  let list = (TEACHERS_DB || []).filter(t => t.status !== 'inactive');
  if (subject) {
    const matching = list.filter(t => Array.isArray(t.subjects) && t.subjects.includes(subject));
    // Keep a currently-assigned teacher visible even if they no longer teach
    // the subject, so editing an old course doesn't silently blank the field.
    if (selected && !matching.some(t => t.id === selected)) {
      const cur = teacherFromRef(selected);
      if (cur) matching.push(cur);
    }
    list = matching;
  }
  const items = list.map(t => ({
    value: t.id,
    label: t.subjects && t.subjects.length ? `${t.name} - ${t.subjects.join(', ')}` : t.name,
  }));
  return populateSelect(elId, items, {
    selected: teacherFromRef(selected) ? teacherFromRef(selected).id : '',
    placeholder: '- Unassigned -',
    emptyText: subject ? `No active teacher teaches ${subject}` : 'No teachers yet',
  });
}

/** Checkbox list of subjects (multi-select) into a container div. */
function renderSubjectCheckboxes(containerId, selected = [], cssClass = 'subject-cb') {
  const box = document.getElementById(containerId);
  if (!box) return;
  const names = subjectNames();
  const chosen = new Set((selected || []).map(String));
  if (!names.length) {
    box.innerHTML = '<div style="font-size:0.76rem;color:var(--text-light)">No subjects exist yet. Add them on the Entry Tests page first.</div>';
    return;
  }
  box.innerHTML = names.map(n => `
    <label style="display:inline-flex;align-items:center;gap:0.35rem;font-size:0.8rem;font-weight:500;
                  padding:0.3rem 0.55rem;border:1px solid var(--border);border-radius:var(--radius);
                  cursor:pointer;background:var(--white);margin:0 0.35rem 0.35rem 0">
      <input type="checkbox" class="${esc(cssClass)}" value="${esc(n)}" ${chosen.has(n) ? 'checked' : ''}>
      ${esc(n)}
    </label>`).join('');
}

/** Read back a checkbox list rendered by renderSubjectCheckboxes(). */
function readSubjectCheckboxes(cssClass = 'subject-cb') {
  return [...document.querySelectorAll('.' + cssClass + ':checked')].map(cb => cb.value);
}

// ── Inline field errors ──────────────────────────────────────────────────
//
// A single toast saying "Invalid input" makes the user hunt for the offending
// field. These put the message directly under the input that caused it, which
// is the only feedback that actually tells someone what to change.
//
// The server returns { message, errors: { fieldName: 'why' } } and the field
// names match the input ids by convention (prefix + '-' + field), so one call
// can paint every error at once.

/** Clear all error styling/messages inside a modal or form. */
function clearFieldErrors(rootId) {
  const root = rootId ? document.getElementById(rootId) : document;
  if (!root) return;
  root.querySelectorAll('.field-error').forEach(el => el.remove());
  root.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
}

/** Put one message under one input. */
function setFieldError(inputId, message) {
  const input = document.getElementById(inputId);
  if (!input) return false;
  input.classList.add('is-invalid');
  // Remove a previous message for this field so repeated submits don't stack.
  const holder = input.parentElement;
  if (!holder) return true;
  holder.querySelectorAll('.field-error').forEach(el => el.remove());
  const div = document.createElement('div');
  div.className = 'field-error';
  div.textContent = message;
  holder.appendChild(div);
  return true;
}

/**
 * Paint a whole { field: message } map.
 * @param prefix  input-id prefix, e.g. 'asm' for asm-name
 * @returns the messages that had no matching input, so the caller can still
 *          surface them in a toast instead of swallowing them.
 */
function applyFieldErrors(errors, prefix, rootId) {
  clearFieldErrors(rootId);
  const orphaned = [];
  Object.entries(errors || {}).forEach(([field, msg]) => {
    const id = prefix ? `${prefix}-${field}` : field;
    if (!setFieldError(id, msg)) orphaned.push(msg);
  });
  // Scroll the first bad field into view - in a long modal the error can
  // otherwise be below the fold and look like nothing happened.
  const firstBad = (rootId ? document.getElementById(rootId) : document)?.querySelector('.is-invalid');
  if (firstBad && firstBad.scrollIntoView) firstBad.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return orphaned;
}

/**
 * Validate a form client-side with the SAME rules the server uses, then paint
 * the failures inline. Returns the cleaned values, or null if anything failed.
 *
 * Client-side validation here is purely for fast, specific feedback - the
 * server re-validates everything with this identical rule set, so a caller
 * bypassing the form gains nothing.
 */
function validateForm(rules, readers, prefix, rootId) {
  clearFieldErrors(rootId);
  if (!window.MRValidate) return readers;   // validation.js missing: let the server decide
  const { ok, values, errors } = window.MRValidate.validate(readers, rules);
  if (ok) return values;
  const orphaned = applyFieldErrors(errors, prefix, rootId);
  showToast(orphaned.length ? orphaned[0] : window.MRValidate.firstError(errors));
  return null;
}

/** Read a field's raw string value by id ('' when the element is absent). */
function fv(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

/**
 * Turn an API error into inline field errors where possible.
 * apiFetch throws a plain Error with only `.message`, so the structured
 * `errors` object the routes return was being thrown away. apiFetchDetailed
 * below keeps it.
 */
async function apiFetchDetailed(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    clearSession();
    window.location.href = loginPagePath();
    throw new Error('Session expired.');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.fieldErrors = body.errors || null;
    err.payload = body;
    throw err;
  }
  return body;
}





// ──────────────────────────────────────────────────
// 1. GENERIC STORAGE HELPERS
//    All "databases" in this app are just JSON blobs in localStorage.
//    These two helpers replace the repeated
//    `JSON.parse(localStorage.getItem(key) || 'null') || fallback`
//    and `localStorage.setItem(key, JSON.stringify(value))` patterns
//    that used to be copy-pasted for every single data set below.
// ──────────────────────────────────────────────────
// c

/**
 * The correct relative path to login.html from wherever the current page
 * is. Student/Teacher/Admin pages live one folder below the site root, so
 * they need '../login.html'; root-level pages just need 'login.html'.
 * Shared by requireLogin() (redirecting a logged-out visitor) and the
 * logout button (setupSidebar()) so both agree on one path calculation.
 */
function loginPagePath() {
  const inSubfolder = location.pathname.includes('/Student/') ||
                       location.pathname.includes('/Teacher/') ||
                       location.pathname.includes('/Admin/');
  return inSubfolder ? '../login.html' : 'login.html';
}

/**
 * Route guard: every page except login.html requires a valid session.
 * Called first thing in the DOMContentLoaded handler, before any data is
 * rendered. This is what stops a logged-out visitor from opening
 * Student/Teacher/Admin pages directly and seeing someone else's data.
 * Returns true if the page is clear to continue rendering, false if it's
 * already redirecting away (in which case the caller should stop, not
 * render anything else).
 *
 * The "is this the login page" check is filename-based, not element-based
 * (some login.html markups don't use a <form id="login-form">, e.g. a
 * plain div-based layout with a button calling a login function directly
 * - checking for that id would wrongly say "not the login page," causing
 * requireLogin() to redirect login.html to itself in an infinite loop).
 *
 * NOTE: this only checks "is someone logged in," not "is the right ROLE
 * on this page." A logged-in student could still open a Teacher/ or
 * Admin/ URL directly. To also enforce that, compare `getSession().role`
 * against the folder in `location.pathname` below and redirect (or show
 * a 403-style message) on a mismatch.
 */
function requireLogin() {
  const currentFile = location.pathname.split('/').pop() || 'index.html';
  const isLoginPage = currentFile === 'login.html' || !!document.getElementById('login-form');
  if (isLoginPage) return true; // the login page itself never requires a session

  const session = getSession();
  if (!session) {
    window.location.href = loginPagePath(); // no session, send them to login
    return false;
  }

  // Role check: a logged-in user can only view pages under their own
  // role's folder. Mismatch sends them to their own dashboard instead
  // of rendering a page (and its data) that isn't theirs to see.
  const path = location.pathname;
  const pageRole = path.includes('/Student/') ? 'student'
                 : path.includes('/Teacher/') ? 'teacher'
                 : path.includes('/Admin/')   ? 'admin'
                 : null;

  if (pageRole && session.role !== pageRole) {
    window.location.href = roleHomePath(session.role);
    return false;
  }

  return true;
}

/**
 * The correct relative path to a role's own dashboard from wherever the
 * current page is. Used by requireLogin() to send a wrong-role visitor
 * somewhere real instead of showing them a page that isn't theirs.
 */
function roleHomePath(role) {
  // Admin goes to the real multi-page dashboard.html, NOT Admin/index.html -
  // index.html is the retired hash-routing SPA shell (it now just redirects here).
  const homes = { student: 'Student/dashboard.html', teacher: 'Teacher/dashboard.html', admin: 'Admin/dashboard.html' };
  const inSubfolder = location.pathname.includes('/Student/') ||
                       location.pathname.includes('/Teacher/') ||
                       location.pathname.includes('/Admin/');
  return (inSubfolder ? '../' : '') + (homes[role] || 'login.html');
}



// Per-topic "done" checkbox state for the student's curriculum view.
// Stored as { studentId: { topicId: true/false } } so that different
// students logged into the same browser each keep their own checkboxes,
// instead of everyone sharing one global "done" list.

let _progressCache = null;

function primeProgressCache(topicProgress) {
  _progressCache = { ...(topicProgress || {}) };
}

function isTopicDone(topicId, explicitMap = null) {
  const map = explicitMap || _progressCache;
  return !!(map && map[topicId]);
}

function setTopicDone(topicId, val) {
  if (!_progressCache) _progressCache = {};
  _progressCache[topicId] = val;

  const student = getActiveStudent();
  apiFetch(`/students/${student.id}/progress/${topicId}`, {
    method: 'PATCH',
    body: JSON.stringify({ done: val }),
  }).catch(err => {
    console.error('Failed to save progress:', err.message);
    showToast('Could not save progress - check your connection.');
  });
}

function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function show(id)         { const el = document.getElementById(id); if (el) el.style.display = 'block'; }
function hide(id)         { const el = document.getElementById(id); if (el) el.style.display = 'none'; }

// ──────────────────────────────────────────────────
// 11. COURSE / PROGRESS / GRADING HELPERS
// ──────────────────────────────────────────────────

/** Flattens a course's weeks → topics into one array. */
function allTopics(courseId) { return COURSES[courseId].weeks.flatMap(w => w.topics); }

/** % of a course's topics a student has manually checked "done" (defaults to whoever is currently logged in). */
function courseProgress(courseId, topicProgressMap = _progressCache) {
  const topics = allTopics(courseId);
  if (!topics.length) return 0;
  return Math.round(topics.filter(t => isTopicDone(t.id, topicProgressMap)).length / topics.length * 100);
}

/** Average progress score (quiz+assignment based) across all of the active student's courses. */
function overallProgress() {
  const student = getActiveStudent();
  if (!student.enrolledCourseIds.length) return 0;
  const scores = student.enrolledCourseIds.map(id => studentProgressScore(student, id));
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * % of a course's topics a specific student has manually checked "done".
 * Now that `mr_progress` (see §10) is scoped per student, this works
 * correctly for any student, not just the one currently logged in.
 */
function studentCourseProgress(student, courseId) {
  return courseProgress(courseId, student.topicProgress);
}


/** Legacy fixed-cutoff letter grade (kept for places that don't use the configurable GRADE_THRESHOLDS). */
function calcGradeLetter(pct) {
  if (pct >= 90) return 'A+'; if (pct >= 85) return 'A'; if (pct >= 80) return 'A-';
  if (pct >= 75) return 'B+'; if (pct >= 70) return 'B'; if (pct >= 65) return 'B-';
  if (pct >= 60) return 'C+'; if (pct >= 55) return 'C'; if (pct >= 50) return 'D';
  return 'F';
}

/** Overall quiz percentage across ALL of a student's quiz attempts (any course). */
function studentQuizAvg(student) {
  const scores = (student.quizScores || []).filter(q => !q.isAIRetry);
  if (!scores.length) return 0;
  const total = scores.reduce((a, b) => a + b.total, 0);
  const got   = scores.reduce((a, b) => a + b.score, 0);
  return total ? Math.round(got / total * 100) : 0;
}

function bindAutoHyphen(id, groups) {
  const el = document.getElementById(id);
  if (!el || el.dataset.hyphenBound) return;
  el.dataset.hyphenBound = '1';
  const total = groups.reduce((a, b) => a + b, 0);
  el.addEventListener('input', e => {
    if (/^(\+|92|0092)/.test(el.value)) return;
    const deleting = !!(e.inputType && e.inputType.startsWith('delete'));
    const digits = el.value.replace(/\D/g, '').slice(0, total);
    let out = '', pos = 0;
    groups.forEach((g, gi) => {
      const part = digits.slice(pos, pos + g);
      if (!part) return;
      out += (gi ? '-' : '') + part;
      pos += g;
    });
    let acc = 0;
    for (let gi = 0; gi < groups.length - 1; gi++) {
      acc += groups[gi];
      if (digits.length === acc && !deleting) out += '-';
    }
    el.value = out;
  });
}


/** Overall graded-assignment percentage, or null if nothing has been graded yet. */
function studentAssignmentAvg(student) {
  const graded = student.assignments.filter(a => a.marks !== null && a.totalMarks);
  if (!graded.length) return null;
  const total = graded.reduce((a, b) => a + b.totalMarks, 0);
  const got   = graded.reduce((a, b) => a + b.marks, 0);
  return Math.round(got / total * 100);
}

/**
 * Weighted composite score for a student in one course:
 *  20% course-checkbox progress · 35% quiz average · 35% assignment average · 10% attendance.
 * Used on the teacher's student-list table.
 */
function studentOverallScore(student, courseId) {
  const cp = studentCourseProgress(student, courseId);
  const qv = studentQuizAvg(student);
  const av = studentAssignmentAvg(student) || 0;
  const attRow = student.attendanceDetail.find(a => a.subject === COURSES[courseId].subject);
  const att = attRow ? Math.round(attRow.attended / attRow.total * 100) : student.attendance;
  return Math.round(cp * 0.2 + qv * 0.35 + av * 0.35 + att * 0.1);
}

// ──────────────────────────────────────────────────
// 12. DUE-DATE HELPERS
// ──────────────────────────────────────────────────

/** Whole days between today and a YYYY-MM-DD due date. Negative = overdue. */
function getDueDays(dueDateStr) {
  if (!dueDateStr) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  // Parse the YYYY-MM-DD string as local midnight, not UTC midnight.
  // new Date('YYYY-MM-DD') parses as UTC, which in a timezone ahead of
  // UTC (e.g. Pakistan, UTC+5) shifts every due date a few hours into
  // the future and overcounts "days remaining" by one, every time.
  const [y, m, d] = dueDateStr.split('-').map(Number);
  const due = new Date(y, m - 1, d);
  return Math.ceil((due - now) / (1000 * 60 * 60 * 24));
}

/** Small colored "Due in Xd / Overdue / Due today" pill, as HTML. */
function dueBadge(days) {
  if (days === null) return '';
  if (days < 0)   return `<span class="due-warning overdue">Overdue by ${Math.abs(days)}d</span>`;
  if (days === 0) return `<span class="due-warning urgent">Due today</span>`;
  if (days <= 3)  return `<span class="due-warning urgent">Due in ${days}d</span>`;
  return `<span class="due-warning ok">Due in ${days}d</span>`;
}

/** Every topic with a due date across the active student's enrolled courses, soonest first. */
function getDeadlines() {
  const student = getActiveStudent();
  const list = [];
  student.enrolledCourseIds.forEach(cid => {
    const c = COURSES[cid];
    if (!c) return;
    c.weeks.forEach(w => w.topics.forEach(t => {
      if (t.dueDate) {
        const days = getDueDays(t.dueDate);
        list.push({ title: t.title, course: c.title, icon: c.icon, dueDate: t.dueDate, days, courseId: cid, topicId: t.id });
      }
    }));
  });
  return list.sort((a, b) => a.days - b.days);
}

function timeAgo(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} min${mins !== 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr${hrs !== 1 ? 's' : ''} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days !== 1 ? 's' : ''} ago`;
}

// ──────────────────────────────────────────────────
// 13. NOTIFICATION RENDERER (the bell icon dropdown in the topbar)
// ──────────────────────────────────────────────────
function renderNotifBell() {
  const bell  = document.getElementById('notif-bell');
  const count = document.getElementById('notif-count');
  const list  = document.getElementById('notif-list');
  if (!bell) return;

  const uc = unreadCount();
  if (count) { count.textContent = uc; count.style.display = uc > 0 ? 'flex' : 'none'; }

  if (list) {
    list.innerHTML = '';
    if (!NOTIFICATIONS.length) { list.innerHTML = '<div class="notif-empty">No notifications</div>'; return; }
    NOTIFICATIONS.forEach(n => {
      const item = document.createElement('div');
      item.className = 'notif-item' + (n.read ? '' : ' unread');
      item.innerHTML = `
        <div class="notif-icon ${esc(notifColors[n.type] || 'si-blue')}" style="font-size:0.7rem;font-family:var(--font-mono)">${esc(String(n.type || '').slice(0, 2).toUpperCase())}</div>
        <div class="notif-body" style="flex:1"><p><strong>${esc(n.title)}</strong>${n.body ? ' - ' + esc(n.body) : ''}</p><small>${esc(timeAgo(n.createdAt))}</small></div>
        ${!n.read ? '<div class="notif-dot"></div>' : ''}`;
      item.onclick = async () => {
        try {
          await apiFetch(`/notifications/${n._id}/read`, { method: 'PATCH' });
          n.read = true;
          renderNotifBell();
        } catch (err) {
          showToast(err.message);
        }
      };
      list.appendChild(item);
    });
  }
}

async function markAllRead() {
  try {
    await apiFetch('/notifications/read-all', { method: 'PATCH' });
    NOTIFICATIONS.forEach(n => n.read = true);
    renderNotifBell();
  } catch (err) {
    showToast(err.message);
  }
}

// Global click handler: toggle the notif dropdown open/closed.
document.addEventListener('click', e => {
  const dropdown = document.getElementById('notif-dropdown');
  if (!dropdown) return;
  if (e.target.closest('#notif-bell-wrap')) { dropdown.classList.toggle('open'); renderNotifBell(); }
  else dropdown.classList.remove('open');
});

// ──────────────────────────────────────────────────
// 14. SIDEBAR SETUP (runs on every page - avatar initials, active nav link, logout)
// ──────────────────────────────────────────────────
function openChangePasswordModal() {
  let m = document.getElementById('change-pw-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'change-pw-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:2000;backdrop-filter:blur(3px);padding:1rem';
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div style="background:var(--white);border-radius:var(--radius-xl);padding:1.5rem;width:100%;max-width:400px;border:1px solid var(--border);box-shadow:var(--shadow-lg)">
      <h3 style="font-size:1rem;font-weight:600;margin-bottom:1rem">Change Password</h3>
      <div class="form-group"><label>Current Password</label><input type="password" class="form-control" id="cpw-currentPassword" autocomplete="current-password"></div>
      <div class="form-group"><label>New Password</label><input type="password" class="form-control" id="cpw-newPassword" autocomplete="new-password" maxlength="72"><span class="field-hint">8 to 72 characters.</span></div>
      <div class="form-group"><label>Confirm New Password</label><input type="password" class="form-control" id="cpw-confirm" autocomplete="new-password" maxlength="72"></div>
      <div style="display:flex;gap:0.65rem;justify-content:flex-end;margin-top:0.5rem">
        <button class="btn btn-ghost btn-sm" onclick="closeChangePasswordModal()">Cancel</button>
        <button class="btn btn-primary btn-sm" id="cpw-save" onclick="submitChangePassword()">Update Password</button>
      </div>
    </div>`;
  m.style.display = 'flex';
}
function closeChangePasswordModal() {
  const m = document.getElementById('change-pw-modal');
  if (m) m.style.display = 'none';
}
async function submitChangePassword() {
  clearFieldErrors('change-pw-modal');
  const cur = fv('cpw-currentPassword'), nw = fv('cpw-newPassword'), cf = fv('cpw-confirm');
  if (!cur) { setFieldError('cpw-currentPassword', 'Enter your current password.'); return; }
  if (nw.length < 8) { setFieldError('cpw-newPassword', 'Use at least 8 characters.'); return; }
  if (nw !== cf) { setFieldError('cpw-confirm', 'The two passwords do not match.'); return; }
  const btn = document.getElementById('cpw-save');
  if (btn) btn.disabled = true;
  try {
    await apiFetchDetailed('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: cur, newPassword: nw }) });
    closeChangePasswordModal();
    showToast('Password updated.');
  } catch (err) {
    if (err.fieldErrors) {
      const orphans = applyFieldErrors(err.fieldErrors, 'cpw', 'change-pw-modal');
      if (orphans.length) showToast(orphans[0]);
    } else {
      showToast(err.message);
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}


function setupSidebar() {


  // Highlight the sidebar link matching the current page filename.
  const currentFile = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-item').forEach(link => {
    const href = link.getAttribute('href');
    if (!href) return;
    if (href.startsWith('#')) return; // hash-based SPA links are handled by navigateTo()
    const linkFile = href.split('/').pop();
    if (linkFile && linkFile === currentFile) link.classList.add('active');
  });

  const session = getSession();
  if (session) {
    // const initials = session.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const initials = initialsOf(session.name);
    const av = document.getElementById('sb-avatar');
    const sn = document.getElementById('sb-name');
    if (av) av.textContent = initials;
    // if (sn) sn.textContent = session.name.split(' ')[0];
    if (sn) sn.textContent = firstName(session.name);
  }

  const nb = document.getElementById('notif-nav-badge');
  const uc = unreadCount();
  if (nb) { nb.textContent = uc; nb.style.display = uc > 0 ? 'inline' : 'none'; }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', e => {
      e.preventDefault();
      clearSession();
      window.location.href = loginPagePath();
    });
    if (!document.getElementById('change-pw-link')) {
      const a = document.createElement('a');
      a.href = '#'; a.id = 'change-pw-link'; a.className = 'nav-item';
      a.innerHTML = '<span class="nav-icon">&#9672;</span> Change Password';
      a.addEventListener('click', e => { e.preventDefault(); openChangePasswordModal(); });
      logoutBtn.parentNode.insertBefore(a, logoutBtn);
    }
  }
  renderNotifBell();
}

// ──────────────────────────────────────────────────
// 15. GRADE THRESHOLDS
//    Admin-configurable cutoffs (e.g. "A+ starts at 90%"). Assignment/quiz
//    grades are recomputed from these whenever they change.
// ──────────────────────────────────────────────────
// let GRADE_THRESHOLDS = loadJSON('mr_thresholds', [
//   { min: 90, grade: 'A+' }, { min: 85, grade: 'A'  }, { min: 80, grade: 'A-' },
//   { min: 75, grade: 'B+' }, { min: 70, grade: 'B'  }, { min: 65, grade: 'B-' },
//   { min: 60, grade: 'C+' }, { min: 55, grade: 'C'  }, { min: 50, grade: 'D'  },
//   { min: 0,  grade: 'F'  },
// ]);
// function saveThresholds() { saveJSON('mr_thresholds', GRADE_THRESHOLDS); }

/** Highest-matching grade for a percentage, per the current GRADE_THRESHOLDS (assumed sorted highest-first). */
function calcGradeFromThreshold(pct) {
  for (const t of GRADE_THRESHOLDS) {
    if (pct >= t.min) return t.grade;
  }
  return 'F';
}

/**
 * Reads the threshold strip, sends it, and reports how many students were
 * regraded.
 *
 * The read used to be `parseInt(inp.value) || 0`, which turns a blank or
 * non-numeric box into 0 and then writes that 0 into GRADE_THRESHOLDS *before*
 * the request is even sent. If the request then failed, the in-memory array was
 * already corrupted and the strip re-rendered showing 0 for that grade. The
 * values are now collected into a separate array and only committed once the
 * server has accepted them.
 */
async function applyThresholds() {
  const inputs = [...document.querySelectorAll('#threshold-editor input[type=number]')];
  const proposed = GRADE_THRESHOLDS.map(t => ({ ...t }));

  for (const inp of inputs) {
    const idx = parseInt(inp.dataset.idx, 10);
    const row = proposed[idx];
    if (!row) continue;
    const raw = inp.value.trim();
    if (raw === '' || !/^\d+$/.test(raw)) {
      showToast(`Enter a whole number between 0 and 100 for grade ${row.grade}.`);
      inp.focus();
      return;
    }
    const n = parseInt(raw, 10);
    if (n < 0 || n > 100) {
      showToast(`Grade ${row.grade} must be between 0 and 100.`);
      inp.focus();
      return;
    }
    row.min = n;
  }

  try {
    const result = await apiFetch('/thresholds', {
      method: 'PUT',
      body: JSON.stringify({ thresholds: proposed }),
    });
    GRADE_THRESHOLDS = result.thresholds;          // only now, after it stuck
    STUDENTS_DB = await apiFetch('/students');     // refresh recomputed grades
    renderGrading();
    showToast(`Thresholds updated - ${result.recomputedStudents} student(s) recomputed.`);
  } catch (err) {
    showToast(err.message);
    renderGrading();                               // put the accepted values back on screen
  }
}

/** Teacher approves a graded assignment; this locks in the grade and triggers an attendance check. */

async function approveGrade(studentId, assignmentId) {
  const student = STUDENTS_DB.find(s => s.id === studentId);
  if (!student) return;
  const assign = student.assignments.find(a => a.id === assignmentId);
  if (!assign) return;

  try {
    const updated = await apiFetch(`/students/${studentId}/assignments/${assignmentId}/approve`, {
      method: 'PATCH',
    });
    Object.assign(assign, updated);
    renderGrading();
    showToast('Grade approved.');
  } catch (err) {
    showToast(err.message);
  }
}

/**
 * Pressing Back from the dashboard would land on login.html while the user
 * still holds a valid session. Instead, ask first; "Yes" really logs out.
 * Entries: [..., dashboard(base), dashboard(top)]. Back from "top" lands on
 * "base", which is where we intercept.
 */
function installBackLogoutGuard() {
  const st = history.state || {};
  if (!st.mrTop) {
    if (!st.mrBase) history.replaceState({ mrBase: true }, '', location.href);
    history.pushState({ mrTop: true }, '', location.href);
  }
  window.addEventListener('popstate', e => {
    if (!e.state || !e.state.mrBase) return;
    if (confirm('Going back will log you out of your account. Do you want to log out?')) {
      clearSession();
      window.location.replace(loginPagePath());
    } else {
      history.pushState({ mrTop: true }, '', location.href);
    }
  });
}

function showCredentials({ title, name, email, password }) {
  let m = document.getElementById('credentials-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'credentials-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:2000;backdrop-filter:blur(3px);padding:1rem';
    document.body.appendChild(m);
  }
  const loginUrl = location.origin + '/login.html';
  m.innerHTML = `
    <div style="background:var(--white);border-radius:var(--radius-xl);padding:1.5rem;width:100%;max-width:440px;border:1px solid var(--border);box-shadow:var(--shadow-lg)">
      <h3 style="font-size:1rem;font-weight:600;margin-bottom:0.25rem">${esc(title)}</h3>
      <p style="font-size:0.8rem;color:var(--text-mid);margin-bottom:1rem;line-height:1.5">
        Share these details with ${esc(name)}. The password is shown only now and cannot be viewed again; if it is lost, use Reset Password.
      </p>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:0.85rem 1rem;font-family:var(--font-mono);font-size:0.82rem;line-height:1.9;word-break:break-all">
        <div>Page: ${esc(loginUrl)}</div>
        <div>Email: ${esc(email)}</div>
        <div>Password: <strong>${esc(password)}</strong></div>
      </div>
      <div style="display:flex;gap:0.65rem;justify-content:flex-end;margin-top:1rem">
        <button class="btn btn-outline btn-sm" id="cred-copy-btn">Copy</button>
        <button class="btn btn-primary btn-sm" onclick="document.getElementById('credentials-modal').style.display='none'">Done</button>
      </div>
    </div>`;
  m.style.display = 'flex';
  document.getElementById('cred-copy-btn').onclick = async () => {
    try {
      await navigator.clipboard.writeText(`Mind Route login\nPage: ${loginUrl}\nEmail: ${email}\nPassword: ${password}`);
      showToast('Copied.');
    } catch (e) { showToast('Could not copy. Select the text and copy it manually.'); }
  };
}

async function resetCurrentTeacherPassword() {
  const id = fv('atm-id'); if (!id) return;
  const t = TEACHERS_DB.find(x => x.id === id);
  if (!confirm(`Reset the password for ${t ? t.name : 'this teacher'}? Their current password will stop working.`)) return;
  try {
    const r = await apiFetchDetailed(`/teachers/${encodeURIComponent(id)}/reset-password`, { method: 'POST' });
    showCredentials({ title: 'Password reset', name: t ? t.name : 'the teacher', email: r.email, password: r.tempPassword });
  } catch (err) { showToast(err.message); }
}

async function resetCurrentStudentPassword() {
  const id = fv('asm-id'); if (!id) return;
  const s = STUDENTS_DB.find(x => x.id === id);
  if (!confirm(`Reset the password for ${s ? s.name : 'this student'}? Their current password will stop working.`)) return;
  try {
    const r = await apiFetchDetailed(`/students/${encodeURIComponent(id)}/reset-password`, { method: 'POST' });
    showCredentials({ title: 'Password reset', name: s ? s.name : 'the student', email: r.email, password: r.tempPassword });
  } catch (err) { showToast(err.message); }
}


// ──────────────────────────────────────────────────
// 16. PAGE ROUTER
//    This is a static multi-page site (not a full SPA), so each HTML file
//    just needs the handlers relevant to it. We detect which page we're on
//    by checking for a page-specific element id, then call its renderer.
// ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  if (!requireLogin()) return;

  try {
    await loadAppData();
  } catch (err) {
    console.error('Failed to load app data:', err.message);
    showToast('Failed to load data - check your connection.');
    return;
  }

  setupSidebar();


  if (/\/dashboard\.html$/.test(location.pathname)) installBackLogoutGuard();
  ['asm-phone', 'asm-guardianPhone', 'atm-phone'].forEach(id => bindAutoHyphen(id, [4, 7]));
  ['asm-cnic', 'atm-cnic'].forEach(id => bindAutoHyphen(id, [5, 7, 1]));
  if (document.getElementById('dash-courses'))         renderStudentDashboard();
  if (document.getElementById('courses-container'))    renderCoursesList();
  if (document.getElementById('curriculum-container'))  renderCourseDetail();
  if (document.getElementById('schedule-container'))    renderSchedule();
  if (document.getElementById('attendance-tbody'))      renderAttendance();
  if (document.getElementById('fees-tbody'))            renderFees();
  if (document.getElementById('performance-container')) renderPerformance();

  if (document.getElementById('t-stats'))               renderTeacherDashboard();
  if (document.getElementById('teacher-courses-grid'))  renderTeacherCourses();
  if (document.getElementById('students-tbody'))        renderTeacherStudents();
  if (document.getElementById('grading-container'))     initGrading();
  if (document.getElementById('teacher-schedule-grid')) renderTeacherSchedule();

  // Admin pages - real multi-page files, same pattern as Student/Teacher above
  if (document.getElementById('admin-students-tbody'))  renderAdminStudents();
  if (document.getElementById('admin-teachers-tbody'))  renderAdminTeachers();
  if (document.getElementById('admin-batches-grid'))    renderAdminBatches();
  if (document.getElementById('tests-tbody'))           renderTestTags();
  if (document.getElementById('admin-subjects-tbody'))  renderAdminSubjects();
  if (document.getElementById('admin-courses-grid'))    renderAdminCourses();
  if (document.getElementById('admin-overview'))        renderAdminDashboard();

  // NOTE: there is no `if (document.getElementById('login-form')) setupLogin();`
  // line here any more. That id exists in no HTML file in this project, so the
  // call never fired. login.html owns its own doLogin().
});
// ══════════════════════════════════════════════════
//   17. STUDENT PAGES
// ══════════════════════════════════════════════════

/** Renders the student home dashboard: stat cards, enrolled courses, today/tomorrow's classes, deadlines, and profile summary. */
function renderStudentDashboard() {
  const s = getActiveStudent();

  // Sidebar identity
  const av = document.getElementById('sb-avatar');
  const sn = document.getElementById('sb-name');
  if (av) av.textContent = initialsOf(s.name);
  if (sn) sn.textContent = firstName(s.name);

  // Topbar
  setText('topbar-roll', s.rollNo);
  setText('topbar-test', s.entryTest + ' Batch');

  // Stat cards
  const op = overallProgress();
  setText('stat-courses',    s.enrolledCourseIds.length);
  setText('stat-progress',   op + '%');
  setText('stat-progress-2', op + '%');
  setText('stat-att',        s.attendance + '%');
  setText('stat-fee',        s.feeStatus);
  setText('stat-due', s.nextDue ? fmtDate(s.nextDue) : '-');

  const opBar = document.getElementById('overall-prog-bar');
  if (opBar) opBar.style.width = op + '%';

  // Enrolled course list
  const cl = document.getElementById('dash-courses');
  if (cl) {
    cl.innerHTML = '';
    if (!s.enrolledCourseIds.length) {
      cl.innerHTML = '<p style="color:var(--text-light);font-size:0.82rem">No courses enrolled yet.</p>';
    } else {
      s.enrolledCourseIds.forEach(id => {
        const c = COURSES[id];
        if (!c) return;
        const pct = studentProgressScore(s, id);
        cl.innerHTML += `<div class="course-row">
          <div class="cr-icon" style="background:${c.colorLight};color:${c.color};
               font-family:var(--font-mono);font-weight:700;font-size:0.85rem">${c.icon}</div>
          <div class="cr-info">
            <h4>${esc(c.title)}</h4>
            <div class="progress-track">
              <div class="progress-fill" style="width:${pct}%;background:${c.color}"></div>
            </div>
            <small>${pct}% complete</small>
          </div>
          <a href="course-detail.html?id=${c.id}" class="btn btn-outline btn-sm">Open</a>
        </div>`;
      });
    }
  }

  // Today / tomorrow's classes
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const todayName    = days[new Date().getDay()];
  const tomorrowName = days[(new Date().getDay() + 1) % 7];
  renderDayClasses('dash-today',    todayName,    'today');
  renderDayClasses('dash-tomorrow', tomorrowName, 'tomorrow');

  // Upcoming deadlines (top 5)
  const dlContainer = document.getElementById('dash-deadlines');
  if (dlContainer) {
    const dls = getDeadlines().slice(0, 5);
    if (!dls.length) {
      dlContainer.innerHTML = '<p style="color:var(--text-light);font-size:0.82rem">No upcoming deadlines.</p>';
    } else {
      dlContainer.innerHTML = '';
      dls.forEach(dl => {
        const color = dl.days < 0 ? 'var(--danger)' : dl.days <= 3 ? 'var(--warning)' : 'var(--success)';
        const timeText = dl.days < 0
          ? `${Math.abs(dl.days)}d overdue`
          : dl.days === 0 ? 'Today'
          : dl.days === 1 ? 'Tomorrow'
          : `${dl.days} days`;
        const c = COURSES[dl.courseId];
        if (!c) return;
        dlContainer.innerHTML += `<div class="deadline-item">
          <div class="dl-icon" style="background:${c.colorLight};color:${c.color};
               font-family:var(--font-mono);font-weight:700;font-size:0.75rem">${c.icon}</div>
          <div class="dl-info" style="flex:1"><h4>${dl.title}</h4><p>${esc(c.title)}</p></div>
          <span class="dl-time" style="color:${color}">${timeText}</span>
        </div>`;
      });
    }
  }

  // Profile block
  setText('dash-roll',  s.rollNo);
  setText('dash-batch', s.batch);
  setText('dash-test',  s.entryTest);
  setText('dash-email', s.email);
  setText('dash-phone', s.phone);
  setText('dash-city',  s.city);

  // Teacher names, resolved from the student's batch → subjectTeachers map
  const studentBatch = BATCHES.find(b => b.name === s.batch);
  let teacherNames = '-';
  if (studentBatch?.subjectTeachers) {
    const names = Object.values(studentBatch.subjectTeachers)
      .map(tid => TEACHERS_DB.find(t => t.id === tid)?.name)
      .filter(Boolean);
    teacherNames = [...new Set(names)].join(', ') || '-';
  }
  setText('dash-teacher', teacherNames);
}

/** Renders the "Today" / "Tomorrow" class list widgets on the student dashboard. */
function renderDayClasses(containerId, dayName, label) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const classes = TEACHER_SCHEDULE.filter(r => r.day === dayName).sort((a, b) => String(a.time).localeCompare(String(b.time)));
  if (!classes.length) { el.innerHTML = `<p style="color:var(--text-light);font-size:0.8rem">No classes ${esc(label)}.</p>`; return; }
  el.innerHTML = classes.map(r => `<div class="day-class">
      <div class="class-time">${esc(r.time)}</div>
      <div class="class-info">
        <h4>${esc(r.subject)} <span class="badge ${r.type === 'physical' ? 'badge-green' : 'badge-blue'}">${r.type === 'physical' ? 'Physical' : 'Online'}</span></h4>
        <p>${esc(r.room || (r.type === 'online' ? 'Online' : 'TBA'))} · ${esc(r.duration || 60)} min</p>
      </div></div>`).join('');
}

/** Renders the "My Courses" grid page (one card per enrolled course). */
function renderCoursesList() {
  const student = getActiveStudent();
  const container = document.getElementById('courses-container');
  if (!container || !student) return;
  container.innerHTML = '';

  // .filter(Boolean) matters: enrolledCourseIds can still hold the id of a
  // course an admin has since deleted, and reading .colorLight off undefined
  // would throw and blank the whole page.
  const myCourses = (student.enrolledCourseIds || [])
    .map(id => COURSES[id])
    .filter(Boolean);

  if (!myCourses.length) {
    container.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:2.5rem 1.5rem;background:var(--white);
                  border:1px dashed var(--border);border-radius:var(--radius-xl)">
        <div style="font-size:0.95rem;font-weight:600;color:var(--text-dark);margin-bottom:0.5rem">
          You're not enrolled in any courses yet
        </div>
        <p style="font-size:0.82rem;color:var(--text-mid);max-width:420px;margin:0 auto;line-height:1.6">
          Courses appear here once your academy assigns you to a batch.
          If you think this is a mistake, contact your administrator.
        </p>
      </div>`;
    return;
  }

  myCourses.forEach(c => {
    const id = c.id;
    const pct = courseProgress(id);
    const done = allTopics(id).filter(t => isTopicDone(t.id)).length;
    const total = allTopics(id).length;
    container.innerHTML += `
      <div class="course-card">
        <div class="cc-header">
          <div class="cc-icon-row">
            <div class="cc-icon" style="background:${escAttr(c.colorLight)};color:${escAttr(c.color)};font-family:var(--font-mono);font-weight:700">${esc(c.icon)}</div>
            <span class="badge" style="background:${escAttr(c.colorLight)};color:${escAttr(c.color)}">${esc(c.subject)}</span>
          </div>
          <h3 style="font-size:0.95rem;font-weight:600;color:var(--text-dark);margin-bottom:0.25rem">${esc(c.title)}</h3>
          <p style="font-size:0.8rem;color:var(--text-mid)">${esc(c.description)}</p>
        </div>
        <div class="cc-body">
          <div class="cc-meta"><span>${c.weeks.length} weeks</span><span>${total} topics</span><span>${done} done</span><span>${esc(teacherLabel(c.teacher))}</span></div>
          <div class="progress-track" style="margin-bottom:4px"><div class="progress-fill" style="width:${pct}%;background:${escAttr(c.color)}"></div></div>
          <small style="color:var(--text-light);font-size:0.72rem;font-family:var(--font-mono)">${pct}% complete</small>
        </div>
        <div class="cc-footer">
          ${total
            ? `<a href="course-detail.html?id=${c.id}" class="btn btn-primary btn-full btn-sm">Open Course</a>`
            : `<button class="btn btn-outline btn-full btn-sm" disabled title="Your teacher hasn't published any topics yet">No content yet</button>`}
        </div>
      </div>`;
  });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function openAttendanceModal(courseId) {
  const course = COURSES[courseId];
  if (!course) { showToast('That course no longer exists - reload the page.'); return; }
  let m = document.getElementById('attendance-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'attendance-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:450;backdrop-filter:blur(2px);padding:1rem';
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div style="background:var(--white);border-radius:var(--radius-xl);width:100%;max-width:460px;max-height:88vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:var(--shadow-lg)">
      <div style="padding:1.1rem 1.4rem;border-bottom:1px solid var(--border)">
        <div style="font-size:0.7rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.07em">Take Attendance</div>
        <div style="font-weight:600">${esc(course.title)}</div>
      </div>
      <div style="padding:1rem 1.4rem;overflow-y:auto">
        <div class="form-group">
          <label>Class date</label>
          <input type="date" class="form-control" id="att-date" value="${todayISO()}" max="${todayISO()}" onchange="loadAttendanceRoster(${Number(courseId)})">
        </div>
        <div id="att-roster" style="font-size:0.82rem;color:var(--text-light)">Loading...</div>
      </div>
      <div style="padding:0.9rem 1.4rem;border-top:1px solid var(--border);display:flex;gap:0.65rem;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" onclick="closeAttendanceModal()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="saveAttendance(${Number(courseId)})">Save Attendance</button>
      </div>
    </div>`;
  m.style.display = 'flex';
  loadAttendanceRoster(courseId);
}

function closeAttendanceModal() {
  const m = document.getElementById('attendance-modal');
  if (m) m.style.display = 'none';
}

async function loadAttendanceRoster(courseId) {
  const box = document.getElementById('att-roster');
  if (!box) return;
  const date = fv('att-date');
  if (!date) { box.textContent = 'Pick a date first.'; return; }
  try {
    const [roster, existing] = await Promise.all([
      apiFetch(`/attendance/roster/${courseId}`),
      apiFetch(`/attendance/${courseId}/${encodeURIComponent(date)}`),
    ]);
    if (!roster.students.length) { box.textContent = 'No students are enrolled in this course yet.'; return; }
    const marked = new Map(((existing && existing.entries) || []).map(e => [e.studentId, e.present]));
    box.innerHTML = `
      <div style="margin-bottom:0.6rem;color:var(--text-mid)">${existing
        ? 'Attendance was already taken for this date. Saving will correct it.'
        : 'Everyone starts as present. Untick the students who were absent.'}</div>
      ${roster.students.map(s => `
        <label style="display:flex;align-items:center;gap:0.55rem;padding:0.4rem 0.2rem;border-bottom:1px solid var(--border);cursor:pointer;color:var(--text-dark)">
          <input type="checkbox" class="att-cb" value="${esc(s.id)}" ${marked.has(s.id) ? (marked.get(s.id) ? 'checked' : '') : 'checked'}>
          <span style="flex:1;font-weight:500">${esc(s.name)}</span>
          <span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--text-light)">${esc(s.rollNo)}</span>
        </label>`).join('')}`;
  } catch (err) {
    box.innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`;
  }
}

async function saveAttendance(courseId) {
  const date = fv('att-date');
  if (!date) { showToast('Pick the class date.'); return; }
  const boxes = [...document.querySelectorAll('#att-roster .att-cb')];
  if (!boxes.length) { showToast('There are no students to mark.'); return; }
  try {
    await apiFetchDetailed('/attendance', {
      method: 'POST',
      body: JSON.stringify({ courseId, date, entries: boxes.map(cb => ({ studentId: cb.value, present: cb.checked })) }),
    });
    closeAttendanceModal();
    STUDENTS_DB = await apiFetch('/students');
    showToast('Attendance saved.');
  } catch (err) {
    showToast(err.message);
  }
}


/** Renders the course-detail page: week/topic curriculum tree on the left, selected topic's content tabs on the right. */
function renderCourseDetail() {
  const params = new URLSearchParams(location.search);
  const cid = parseInt(params.get('id'), 10);
  const course = (getActiveStudent().enrolledCourseIds || []).includes(cid) ? COURSES[cid] : null;
  // `return` on its own left the page showing the empty skeleton with no
  // explanation, which is indistinguishable from a page that failed to load.
  // A student hitting a course they aren't enrolled in (or a stale bookmark for
  // a deleted course) needs to be told which of the two it is.
  if (!course) {
    setText('cd-title', 'Course not available');
    setText('cd-desc', "This course either no longer exists or you're not enrolled in it. Go back to My Courses and pick one from there.");
    setText('cd-teacher', '-');
    return;
  }

  setText('cd-title', course.title);
  setText('cd-desc', course.description);
  setText('cd-teacher', teacherLabel(course.teacher));

  const pct = courseProgress(cid);
  const pBar = document.getElementById('cd-prog-bar');
  const pTxt = document.getElementById('cd-prog-txt');
  if (pBar) pBar.style.width = pct + '%';
  if (pTxt) pTxt.textContent = pct + '% complete';

  const container = document.getElementById('curriculum-container');
  let firstTopic = null;

  course.weeks.forEach((week, wi) => {
    const doneW = week.topics.filter(t => isTopicDone(t.id)).length;
    const weekEl = document.createElement('div');
    weekEl.className = 'week-block' + (wi > 0 ? ' collapsed' : ''); // only week 1 starts expanded
    weekEl.innerHTML = `
      <div class="week-header" onclick="toggleWeek(this)">
        <div>
          <span>Week ${week.num}: ${week.title}</span>
          <div style="font-size:0.62rem;color:var(--text-light);font-weight:400;text-transform:none;letter-spacing:0;margin-top:1px">Uploaded ${esc(fmtDate(week.uploadedDate))}</div>
        </div>
        <div class="week-stats">
          <span style="font-size:0.68rem;color:var(--success);font-family:var(--font-mono)">${doneW}/${week.topics.length}</span>
          <span class="week-toggle">▾</span>
        </div>
      </div>
      <div class="week-topics"></div>`;

    const topicsEl = weekEl.querySelector('.week-topics');
    week.topics.forEach(topic => {
      if (!firstTopic) firstTopic = topic;
      const done = isTopicDone(topic.id);
      const pills = topic.contents.map(c => `<span class="tpill ${c.type}">${c.type}</span>`).join('');
      const days  = getDueDays(topic.dueDate);
      const dueHtml = topic.dueDate ? dueBadge(days) : '';

      const topicEl = document.createElement('div');
      topicEl.className = 'topic-item';
      topicEl.dataset.id = topic.id;
      topicEl.innerHTML = `
        <div class="topic-top">
          <div class="topic-check ${done ? 'done' : ''}" data-id="${topic.id}" onclick="toggleDone(event,'${topic.id}','${cid}')">
            ${done ? '&#10003;' : ''}
          </div>
          <div class="topic-title-text" style="${done ? 'text-decoration:line-through;color:var(--text-light)' : ''}">${topic.num} - ${topic.title}</div>
        </div>
        <div class="topic-pills">${pills}</div>
        ${dueHtml}`;
      topicEl.addEventListener('click', e => {
        if (e.target.closest('.topic-check')) return; // don't select the topic when just toggling the checkbox
        document.querySelectorAll('.topic-item').forEach(t => t.classList.remove('active'));
        topicEl.classList.add('active');
        loadContent(topic, course);
        apiFetch(`/students/${getActiveStudent().id}/last-topic`, {
          method: 'PATCH',
          body: JSON.stringify({ courseId: cid, topicId: topic.id }),
        }).catch(err => console.error('Failed to save last topic:', err.message));
      });
      topicsEl.appendChild(topicEl);
    });
    container.appendChild(weekEl);
  });

  // Auto-select the very first topic so the content panel isn't empty on load.
  const savedTopicId = getActiveStudent().lastTopic?.[String(cid)];
  const resumeEl = savedTopicId ? container.querySelector(`.topic-item[data-id="${CSS.escape(savedTopicId)}"]`) : null;
  if (resumeEl) {
    resumeEl.classList.add('active');
    const savedTopic = allTopics(cid).find(t => t.id === savedTopicId);
    loadContent(savedTopic, course);
  } else if (firstTopic) {
    container.querySelector('.topic-item').classList.add('active');
    loadContent(firstTopic, course);
  }

  const msgBtn = document.getElementById('msg-teacher-btn');
  if (msgBtn) msgBtn.onclick = () => openMessageForCourse(course.id);
}

function toggleWeek(h) { h.closest('.week-block').classList.toggle('collapsed'); }

/** Toggles a topic's "done" checkbox and live-updates the progress bar + week counters, without a full re-render. */
function toggleDone(e, topicId, cid) {
  e.stopPropagation();
  const val = !isTopicDone(topicId);
  setTopicDone(topicId, val);

  const el = document.querySelector(`.topic-check[data-id="${topicId}"]`);
  if (el) { el.classList.toggle('done', val); el.innerHTML = val ? '&#10003;' : ''; }

  const titleEl = el?.closest('.topic-item').querySelector('.topic-title-text');
  if (titleEl) titleEl.style.cssText = val ? 'text-decoration:line-through;color:var(--text-light)' : '';

  const pct = courseProgress(parseInt(cid));
  const pBar = document.getElementById('cd-prog-bar');
  const pTxt = document.getElementById('cd-prog-txt');
  if (pBar) pBar.style.width = pct + '%';
  if (pTxt) pTxt.textContent = pct + '% complete';

  document.querySelectorAll('.week-block').forEach(wb => {
    const topics = wb.querySelectorAll('.topic-item');
    const doneC  = [...topics].filter(t => isTopicDone(t.dataset.id)).length;
    const ws = wb.querySelector('.week-stats span:first-child');
    if (ws) ws.textContent = doneC + '/' + topics.length;
  });
}

/** Builds the tabbed content viewer (video/notes/link/quiz/assign tabs) for a selected topic. */
function loadContent(topic, course) {
  setText('content-topic-title', topic.num + ' - ' + topic.title);
  const tabsEl   = document.getElementById('content-tabs');
  const panelsEl = document.getElementById('content-panels');
  tabsEl.innerHTML = ''; panelsEl.innerHTML = '';

  const days  = getDueDays(topic.dueDate);
  const dueEl = document.getElementById('content-due');
  if (dueEl) dueEl.innerHTML = topic.dueDate ? dueBadge(days) : '';

  topic.contents.forEach((c, i) => {
    const tab = document.createElement('div');
    tab.className = 'ctab' + (i === 0 ? ' active' : '');
    tab.textContent = c.label;
    tab.onclick = () => {
      document.querySelectorAll('.ctab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.content-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('panel-' + i).classList.add('active');
    };
    tabsEl.appendChild(tab);

    const panel = document.createElement('div');
    panel.className = 'content-panel' + (i === 0 ? ' active' : '');
    panel.id = 'panel-' + i;
    panel.innerHTML = buildPanel(c, topic, course);
    panelsEl.appendChild(panel);
  });
}
function toEmbeddableVideoUrl(raw) {
  if (!raw) return null;
  const url = String(raw).trim();

  const youtube = url.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/shorts\/|youtu\.be\/)([\w-]{11})/);
  if (youtube) return { kind: 'iframe', src: `https://www.youtube.com/embed/${youtube[1]}` };

  if (/^https?:\/\/player\.vimeo\.com\/video\//.test(url)) return { kind: 'iframe', src: url };

  // Google Drive: 'https://drive.google.com/file/d/<ID>/view?...' -> '.../preview'
  const drive = url.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (drive) return { kind: 'iframe', src: `https://drive.google.com/file/d/${drive[1]}/preview` };

  if (/^\/uploads\/videos\//.test(url)) return { kind: 'file', src: url };

  return null;
}

/**
 * Renders the inner HTML for one content-tab panel, based on its type:
 * video / notes / link / assign (submission form or submitted-state view) / quiz.
 */
function buildPanel(c, topic, course) {
  const student = getActiveStudent();

  if (c.type === 'video') {
    const embed = toEmbeddableVideoUrl(c.url);
    const dur = (c.duration && c.duration !== '-')
      ? `<div style="font-size:0.68rem;margin-top:4px;color:var(--text-light);font-family:var(--font-mono)">${esc(c.duration)}</div>` : '';
    if (embed && embed.kind === 'iframe') {
      return `<div style="margin-bottom:0.75rem">
        <div style="position:relative;padding-top:56.25%;background:#000;border-radius:var(--radius)">
          <iframe src="${esc(embed.src)}" title="${esc(topic.title)}"
            style="position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:var(--radius)"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen></iframe>
        </div>${dur}</div>`;
    }
    if (embed && embed.kind === 'file') {
      return `<div style="margin-bottom:0.75rem"><video controls style="width:100%;border-radius:var(--radius);background:#000" src="${esc(embed.src)}"></video>${dur}</div>`;
    }
    return `<div class="video-player" style="margin-bottom:0.75rem">
      <div class="vp-play">&#9654;</div>
      <div class="vp-text">${esc(topic.title)}</div>
      <p style="font-size:0.72rem;color:var(--text-light);margin-top:6px">No video has been added for this lecture yet.</p>
    </div>`;
  }

  if (c.type === 'notes' || c.type === 'link') {
    const isNotes = c.type === 'notes';
    const href = safeHref(c.url);
    return `
    <div style="display:flex;align-items:center;gap:1rem;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem">
      <div style="flex:1">
        <div style="font-size:0.82rem;font-weight:600;margin-bottom:3px">${isNotes ? esc(topic.title) + ' - Notes' : esc(c.label || 'Reference link')}</div>
        <p style="font-size:0.78rem;color:var(--text-mid);margin-bottom:0.75rem">${isNotes ? 'Open the notes for this topic.' : 'External reference resource.'}</p>
        ${href
          ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline btn-sm">${isNotes ? 'Open Notes' : 'Open Resource'}</a>`
          : '<button class="btn btn-outline btn-sm" disabled>Not added yet</button>'}
      </div>
    </div>`;
  }

  if (c.type === 'assign') {
    const rec = (student.assignments || []).find(a => a.topicId === topic.id);

    if (rec && rec.submitted) {
      const approved = !!rec.approved;
      const hasMarks = rec.marks !== null && rec.marks !== undefined && rec.totalMarks;
      const pct = approved && hasMarks ? Math.round(rec.marks / rec.totalMarks * 100) : null;
      return `
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:var(--radius);padding:0.85rem 1rem;margin-bottom:0.85rem">
          <div style="font-weight:600;font-size:0.82rem;color:#166534;margin-bottom:2px">Submitted on ${esc(fmtDate(rec.submittedOn))}</div>
          <div style="font-size:0.75rem;color:#15803D">
            ${approved
              ? `Grade: <strong style="font-family:var(--font-mono)">${esc(rec.grade || '-')}</strong> - ${esc(rec.marks)}/${esc(rec.totalMarks)} marks`
              : 'Submitted - awaiting teacher review'}
          </div>
          ${approved && rec.feedback
            ? `<div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #BBF7D0;font-size:0.78rem;color:#166534"><strong>Feedback:</strong> ${esc(rec.feedback)}</div>` : ''}
        </div>
        ${pct !== null ? `
          <div class="progress-track" style="margin-bottom:6px">
            <div class="progress-fill ${pct >= 70 ? 'green' : pct >= 50 ? 'orange' : 'red'}" style="width:${pct}%"></div>
          </div>
          <div style="font-size:0.72rem;color:var(--text-light);font-family:var(--font-mono)">${pct}% - ${esc(rec.grade || 'Pending')}</div>` : ''}`;
    }

    const topicSafe = topic.id.replace(/[^a-z0-9]/gi, '_');
    return `
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:0.85rem 1rem;margin-bottom:0.85rem;font-size:0.82rem;color:var(--text-mid);line-height:1.6">
        ${esc(c.detail || 'Complete and submit this assignment.')}
        ${c.totalMarks ? `<div style="margin-top:4px;font-size:0.72rem;color:var(--text-light);font-family:var(--font-mono)">Total marks: ${esc(c.totalMarks)}</div>` : ''}
      </div>
      <div style="margin-bottom:0.85rem">
        <label style="display:block;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-mid);margin-bottom:0.35rem">Your Answer / Comments</label>
        <textarea id="assign-text-${topicSafe}" class="form-control" placeholder="Type your answer, notes, or any comments for the teacher..." style="min-height:100px;font-size:0.82rem;resize:vertical"></textarea>
      </div>
      <div style="margin-bottom:0.85rem">
        <label style="display:block;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-mid);margin-bottom:0.35rem">Attach File (PDF, Word, Image)</label>
        <div id="upload-zone-${topicSafe}"
          style="border:2px dashed var(--border);border-radius:var(--radius);padding:1.25rem;text-align:center;cursor:pointer;background:var(--bg);transition:border-color 0.15s"
          onclick="document.getElementById('file-inp-${topicSafe}').click()"
          ondragover="event.preventDefault();this.style.borderColor='var(--blue)'"
          ondragleave="this.style.borderColor='var(--border)'"
          ondrop="handleFileDrop(event,'${topicSafe}')">
          <div style="font-size:1.2rem;margin-bottom:4px;color:var(--text-light)">&#8593;</div>
          <div style="font-size:0.82rem;font-weight:500;color:var(--text-dark)">Click to browse or drag a file here</div>
          <div style="font-size:0.72rem;color:var(--text-light);margin-top:3px">PDF, DOC, DOCX, JPG, PNG - max 10MB</div>
          <div id="file-name-${topicSafe}" style="margin-top:6px;font-size:0.75rem;font-family:var(--font-mono);color:var(--blue);display:none"></div>
        </div>
        <input type="file" id="file-inp-${topicSafe}" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style="display:none" onchange="showFileName('${topicSafe}',this)">
      </div>
      <div style="display:flex;gap:0.65rem;align-items:center">
        <button class="btn btn-primary btn-sm" onclick="submitAssignment('${escAttr(topic.id)}','${topicSafe}')">Submit Assignment</button>
        <span id="assign-status-${topicSafe}" style="font-size:0.78rem;color:var(--text-light)"></span>
      </div>`;
  }

  if (c.type === 'quiz') {
    const questions = Array.isArray(c.questions) ? c.questions : [];
    if (!questions.length) {
      return '<p style="color:var(--text-light);font-size:0.82rem">No questions have been added to this quiz yet.</p>';
    }
    const prev = (student.quizScores || []).find(q => q.topicId === topic.id);
    const prevPct = prev && prev.total ? Math.round(prev.score / prev.total * 100) : null;
    const lowScore = prevPct !== null && prevPct < 70;
    const used = prev ? (prev.attemptNum || 1) : 0;
    const maxAttempts = 2;   // must match MAX_QUIZ_ATTEMPTS on the server
    if (used >= maxAttempts) {
      return `<div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:0.85rem 1rem;font-size:0.82rem;color:var(--text-mid)">
        You have used all ${maxAttempts} attempts for this quiz. Your best score is <strong style="font-family:var(--font-mono)">${esc(prev.score)}/${esc(prev.total)}</strong>.</div>`;
    }
    const courseId = course ? Number(course.id) : null;

    const qs = questions.map((q, qi) => `
      <div class="quiz-q">
        <p>Q${qi + 1}. ${esc(q.q)}</p>
        ${(q.options || []).map((opt, oi) => `
          <div class="quiz-opt" data-qi="${qi}" data-oi="${oi}" onclick="pickOpt(this)">
            <span class="quiz-opt-label">${String.fromCharCode(65 + oi)}</span> ${esc(opt)}
          </div>`).join('')}
      </div>`).join('');

    return `
      ${lowScore && courseId ? `
      <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:var(--radius);padding:0.65rem 0.85rem;margin-bottom:0.85rem;font-size:0.78rem;display:flex;align-items:center;justify-content:space-between;gap:0.75rem">
        <span style="color:#92400E">Your previous score was ${prevPct}%. You can practise with AI-generated questions.</span>
        <button class="btn btn-sm" style="background:#D97706;color:#fff;border:none;white-space:nowrap;flex-shrink:0" onclick="openAIStudyPanel(${courseId})">Study &amp; Practise</button>
      </div>` : ''}
      <div style="font-size:0.72rem;color:var(--text-light);margin-bottom:0.5rem">Attempt ${used + 1} of ${maxAttempts}</div>
      <div id="qz${Math.random().toString(36).slice(2, 7)}">${qs}
        <button class="btn btn-primary btn-sm" onclick="submitQuiz(this, '${escAttr(topic.id)}')" style="margin-top:0.5rem">Submit Quiz</button>
        <div class="quiz-result"></div>
      </div>`;
  }

  return '<p style="color:var(--text-light);font-size:0.82rem">Content coming soon.</p>';
}

async function downloadAssignmentFile(filename, saveAs) {
  try {
    const res = await fetch(`${API_BASE}/files/${encodeURIComponent(filename)}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      throw new Error(b.message || `Download failed (${res.status})`);
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = saveAs || filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  } catch (err) {
    showToast(err.message);
  }
}

function unreadCount() { return NOTIFICATIONS.filter(n => !n.read).length; }

function getTeacherCourseIds() {
  const teacher = getActiveTeacher();
  if (!teacher) return [];
  const assignedCourseIds = new Set();
  BATCHES.forEach(b => {
    if (!b.subjectTeachers) return;
    Object.entries(b.subjectTeachers).forEach(([subject, tid]) => {
      if (tid !== teacher.id) return;
      // Must be a course belonging to THIS batch specifically, not any
      // course anywhere sharing the subject name.
      Object.values(COURSES).forEach(c => {
        if (c.subject === subject && c.batchId === b.id) assignedCourseIds.add(c.id);
      });
    });
  });
  (teacher.courseIds || []).forEach(id => assignedCourseIds.add(id));
  return [...assignedCourseIds];
}

function studentProgressScore(student, courseId) {
  const course = COURSES[courseId];
  if (!course) return 0;
  const courseTopicIds = new Set(allTopics(courseId).map(t => t.id));

  const quizzes   = student.quizScores.filter(q => courseTopicIds.has(q.topicId));
  const quizTotal = quizzes.reduce((a, b) => a + b.total, 0);
  const quizGot   = quizzes.reduce((a, b) => a + b.score, 0);
  const quizPct   = quizTotal ? Math.round(quizGot / quizTotal * 100) : 0;

  const assigns     = student.assignments.filter(a => a.courseId === courseId && a.approved && a.marks !== null && a.marks !== undefined);
  const assignTotal = assigns.reduce((a, b) => a + b.totalMarks, 0);
  const assignGot   = assigns.reduce((a, b) => a + b.marks, 0);
  const assignPct   = assignTotal ? Math.round(assignGot / assignTotal * 100) : 0;

  if (!quizTotal && !assignTotal) return 0;
  if (!quizTotal) return assignPct;
  if (!assignTotal) return quizPct;
  return Math.round((quizPct + assignPct) / 2);
}

function pickOpt(el) {
  el.closest('.quiz-q').querySelectorAll('.quiz-opt').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
}

/** Grades an in-page topic quiz (not AI-generated) by comparing selected options to each question's `data-ans`. */
async function submitQuiz(btn, topicId) {
  const wrap = btn.closest('div[id]');
  const qEls = [...wrap.querySelectorAll('.quiz-q')];
  const answers = qEls.map(qEl => {
    const sel = qEl.querySelector('.quiz-opt.selected');
    return sel ? parseInt(sel.dataset.oi, 10) : null;
  });
  const blank = answers.filter(a => a === null).length;
  if (blank && !confirm(`${blank} question(s) are unanswered and will count as wrong. Submit anyway?`)) return;

  btn.disabled = true;
  try {
    const student = getActiveStudent();
    const r = await apiFetch(`/students/${encodeURIComponent(student.id)}/quiz-scores`, {
      method: 'POST',
      body: JSON.stringify({ topicId, answers }),
    });

    qEls.forEach((qEl, qi) => {
      qEl.querySelectorAll('.quiz-opt').forEach(o => {
        const oi = parseInt(o.dataset.oi, 10);
        o.style.pointerEvents = 'none';
        if (oi === r.correctAnswers[qi]) o.classList.add('correct');
        else if (oi === answers[qi]) o.classList.add('wrong');
      });
    });

    const score = r.attemptScore; const total = r.entry.total
    const pct = Math.round(score / total * 100);
    const ok = pct >= 70;
    btn.style.display = 'none';
    const res = wrap.querySelector('.quiz-result');
    res.style.cssText = `display:block;padding:.7rem .9rem;border-radius:var(--radius);font-weight:500;font-size:.82rem;background:${ok ? 'var(--success-light)' : 'var(--danger-light)'};color:${ok ? 'var(--success)' : 'var(--danger)'};border:1px solid ${ok ? '#bbf7d0' : '#fecaca'}`;
    res.innerHTML = `You scored <strong style="font-family:var(--font-mono)">${score}/${total}</strong> (${pct}%) - ${ok ? 'Well done.' : 'Review and try again.'} ${r.attemptsLeft > 0 ? `You have ${r.attemptsLeft} attempt left.` : 'No attempts left.'}`;

    const existing = student.quizScores.find(q => q.topicId === topicId);
    if (existing) Object.assign(existing, r.entry); else student.quizScores.push(r.entry);
  } catch (err) {
    btn.disabled = false;
    showToast(err.message);
  }
}

/** Renders the student's weekly class schedule page, grouped by day. */
function renderSchedule() {
  const container = document.getElementById('schedule-container');
  if (!container) return;
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  container.innerHTML = days.map(day => {
    const classes = TEACHER_SCHEDULE.filter(r => r.day === day).sort((a, b) => String(a.time).localeCompare(String(b.time)));
    if (!classes.length) return '';
    const rows = classes.map(r => `<div class="day-class"><div class="class-time">${esc(r.time)}</div><div class="class-info">
        <h4>${esc(r.subject)} <span class="badge ${r.type === 'physical' ? 'badge-green' : 'badge-blue'}">${r.type === 'physical' ? 'Physical' : 'Online'}</span></h4>
        <p>${esc(r.room || 'TBA')}</p></div></div>`).join('');
    return `<div class="day-card"><div class="day-card-head ${day === today ? 'today' : ''}">${day}${day === today ? ' - Today' : ''}</div>${rows}</div>`;
  }).join('');
}

/** Every assignment in the student's courses, with their submission (if any). */
function allAssignmentsForStudent(student) {
  const rows = [];
  (student.enrolledCourseIds || []).forEach(cid => {
    const c = COURSES[cid];
    if (!c) return;
    c.weeks.forEach(w => w.topics.forEach(t => {
      if (!(t.contents || []).some(x => x.type === 'assign')) return;
      rows.push({
        title: t.title, course: c.title, dueDate: t.dueDate || '',
        rec: (student.assignments || []).find(a => a.topicId === t.id) || null,
      });
    }));
  });
  return rows;
}

function renderAttendance() {
  const student = getActiveStudent();
  const tbody   = document.getElementById('attendance-tbody');
  const overall = document.getElementById('att-overall');

  if (tbody) {
    const detail = student.attendanceDetail || [];
    tbody.innerHTML = detail.length ? detail.map(row => {
      const pct = row.total ? Math.round(row.attended / row.total * 100) : 0;
      const color  = pct >= 85 ? 'var(--success)' : pct >= 75 ? 'var(--warning)' : 'var(--danger)';
      const status = pct >= 85 ? 'Good' : pct >= 75 ? 'Low' : 'Critical';
      return `<tr>
        <td><strong>${esc(row.subject)}</strong></td>
        <td style="color:var(--success);font-weight:600;font-family:var(--font-mono)">${esc(row.attended)}</td>
        <td style="color:var(--danger);font-weight:600;font-family:var(--font-mono)">${esc(row.missed)}</td>
        <td style="font-family:var(--font-mono)">${esc(row.total)}</td>
        <td><div style="display:flex;align-items:center;gap:8px">
          <div class="progress-track" style="width:70px"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
          <strong style="color:${color};font-family:var(--font-mono)">${pct}%</strong>
        </div></td>
        <td><span class="badge ${pct >= 85 ? 'badge-green' : pct >= 75 ? 'badge-orange' : 'badge-red'}">${status}</span></td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-light);padding:1.5rem;font-size:0.82rem">No classes have been marked yet.</td></tr>';
  }

  if (overall) {
    overall.textContent = (student.attendance || 0) + '%';
    overall.style.color = student.attendance >= 85 ? 'var(--success)' : 'var(--warning)';
  }

  const atbody = document.getElementById('assignment-tbody');
  if (atbody) {
    const rows = allAssignmentsForStudent(student);
    atbody.innerHTML = rows.length ? rows.map(a => {
      const rec = a.rec;
      const days = getDueDays(a.dueDate);
      const statusHtml = rec && rec.submitted ? '<span class="badge badge-green">Submitted</span>'
        : days !== null && days < 0 ? '<span class="badge badge-red">Overdue</span>'
        : days !== null && days <= 3 ? '<span class="badge badge-orange">Due Soon</span>'
        : '<span class="badge badge-blue">Pending</span>';
      // A grade is shown only after the teacher has approved it.
      const gradeHtml = rec && rec.approved && rec.grade ? `<strong>${esc(rec.grade)}</strong>`
        : rec && rec.submitted ? '<span style="color:var(--text-light)">Awaiting</span>' : '-';
      return `<tr>
        <td><strong>${esc(a.title)}</strong></td><td>${esc(a.course)}</td>
        <td style="font-family:var(--font-mono);font-size:0.8rem">${esc(fmtDate(a.dueDate))}</td>
        <td style="font-family:var(--font-mono);font-size:0.8rem">${rec && rec.submittedOn ? esc(fmtDate(rec.submittedOn)) : '-'}</td>
        <td>${statusHtml}</td><td>${gradeHtml}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="6" style="text-align:center;color:var(--text-light);padding:1.5rem;font-size:0.82rem">No assignments yet.</td></tr>';
  }
}

/** Renders the student's fee installment table and the payment summary at the top. */
function renderFees() {
  const student = getActiveStudent();
  const tbody = document.getElementById('fees-tbody');
  const today = new Date().toLocaleDateString('en-CA');   // local date as YYYY-MM-DD

  if (tbody) {
    const fees = student.fees || [];
    tbody.innerHTML = fees.length ? fees.map(r => {
      const isPaid    = r.status === 'Paid';
      const isOverdue = !isPaid && r.dueDate && r.dueDate < today;
      const label = isPaid ? 'Paid' : isOverdue ? 'Overdue' : 'Pending';
      const cls   = isPaid ? 'badge-green' : isOverdue ? 'badge-red' : 'badge-orange';
      return `<tr>
        <td>${esc(r.label)}</td>
        <td style="font-family:var(--font-mono);font-weight:600">Rs. ${Number(r.amount || 0).toLocaleString()}</td>
        <td style="font-family:var(--font-mono);font-size:0.8rem">${esc(fmtDate(r.dueDate))}</td>
        <td><span class="badge ${cls}">${label}</span></td>
      </tr>`;
    }).join('') : '<tr><td colspan="4" style="text-align:center;color:var(--text-light);padding:1.5rem;font-size:0.82rem">No instalments have been set up yet. Please contact the office.</td></tr>';
  }

  const total = Number(student.totalFee) || 0;
  const paid  = Number(student.paidAmount) || 0;
  setText('fee-total', 'Rs. ' + total.toLocaleString());
  setText('fee-paid',  'Rs. ' + paid.toLocaleString());
  setText('fee-rem',   'Rs. ' + Math.max(0, total - paid).toLocaleString());
  setText('fee-due',   student.nextDue ? fmtDate(student.nextDue) : '-');
  const pct = total ? Math.min(100, Math.round(paid / total * 100)) : 0;
  const fb = document.getElementById('fee-prog-bar');
  if (fb) fb.style.width = pct + '%';
  setText('fee-prog-pct', pct + '% paid');
}

/** Renders the per-subject performance breakdown page: score/grade cards, quiz/assignment/attendance bars, quiz history, and the AI study-assistant prompt for weak subjects. */
function renderPerformance() {
  const student = getActiveStudent();
  const container = document.getElementById('performance-container');
  if (!container) return;
  container.innerHTML = '';

  student.enrolledCourseIds.forEach(courseId => {
    const course = COURSES[courseId];
    if (!course) return;

    const progress = studentProgressScore(student, courseId);
    const grade    = calcGradeFromThreshold(progress);
    const oColor   = progress >= 75 ? 'var(--success)' : progress >= 60 ? 'var(--warning)' : 'var(--danger)';

    const courseTopicIds = new Set(allTopics(courseId).map(t => t.id));
    const quizzes   = student.quizScores.filter(q => courseTopicIds.has(q.topicId));
    const quizTotal = quizzes.reduce((a, b) => a + b.total, 0);
    const quizGot   = quizzes.reduce((a, b) => a + b.score, 0);
    const quizPct   = quizTotal ? Math.round(quizGot / quizTotal * 100) : 0;

    const assigns     = student.assignments.filter(a => a.courseId === courseId && a.marks !== null);
    const assignTotal = assigns.reduce((a, b) => a + b.totalMarks, 0);
    const assignGot   = assigns.reduce((a, b) => a + b.marks, 0);
    const assignPct   = assignTotal ? Math.round(assignGot / assignTotal * 100) : 0;

    const attRow = student.attendanceDetail.find(a => a.subject === course.subject);
    const attPct = attRow ? Math.round(attRow.attended / attRow.total * 100) : 0;

    const hasActivity = quizzes.length > 0 || assigns.length > 0;
    const needsReview = hasActivity && progress < 60;

    container.innerHTML += `
      <div class="perf-subject-card">
        <div class="perf-header">
          <div class="perf-icon"
            style="background:${course.colorLight};color:${course.color};
                   font-family:var(--font-mono);font-weight:700">${course.icon}</div>
          <div style="flex:1">
            <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:.08em;
                        color:var(--text-light);font-weight:600">${esc(course.subject)}</div>
            <div class="perf-score" style="color:${oColor}">${progress}<span>%</span></div>
            <div class="perf-label">Overall Score</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:1.5rem;font-weight:700;color:${oColor};
                        font-family:var(--font-mono)">${grade}</div>
            <div style="font-size:0.65rem;color:var(--text-light)">Grade</div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:9px">
          <div>
            <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:3px">
              <span>Quiz Average</span>
              <strong style="font-family:var(--font-mono)">${quizPct}%</strong>
            </div>
            <div class="progress-track">
              <div class="progress-fill ${quizPct >= 70 ? 'green' : quizPct >= 50 ? 'orange' : 'red'}"
                style="width:${quizPct}%"></div>
            </div>
          </div>
          ${assignTotal ? `<div>
            <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:3px">
              <span>Assignments</span>
              <strong style="font-family:var(--font-mono)">${assignPct}%</strong>
            </div>
            <div class="progress-track">
              <div class="progress-fill ${assignPct >= 70 ? 'green' : assignPct >= 50 ? 'orange' : 'red'}"
                style="width:${assignPct}%"></div>
            </div>
          </div>` : ''}
          ${attPct ? `<div>
            <div style="display:flex;justify-content:space-between;font-size:0.78rem;margin-bottom:3px">
              <span>Attendance</span>
              <strong style="font-family:var(--font-mono)">${attPct}%</strong>
            </div>
            <div class="progress-track">
              <div class="progress-fill ${attPct >= 85 ? 'green' : attPct >= 75 ? 'orange' : 'red'}"
                style="width:${attPct}%"></div>
            </div>
          </div>` : ''}
        </div>

        ${quizzes.length ? `
        <div style="margin-top:0.9rem;border-top:1px solid var(--border);padding-top:0.75rem">
          <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:.07em;
                      color:var(--text-light);margin-bottom:0.4rem">Quiz History</div>
          ${quizzes.map(q => `
            <div style="display:flex;justify-content:space-between;font-size:0.78rem;
                        padding:2px 0;font-family:var(--font-mono)">
              <span style="font-family:var(--font-body);color:var(--text-mid)">${esc(q.topic)}</span>
              <strong style="color:${q.score / q.total >= 0.7 ? 'var(--success)' : 'var(--danger)'}">
                ${q.score}/${q.total}
              </strong>
            </div>`).join('')}
        </div>` : ''}

        ${needsReview ? `
        <div style="margin-top:1rem;padding:0.85rem;background:#FEF3C7;
                    border:1px solid #FDE68A;border-radius:var(--radius)">
          <div style="font-size:0.78rem;font-weight:600;color:#92400E;margin-bottom:6px">
            Your score is below 60% in this subject.
          </div>
          <div style="font-size:0.75rem;color:#78350F;margin-bottom:0.65rem;line-height:1.5">
            You can use the study assistant to review the material, then re-attempt the quizzes.
            Each attempt generates a fresh set of questions.
          </div>
          <button class="btn btn-sm"
            style="background:#D97706;color:#fff;border:none;margin-right:6px"
            onclick="openAIStudyPanel(${courseId})">
            Study with AI Assistant
          </button>
          <button class="btn btn-outline btn-sm"
            onclick="openRetryQuiz(${courseId})">
            Re-attempt Quizzes
          </button>
        </div>` : ''}

        ${!hasActivity ? `
        <div style="margin-top:1rem;padding:0.85rem;background:var(--bg);
                    border:1px solid var(--border);border-radius:var(--radius)">
          <div style="font-size:0.78rem;color:var(--text-mid)">
            You haven't started this course yet. Performance stats and the AI
            study assistant will appear here once you complete a quiz or
            assignment.
          </div>
        </div>` : ''}
      </div>`;
  });

  // Top summary strip (overall score / quiz average / attendance / assignments submitted)
  const summaryEl = document.getElementById('perf-summary');
  if (summaryEl) {
    const official  = student.quizScores.filter(q => !q.isAIRetry);   // practice quizzes don't count
    const totalQ    = official.reduce((a, b) => a + b.total, 0);
    const gotQ      = official.reduce((a, b) => a + b.score, 0);
    const avgQuiz   = totalQ ? Math.round(gotQ / totalQ * 100) : 0;
    const allAssign = allAssignmentsForStudent(student);
    const submitted = allAssign.filter(a => a.rec && a.rec.submitted).length;
    const stat = (val, label) => `
        <div style="text-align:center">
          <div style="font-size:1.8rem;font-weight:700;color:var(--text-dark);font-family:var(--font-mono)">${val}</div>
          <div style="font-size:0.72rem;color:var(--text-light)">${label}</div>
        </div>`;
    summaryEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1rem">
        ${stat(overallProgress() + '%', 'Overall Score')}
        ${stat(avgQuiz + '%', 'Quiz Average')}
        ${stat((student.attendance || 0) + '%', 'Attendance')}
        ${stat(submitted + '/' + allAssign.length, 'Assignments')}
      </div>`;
  }
}





// ══════════════════════════════════════════════════
//   19. TEACHER PAGES
// ══════════════════════════════════════════════════

/** Renders the teacher home dashboard: stat cards, course list, pending-grading queue, today's classes, and recent activity table. */
function renderTeacherDashboard() {
  const courseIds = getTeacherCourseIds();
  const myCourses = courseIds.map(id => COURSES[id]).filter(Boolean);
  const me = getActiveTeacher();
  setText('t-welcome', me ? 'Welcome, ' + firstName(me.name) : 'Welcome');
  setText('t-subject-label', myCourses.length
    ? `${((me && me.subjects) || []).join(', ')} - ${myCourses.length} course${myCourses.length === 1 ? '' : 's'} assigned`
    : 'No courses have been assigned to you yet.');

  const pendingGrades = STUDENTS_DB.flatMap(s =>
    s.assignments.filter(a => courseIds.includes(a.courseId) && a.submitted && !a.approved)
  ).length;

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const todayClasses = TEACHER_SCHEDULE.filter(r => r.day === today).length;

  const statsEl = document.getElementById('t-stats');
  if (statsEl) statsEl.innerHTML = `
    <div class="stat-card">
      <div class="stat-icon si-blue" style="font-family:var(--font-mono);font-weight:700">C</div>
      <div class="stat-info"><div class="sv">${myCourses.length}</div><div class="sl">My Courses</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon si-navy" style="font-family:var(--font-mono);font-weight:700">S</div>
      <div class="stat-info">
        <div class="sv">${STUDENTS_DB.filter(s => s.enrolledCourseIds.some(id => courseIds.includes(id))).length}</div>
        <div class="sl">My Students</div>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-icon si-orange" style="font-family:var(--font-mono);font-weight:700">G</div>
      <div class="stat-info"><div class="sv">${pendingGrades}</div><div class="sl">Pending Approval</div></div>
    </div>
    <div class="stat-card">
      <div class="stat-icon si-green" style="font-family:var(--font-mono);font-weight:700">T</div>
      <div class="stat-info"><div class="sv">${todayClasses}</div><div class="sl">Classes Today</div></div>
    </div>`;

  // Course list
  const cList = document.getElementById('t-courses-list');
  if (cList) {
    cList.innerHTML = '';
    myCourses.forEach(c => {
      const enrolled = STUDENTS_DB.filter(s => s.enrolledCourseIds.includes(c.id)).length;
      cList.innerHTML += `
        <div class="course-row">
          <div class="cr-icon" style="background:${c.colorLight};color:${c.color};
               font-family:var(--font-mono);font-weight:700">${c.icon}</div>
          <div class="cr-info">
            <h4>${esc(c.title)}</h4>
            <small>${c.weeks.length} weeks · ${allTopics(c.id).length} topics · ${enrolled} students</small>
          </div>
          <a href="courses.html" class="btn btn-ghost btn-sm">Open</a>
        </div>`;
    });
    if (!myCourses.length) cList.innerHTML = '<p style="color:var(--text-light);font-size:0.82rem">No courses assigned yet.</p>';
  }

  // Pending-grading widget (top 4)
  const pgEl = document.getElementById('t-pending-grading');
  if (pgEl) {
    const pending = STUDENTS_DB.flatMap(s =>
      s.assignments
        .filter(a => courseIds.includes(a.courseId) && a.submitted && !a.approved)
        .map(a => ({ ...a, studentName: s.name, studentId: s.id }))
    );
    if (!pending.length) {
      pgEl.innerHTML = '<p style="color:var(--text-light);font-size:0.82rem">No pending approvals.</p>';
    } else {
      pending.slice(0, 4).forEach(a => {
        pgEl.innerHTML += `
          <div style="display:flex;align-items:center;gap:0.75rem;
                      padding:0.6rem 0;border-bottom:1px solid var(--border)">
            <div style="flex:1">
              <div style="font-size:0.82rem;font-weight:500">${esc(a.title)}</div>
              <div style="font-size:0.72rem;color:var(--text-light)">${esc(a.studentName)} · ${esc(a.course)}</div>
            </div>
            <a href="grading.html" class="btn btn-outline btn-sm">Review</a>
          </div>`;
      });
    }
  }

  // Today's classes widget
  const tcEl = document.getElementById('t-today-classes');
  if (tcEl) {
    const classes = TEACHER_SCHEDULE.filter(r => r.day === today);
    if (!classes.length) {
      tcEl.innerHTML = '<p style="color:var(--text-light);font-size:0.82rem">No classes today.</p>';
    } else {
      classes.forEach(r => {
        const badge = r.type === 'online'
          ? `<span class="badge badge-blue">Online</span>`
          : `<span class="badge badge-green">Physical</span>`;
        tcEl.innerHTML += `
          <div class="day-class" style="padding:0.6rem 0">
            <div class="class-time">${r.time}</div>
            <div class="class-info">
              <h4>${esc(r.subject)} ${badge}</h4>
              <p>${esc(r.room)} · ${esc(r.duration)} min</p>
            </div>
          </div>`;
      });
    }
  }

  // Recent activity table - last submissions + quiz completions across the teacher's courses
  const tbody = document.getElementById('t-activity-tbody');
  if (tbody) {
    const activities = [];
    STUDENTS_DB.forEach(s => {
      s.assignments
        .filter(a => courseIds.includes(a.courseId) && a.submitted)
        .forEach(a => activities.push({
          student: s.name,
          action: 'Submitted assignment',
          course: a.course,
          time: a.submittedOn || '-',
          status: a.approved ? 'badge-green' : 'badge-orange',
          statusText: a.approved ? 'Graded' : 'Needs Approval',
        }));
      s.quizScores
        .filter(q => {
          const course = Object.values(COURSES).find(c => allTopics(c.id).some(t => t.id === q.topicId));
          return course && courseIds.includes(course.id);
        })
        .forEach(q => activities.push({
          student: s.name,
          action: 'Completed quiz',
          course: q.subject,
          time: q.date || '-',
          status: 'badge-green',
          statusText: 'Auto-graded',
        }));
    });

    if (!activities.length) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-light);padding:1.5rem;font-size:0.82rem">No activity yet.</td></tr>';
    } else {
      tbody.innerHTML = activities.slice(0, 6).map(a => `
        <tr>
          <td><strong>${a.student}</strong></td>
          <td style="color:var(--text-mid)">${a.action}</td>
          <td>${esc(a.course)}</td>
          <td style="font-family:var(--font-mono);font-size:0.76rem;color:var(--text-light)">${a.time}</td>
          <td><span class="badge ${a.status}">${a.statusText}</span></td>
        </tr>`).join('');
    }
  }
}

/** Renders the teacher's "My Courses" grid, one card per course with quick stats and edit/students/grading shortcuts. */
function renderTeacherCourses() {
  const grid = document.getElementById('teacher-courses-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const courseIds = getTeacherCourseIds();
  const myCourses = courseIds.map(id => COURSES[id]).filter(Boolean);

  if (!myCourses.length) {
    grid.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-light)">No courses assigned yet.</div>';
    return;
  }

  // Built as an array and assigned once. This used to be `grid.innerHTML += ...`
  // inside the loop, which re-parses and rebuilds the entire grid on every
  // iteration - and silently discards any event listener attached to a card
  // rendered on an earlier pass.
  const cards = myCourses.map(c => {
    const enrolled    = STUDENTS_DB.filter(s => s.enrolledCourseIds.includes(c.id)).length;
    const topicCount  = allTopics(c.id).length;
    const pendingG    = STUDENTS_DB.flatMap(s =>
      s.assignments.filter(a => a.courseId === c.id && a.submitted && !a.approved)
    ).length;

    return `
      <div class="card" style="display:flex;flex-direction:column;gap:0">
        <div style="display:flex;align-items:center;gap:0.85rem;margin-bottom:1rem">
          <div style="width:40px;height:40px;border-radius:var(--radius);
                      background:${escAttr(c.colorLight)};color:${escAttr(c.color)};
                      display:flex;align-items:center;justify-content:center;
                      font-family:var(--font-mono);font-weight:700;flex-shrink:0">${esc(c.icon)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:0.95rem;font-weight:600;color:var(--text-dark)">${esc(c.title)}</div>
            <div style="font-size:0.72rem;color:var(--text-light)">${esc(c.subject)} · ${esc((BATCHES.find(b => b.id === c.batchId) || {}).name || 'Unknown batch')} · ${esc(teacherLabel(c.teacher))}</div>
          </div>
          <span class="badge badge-blue">${enrolled} students</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.5rem;margin-bottom:1rem">
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);
                      padding:0.6rem;text-align:center">
            <div style="font-size:1.1rem;font-weight:700;font-family:var(--font-mono)">${c.weeks.length}</div>
            <div style="font-size:0.65rem;color:var(--text-light);text-transform:uppercase">Weeks</div>
          </div>
          <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);
                      padding:0.6rem;text-align:center">
            <div style="font-size:1.1rem;font-weight:700;font-family:var(--font-mono)">${topicCount}</div>
            <div style="font-size:0.65rem;color:var(--text-light);text-transform:uppercase">Topics</div>
          </div>
          <div style="background:${pendingG > 0 ? 'var(--warning-light)' : 'var(--bg)'};
                      border:1px solid ${pendingG > 0 ? '#fde68a' : 'var(--border)'};
                      border-radius:var(--radius);padding:0.6rem;text-align:center">
            <div style="font-size:1.1rem;font-weight:700;font-family:var(--font-mono);
                        color:${pendingG > 0 ? 'var(--warning)' : 'var(--text-dark)'}">${pendingG}</div>
            <div style="font-size:0.65rem;color:var(--text-light);text-transform:uppercase">Pending</div>
          </div>
        </div>
        <p style="font-size:0.78rem;color:var(--text-mid);margin-bottom:1rem;line-height:1.5">${esc(c.description)}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:auto">
          <button class="btn btn-primary btn-sm" onclick="openCourseEditor(${Number(c.id)})">Edit Curriculum</button>
          <button class="btn btn-outline btn-sm" onclick="openAttendanceModal(${Number(c.id)})">Attendance</button>
          <a href="students.html" class="btn btn-ghost btn-sm">View Students</a>
          ${pendingG > 0 ? `<a href="grading.html" class="btn btn-outline btn-sm"
            style="color:var(--warning);border-color:var(--warning)">${pendingG} to approve</a>` : ''}
        </div>
      </div>`;
  });
  grid.innerHTML = cards.join('');
}

let _editorCourseId = null;

function openCourseEditor(cid) {
  _editorCourseId = cid;
  const course = COURSES[cid];
  // Guarding this at all is new. Every line below dereferences `course`, so a
  // stale card (a course deleted by an admin while the teacher's tab was open)
  // threw "Cannot read properties of undefined" and the editor never opened,
  // with nothing on screen to say why.
  if (!course) { showToast('That course no longer exists - reload the page.'); return; }
  const batchName = (BATCHES.find(b => b.id === course.batchId) || {}).name || 'Unknown batch';
  setText('editor-course-label', `${batchName} · ${esc(course.subject)} · ${teacherLabel(course.teacher)}`);
  setText('editor-course-title', course.title);
  renderEditorBody(cid);
  const modal = document.getElementById('course-editor-modal');
  if (modal) modal.style.display = 'flex';
}
function closeCourseEditor() { const modal = document.getElementById('course-editor-modal'); if (modal) modal.style.display = 'none'; }

/** Rebuilds the curriculum editor modal body: one collapsible block per week, one row per topic, with an inline content-material editor per topic. */
function renderEditorBody(cid) {
  const course = COURSES[cid];
  const body   = document.getElementById('editor-body');
  if (!body) return;
  body.innerHTML = '';

  course.weeks.forEach((week, wi) => {
    const weekDiv = document.createElement('div');
    weekDiv.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius-lg);overflow:hidden;margin-bottom:0.85rem';
    weekDiv.innerHTML = `
      <div style="background:var(--bg);padding:0.65rem 1rem;display:flex;align-items:center;
                  justify-content:space-between;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:0.6rem;flex:1">
          <span style="font-size:0.65rem;font-family:var(--font-mono);color:var(--text-light)">W${week.num}</span>
          <input type="text" value="${esc(week.title)}"
            style="border:none;background:transparent;font-size:0.85rem;font-weight:600;
                   color:var(--text-dark);flex:1;outline:none;font-family:var(--font-body)"
            onchange="updateWeekTitle(${cid}, ${wi}, this.value)">
        </div>
        <div style="display:flex;gap:5px">
          <button class="btn btn-primary btn-sm" onclick="openAddTopicModal(${cid}, ${week.num})">+ Topic</button>
          <button class="btn btn-danger btn-sm" onclick="deleteWeek(${cid}, ${wi})"
            style="padding:0.32rem 0.5rem">&#215;</button>
        </div>
      </div>
      <div id="week-topics-${cid}-${wi}" style="padding:0.5rem"></div>`;

    const topicsContainer = weekDiv.querySelector(`#week-topics-${cid}-${wi}`);

    week.topics.forEach((topic, ti) => {
      const topicDiv = document.createElement('div');
      topicDiv.style.cssText = 'border:1px solid var(--border);border-radius:var(--radius);margin-bottom:0.5rem;overflow:hidden';
      topicDiv.innerHTML = `
        <!-- Topic header (click to expand the material editor below it) -->
        <div style="display:flex;align-items:center;gap:0.6rem;padding:0.6rem 0.75rem;
                    background:var(--white);cursor:pointer"
          onclick="toggleTopicEditor('topic-edit-${cid}-${wi}-${ti}')">
          <span style="font-size:0.68rem;font-family:var(--font-mono);color:var(--text-light)">${topic.num}</span>
          <input type="text" value="${esc(topic.title)}"
            onclick="event.stopPropagation()"
            style="border:none;background:transparent;font-size:0.82rem;font-weight:500;
                   color:var(--text-dark);flex:1;outline:none;font-family:var(--font-body)"
            onchange="updateTopicTitle(${cid}, ${wi}, ${ti}, this.value)">
          <div style="display:flex;gap:3px">
            ${topic.contents.map(c => `<span class="tpill ${c.type}" style="font-size:0.6rem">${c.type}</span>`).join('')}
          </div>
          ${topic.dueDate ? `<span style="font-size:0.65rem;color:var(--warning);font-family:var(--font-mono)">Due ${topic.dueDate}</span>` : ''}
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation();deleteTopic(${cid},${wi},${ti})"
            style="padding:0.28rem 0.45rem;flex-shrink:0">&#215;</button>
          <span style="font-size:0.65rem;color:var(--text-light)">▾</span>
        </div>

        <!-- Topic material editor (collapsed by default) -->
        <div id="topic-edit-${cid}-${wi}-${ti}"
          style="display:none;padding:0.85rem;background:var(--bg);
                 border-top:1px solid var(--border)">

          <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;flex-wrap:wrap">
            <label style="font-size:0.72rem;font-weight:600;color:var(--text-mid)">Due Date</label>
            <input type="date" value="${topic.dueDate || ''}"
              style="border:1px solid var(--border);border-radius:var(--radius);
                     padding:3px 8px;font-size:0.78rem;font-family:var(--font-mono)"
              onchange="updateTopicDue(${cid},${wi},${ti},this.value)">
          </div>

          ${buildMaterialEditor(topic, cid, wi, ti)}

          <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid var(--border)">
            <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.07em;
                        color:var(--text-light);margin-bottom:0.4rem">Add Content</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap">
              ${['video', 'notes', 'quiz', 'assign', 'link'].map(type => `
                <button class="btn btn-ghost btn-sm" style="font-size:0.72rem"
                  onclick="addContentToTopic(${cid},${wi},${ti},'${type}')">+ ${type}</button>
              `).join('')}
            </div>
          </div>
        </div>`;
      topicsContainer.appendChild(topicDiv);
    });

    if (!week.topics.length) {
      topicsContainer.innerHTML = '<p style="text-align:center;color:var(--text-light);font-size:0.78rem;padding:0.75rem">No topics yet.</p>';
    }
    body.appendChild(weekDiv);
  });

  if (!course.weeks.length) {
    body.innerHTML = '<p style="text-align:center;color:var(--text-light);font-size:0.82rem;padding:2rem">No weeks yet. Add a week below.</p>';
  }
}

function toggleTopicEditor(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

/** Builds the per-content-item edit fields inside a topic's material editor (one card per video/notes/quiz/assign/link entry). */
function buildMaterialEditor(topic, cid, wi, ti) {
  if (!topic.contents || !topic.contents.length) return '';
  return topic.contents.map((c, ci) => {
    let inner = '';
    if (c.type === 'video') {
      inner = `
        <div class="form-group" style="margin:0">
          <label style="font-size:0.72rem">Video URL / Embed Link</label>
          <input type="text" class="form-control" style="font-size:0.78rem"
            value="${esc(c.url || '')}" placeholder="https://youtube.com/..."
            onchange="updateContentField(${cid},${wi},${ti},${ci},'url',this.value)">
        </div>
        <div class="form-group" style="margin:0.4rem 0 0">
          <label style="font-size:0.72rem">Duration (e.g. 18:30)</label>
          <input type="text" class="form-control" style="font-size:0.78rem;width:120px"
            value="${esc(c.duration || '')}" placeholder="00:00"
            onchange="updateContentField(${cid},${wi},${ti},${ci},'duration',this.value)">
        </div>`;
    } else if (c.type === 'notes') {
      inner = `
        <div class="form-group" style="margin:0">
          <label style="font-size:0.72rem">Notes PDF URL</label>
          <input type="text" class="form-control" style="font-size:0.78rem"
            value="${esc(c.url || '')}" placeholder="https://drive.google.com/..."
            onchange="updateContentField(${cid},${wi},${ti},${ci},'url',this.value)">
        </div>`;
    } else if (c.type === 'assign') {
      inner = `
        <div class="form-group" style="margin:0">
          <label style="font-size:0.72rem">Assignment Instructions</label>
          <textarea class="form-control" style="font-size:0.78rem;min-height:60px"
            onchange="updateContentField(${cid},${wi},${ti},${ci},'detail',this.value)"
            >${esc(c.detail || '')}</textarea>
        </div>
        <div class="form-group" style="margin:0.4rem 0 0">
          <label style="font-size:0.72rem">Total Marks</label>
          <input type="number" class="form-control" style="font-size:0.78rem;width:100px"
            value="${c.totalMarks || 10}" min="1"
            onchange="updateContentField(${cid},${wi},${ti},${ci},'totalMarks',parseInt(this.value))">
        </div>`;
    } else if (c.type === 'quiz') {
      inner = `
        <div style="font-size:0.75rem;color:var(--text-mid);margin-bottom:0.4rem">
          ${(c.questions || []).length} question(s) defined
        </div>
        <button class="btn btn-outline btn-sm" style="font-size:0.72rem"
          onclick="openQuizEditor(${cid},${wi},${ti},${ci})">Edit Quiz Questions</button>`;
    } else if (c.type === 'link') {
      inner = `
        <div class="form-group" style="margin:0">
          <label style="font-size:0.72rem">Link Label</label>
          <input type="text" class="form-control" style="font-size:0.78rem"
            value="${esc(c.label || '')}" placeholder="PMC Reference"
            onchange="updateContentField(${cid},${wi},${ti},${ci},'label',this.value)">
        </div>
        <div class="form-group" style="margin:0.4rem 0 0">
          <label style="font-size:0.72rem">URL</label>
          <input type="text" class="form-control" style="font-size:0.78rem"
            value="${esc(c.url || '')}" placeholder="https://..."
            onchange="updateContentField(${cid},${wi},${ti},${ci},'url',this.value)">
        </div>`;
    }
    return `
      <div style="background:var(--white);border:1px solid var(--border);border-radius:var(--radius);
                  padding:0.75rem;margin-bottom:0.5rem">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem">
          <span class="tpill ${c.type}">${c.type}</span>
          <button class="btn btn-danger btn-sm" style="padding:0.2rem 0.4rem;font-size:0.65rem"
            onclick="removeContentFromTopic(${cid},${wi},${ti},${ci})">Remove</button>
        </div>
        ${inner}
      </div>`;
  }).join('');
}

async function addContentToTopic(cid, wi, ti, type) {
  try {
    COURSES[cid] = await apiFetch(`/courses/${cid}/weeks/${wi}/topics/${ti}/contents`, {
      method: 'POST', body: JSON.stringify({ type }),
    });
    renderEditorBody(cid);
    setTimeout(() => {
      const el = document.getElementById(`topic-edit-${cid}-${wi}-${ti}`);
      if (el) el.style.display = 'block';
    }, 50);
  } catch (err) {
    showToast(err.message);
  }
}

async function removeContentFromTopic(cid, wi, ti, ci) {
  try {
    COURSES[cid] = await apiFetch(`/courses/${cid}/weeks/${wi}/topics/${ti}/contents/${ci}`, { method: 'DELETE' });
    renderEditorBody(cid);
    setTimeout(() => {
      const el = document.getElementById(`topic-edit-${cid}-${wi}-${ti}`);
      if (el) el.style.display = 'block';
    }, 50);
  } catch (err) {
    showToast(err.message);
  }
}


async function updateContentField(cid, wi, ti, ci, field, value) {
  try {
    COURSES[cid] = await apiFetch(`/courses/${cid}/weeks/${wi}/topics/${ti}/contents/${ci}`, {
      method: 'PUT', body: JSON.stringify({ field, value }),
    });
  } catch (err) {
    showToast(err.message);
    renderEditorBody(cid);
  }
}


/** Opens a modal for editing a quiz content-item's questions/options/correct-answer. */
function openQuizEditor(cid, wi, ti, ci) {
  const topic   = COURSES[cid].weeks[wi].topics[ti];
  const content = topic.contents[ci];
  const questions = content.questions || [];
  questions.forEach(q => { if (q.ans === undefined) q.ans = Number.isInteger(q.correct) ? q.correct : 0; });

  let modal = document.getElementById('quiz-editor-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'quiz-editor-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:400;backdrop-filter:blur(2px)';
    document.body.appendChild(modal);
  }

  const renderQs = () => questions.map((q, qi) => `
    <div style="border:1px solid var(--border);border-radius:var(--radius);
                padding:0.75rem;margin-bottom:0.5rem;background:var(--bg)">
      <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem">
        <input type="text" class="form-control" style="font-size:0.78rem;flex:1"
          value="${esc(q.q || '')}" placeholder="Question text"
          onchange="COURSES[${cid}].weeks[${wi}].topics[${ti}].contents[${ci}].questions[${qi}].q=this.value">
        <button class="btn btn-danger btn-sm" style="padding:0.2rem 0.4rem"
          onclick="removeQuizQuestion(${cid},${wi},${ti},${ci},${qi})">&#215;</button>
      </div>
      ${q.options.map((opt, oi) => `
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:3px">
          <input type="radio" name="ans-${qi}" value="${oi}" ${q.ans === oi ? 'checked' : ''}
            onchange="COURSES[${cid}].weeks[${wi}].topics[${ti}].contents[${ci}].questions[${qi}].ans=${oi}"
            title="Mark as correct answer">
          <input type="text" class="form-control" style="font-size:0.75rem;flex:1"
            value="${esc(opt)}" placeholder="Option ${String.fromCharCode(65 + oi)}"
            onchange="COURSES[${cid}].weeks[${wi}].topics[${ti}].contents[${ci}].questions[${qi}].options[${oi}]=this.value">
        </div>`).join('')}
      <div style="font-size:0.65rem;color:var(--text-light);margin-top:4px">
        ● Select the radio button next to the correct answer
      </div>
    </div>`).join('');

  modal.innerHTML = `
    <div style="background:var(--white);border-radius:var(--radius-xl);width:100%;max-width:520px;
                max-height:85vh;overflow-y:auto;box-shadow:var(--shadow-lg);border:1px solid var(--border)">
      <div style="padding:1.25rem 1.4rem;border-bottom:1px solid var(--border);
                  display:flex;align-items:center;justify-content:space-between;
                  position:sticky;top:0;background:var(--white);z-index:10">
        <div>
          <div style="font-size:0.7rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.07em">Quiz Editor</div>
          <div style="font-weight:600">${esc(topic.title)}</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-primary btn-sm"
            onclick="saveQuizEditor(${cid},${wi},${ti},${ci})">Save Quiz</button>
          <button class="btn btn-ghost btn-sm"
            onclick="document.getElementById('quiz-editor-modal').style.display='none'">Close</button>
        </div>
      </div>
      <div style="padding:1.25rem" id="quiz-questions-body">
        ${renderQs()}
        ${!questions.length ? '<p style="text-align:center;color:var(--text-light);padding:1rem">No questions yet.</p>' : ''}
      </div>
      <div style="padding:1rem 1.4rem;border-top:1px solid var(--border);background:var(--bg)">
        <button class="btn btn-outline btn-full btn-sm"
          onclick="addQuizQuestion(${cid},${wi},${ti},${ci})">+ Add Question</button>
      </div>
    </div>`;
}

function addQuizQuestion(cid, wi, ti, ci) {
  COURSES[cid].weeks[wi].topics[ti].contents[ci].questions.push({ q: '', options: ['', '', '', ''], ans: 0 });
  openQuizEditor(cid, wi, ti, ci);
}
function removeQuizQuestion(cid, wi, ti, ci, qi) {
  COURSES[cid].weeks[wi].topics[ti].contents[ci].questions.splice(qi, 1);
  openQuizEditor(cid, wi, ti, ci);
}

async function saveQuizEditor(cid, wi, ti, ci) {
  const content = COURSES[cid].weeks[wi].topics[ti].contents[ci];
  const questions = (content.questions || []).map(q => ({
    q: q.q,
    options: q.options,
    correct: q.ans,
    explanation: q.explanation || '',
  }));
  try {
    COURSES[cid] = await apiFetch(`/courses/${cid}/weeks/${wi}/topics/${ti}/contents/${ci}/questions`, {
      method: 'PUT', body: JSON.stringify({ questions }),
    });
    document.getElementById('quiz-editor-modal').style.display = 'none';
    renderEditorBody(cid);
    showToast('Quiz saved.');
  } catch (err) {
    showToast(err.message);
  }
}


async function updateWeekTitle(cid, wi, val) {
  const title = (val || '').trim();
  if (!title) { showToast('Week title cannot be empty.'); renderEditorBody(cid); return; }
  try {
    COURSES[cid] = await apiFetch(`/courses/${cid}/weeks/${wi}`, {
      method: 'PUT', body: JSON.stringify({ title }),
    });
  } catch (err) {
    showToast(err.message);
    renderEditorBody(cid); // revert the input to the last-known-good value
  }
}

async function updateTopicTitle(cid, wi, ti, val) {
  const title = (val || '').trim();
  if (!title) { showToast('Topic title cannot be empty.'); renderEditorBody(cid); return; }
  try {
    COURSES[cid] = await apiFetch(`/courses/${cid}/weeks/${wi}/topics/${ti}`, {
      method: 'PUT', body: JSON.stringify({ title }),
    });
  } catch (err) {
    showToast(err.message);
    renderEditorBody(cid);
  }
}

async function updateTopicDue(cid, wi, ti, val) {
  try {
    COURSES[cid] = await apiFetch(`/courses/${cid}/weeks/${wi}/topics/${ti}`, {
      method: 'PUT', body: JSON.stringify({ dueDate: val || null }),
    });
  } catch (err) {
    showToast(err.message);
    renderEditorBody(cid);
  }
}

function promptAddDue(cid, wi, ti) {
  const val = prompt('Enter due date (YYYY-MM-DD):');
  if (val) updateTopicDue(cid, wi, ti, val).then(() => renderEditorBody(cid));
}

async function addWeekToEditor() {
  const inp = document.getElementById('new-week-title');
  if (!inp || !inp.value.trim()) { showToast('Enter a week title first.'); return; }
  try {
    const updated = await apiFetch(`/courses/${_editorCourseId}/weeks`, {
      method: 'POST',
      body: JSON.stringify({ title: inp.value.trim() }),
    });
    COURSES[_editorCourseId] = updated;
    inp.value = '';
    renderEditorBody(_editorCourseId);
    showToast('Week added.');
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteWeek(cid, wi) {
  if (!confirm('Delete this week and all its topics?')) return;
  try {
    COURSES[cid] = await apiFetch(`/courses/${cid}/weeks/${wi}`, { method: 'DELETE' });
    renderEditorBody(cid);
    showToast('Week removed.');
  } catch (err) {
    showToast(err.message);
  }
}

async function deleteTopic(cid, wi, ti) {
  if (!confirm('Remove this topic?')) return;
  try {
    COURSES[cid] = await apiFetch(`/courses/${cid}/weeks/${wi}/topics/${ti}`, { method: 'DELETE' });
    renderEditorBody(cid);
    showToast('Topic removed.');
  } catch (err) {
    showToast(err.message);
  }
}


function saveEditorChanges() {
  closeCourseEditor();
  if (document.getElementById('teacher-courses-grid')) renderTeacherCourses();
  showToast('All changes are saved.');
}

function openAddTopicModal(cid, wnum) {
  document.getElementById('add-topic-cid').value = cid;
  document.getElementById('add-topic-wnum').value = wnum;
  document.getElementById('new-topic-title').value = '';
  document.getElementById('new-topic-due').value = '';
  document.querySelectorAll('#content-type-checks input').forEach(cb => cb.checked = false);
  document.getElementById('add-topic-modal').style.display = 'flex';
}

function closeAddTopicModal() { document.getElementById('add-topic-modal').style.display = 'none'; }

async function submitAddTopic() {
  const cid   = parseInt(document.getElementById('add-topic-cid').value);
  const wnum  = parseInt(document.getElementById('add-topic-wnum').value);
  const title = document.getElementById('new-topic-title').value.trim();
  const due   = document.getElementById('new-topic-due').value || null;
  if (!title) { showToast('Enter a topic title.'); return; }

  const wi = COURSES[cid].weeks.findIndex(w => w.num === wnum);
  if (wi === -1) return;

  const types = [...document.querySelectorAll('#content-type-checks input:checked')].map(cb => cb.value);
  try {
    COURSES[cid] = await apiFetch(`/courses/${cid}/weeks/${wi}/topics`, {
      method: 'POST',
      body: JSON.stringify({ title, dueDate: due, contentTypes: types }),
    });
    closeAddTopicModal();
    renderEditorBody(cid);
    showToast('Topic added.');
  } catch (err) {
    showToast(err.message);
  }
}

let _currentStudentCourse = 'all';

/** Sets up the course-filter tabs on the teacher's Students page, then renders the table. */
function renderTeacherStudents() {
  const tabsEl = document.getElementById('student-course-tabs');
  if (!tabsEl) return;
  const courseIds = getTeacherCourseIds();
  const tabs = [
    { id: 'all', label: 'All Courses' },
    ...courseIds.map(cid => ({ id: cid, label: COURSES[cid]?.subject || cid }))
  ];
  tabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'ctab' + (tab.id === _currentStudentCourse ? ' active' : '');
    el.textContent = tab.label;
    el.onclick = () => {
      _currentStudentCourse = tab.id;
      document.querySelectorAll('#student-course-tabs .ctab').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      refreshStudentTable();
    };
    tabsEl.appendChild(el);
  });
  refreshStudentTable();
}

/** Re-renders the students table + stat cards for the currently-selected course tab and search term. */
function refreshStudentTable() {
  const courseId  = _currentStudentCourse;
  const tbody     = document.getElementById('students-tbody');
  const statsEl   = document.getElementById('student-stats');
  const titleEl   = document.getElementById('student-table-title');
  const courseIds = getTeacherCourseIds();
  if (!tbody) return;

  let students = STUDENTS_DB.filter(s => s.enrolledCourseIds.some(id => courseIds.includes(id)));
  if (courseId !== 'all') {
    students = students.filter(s => s.enrolledCourseIds.includes(parseInt(courseId)));
  }
  if (titleEl) titleEl.textContent = courseId === 'all' ? 'All My Students' : COURSES[courseId]?.title || 'Students';

  if (statsEl && courseId !== 'all') {
    const cid  = parseInt(courseId);
    const avgP = students.length ? Math.round(students.reduce((a, s) => a + studentProgressScore(s, cid), 0) / students.length) : 0;
    const avgQ = students.length ? Math.round(students.reduce((a, s) => a + studentQuizAvg(s), 0) / students.length) : 0;
    const submitted = students.flatMap(s => s.assignments.filter(a => a.courseId === cid && a.submitted)).length;
    statsEl.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon si-blue" style="font-family:var(--font-mono);font-weight:700">S</div>
        <div class="stat-info"><div class="sv">${students.length}</div><div class="sl">Enrolled</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon si-green" style="font-family:var(--font-mono);font-weight:700">P</div>
        <div class="stat-info"><div class="sv">${avgP}%</div><div class="sl">Avg Progress</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon si-orange" style="font-family:var(--font-mono);font-weight:700">Q</div>
        <div class="stat-info"><div class="sv">${avgQ}%</div><div class="sl">Quiz Average</div></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon si-navy" style="font-family:var(--font-mono);font-weight:700">A</div>
        <div class="stat-info"><div class="sv">${submitted}</div><div class="sl">Submitted</div></div>
      </div>`;
  } else if (statsEl) statsEl.innerHTML = '';

  tbody.innerHTML = '';
  const search = (document.getElementById('student-search')?.value || '').toLowerCase();
  const filtered = students.filter(s =>
    !search || s.name.toLowerCase().includes(search) || s.rollNo.toLowerCase().includes(search)
  );

  filtered.forEach(s => {
    const cid      = courseId !== 'all' ? parseInt(courseId) : s.enrolledCourseIds.find(id => courseIds.includes(id));
    const progress = studentProgressScore(s, cid);
    const quizAvg  = studentQuizAvg(s);
    const grade    = calcGradeFromThreshold(progress);
    const attRow   = s.attendanceDetail.find(a => COURSES[cid]?.subject === a.subject) || s.attendanceDetail[0];
    const attPct   = attRow ? Math.round(attRow.attended / attRow.total * 100) : s.attendance;
    const submittedC = s.assignments.filter(a => (courseId === 'all' || a.courseId === cid) && a.submitted).length;
    const totalC      = s.assignments.filter(a => courseId === 'all' || a.courseId === cid).length;
    const oColor = progress >= 75 ? 'var(--success)' : progress >= 60 ? 'var(--warning)' : 'var(--danger)';

    tbody.innerHTML += `<tr>
      <td>
        <div style="font-weight:600;font-size:0.85rem">${esc(s.name)}</div>
        <div style="font-size:0.7rem;color:var(--text-light);font-family:var(--font-mono)">${esc(s.batch)}</div>
      </td>
      <td style="font-family:var(--font-mono);font-size:0.75rem">${esc(s.rollNo)}</td>
      <td>
        <div style="display:flex;align-items:center;gap:7px">
          <div class="progress-track" style="width:70px">
            <div class="progress-fill" style="width:${progress}%"></div>
          </div>
          <span style="font-size:0.75rem;font-family:var(--font-mono)">${progress}%</span>
        </div>
      </td>
      <td><span style="font-family:var(--font-mono);font-size:0.82rem;
                color:${quizAvg >= 70 ? 'var(--success)' : quizAvg >= 50 ? 'var(--warning)' : 'var(--danger)'}">
        ${quizAvg}%</span></td>
      <td><span style="font-family:var(--font-mono);font-size:0.82rem;
                color:${attPct >= 85 ? 'var(--success)' : attPct >= 75 ? 'var(--warning)' : 'var(--danger)'}">
        ${attPct}%</span></td>
      <td style="font-family:var(--font-mono);font-size:0.78rem">${submittedC}/${totalC}</td>
      <td>
        <span style="font-family:var(--font-mono);font-weight:700;color:${oColor}">${grade}</span>
        <span style="font-size:0.72rem;color:var(--text-light);margin-left:4px">${progress}%</span>
      </td>
      <td><button class="btn btn-ghost btn-sm" onclick="openStudentDetail('${s.id}')">View</button></td>
    </tr>`;
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-light);padding:2rem;font-size:0.82rem">No students found.</td></tr>';
  }
}

function filterStudents() { refreshStudentTable(); }

/** Opens the read-only student detail modal (teacher view): stat cards, profile info, full assignment + quiz history. */
function openStudentDetail(sid) {
  const s = STUDENTS_DB.find(st => st.id === sid);
  if (!s) return;
  setText('sdm-name', s.name);
  const quizAvg  = studentQuizAvg(s);
  const assignAv = studentAssignmentAvg(s);
  const body = document.getElementById('student-detail-body');
  if (!body) return;
  body.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0.6rem;margin-bottom:1.25rem">
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:0.75rem;text-align:center"><div style="font-size:1.4rem;font-weight:700;font-family:var(--font-mono)">${s.attendance}%</div><div style="font-size:0.65rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.06em">Attendance</div></div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:0.75rem;text-align:center"><div style="font-size:1.4rem;font-weight:700;font-family:var(--font-mono)">${quizAvg}%</div><div style="font-size:0.65rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.06em">Quiz Avg</div></div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:0.75rem;text-align:center"><div style="font-size:1.4rem;font-weight:700;font-family:var(--font-mono)">${assignAv !== null ? assignAv + '%' : '-'}</div><div style="font-size:0.65rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.06em">Assignments</div></div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:0.75rem;text-align:center"><div style="font-size:1.4rem;font-weight:700;font-family:var(--font-mono)">${s.assignments.filter(a => a.submitted).length}/${s.assignments.length}</div><div style="font-size:0.65rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.06em">Submitted</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:1.25rem;font-size:0.82rem">
      <div style="color:var(--text-mid)">Roll No</div><div style="font-family:var(--font-mono)">${esc(s.rollNo)}</div>
      <div style="color:var(--text-mid)">Batch</div><div>${esc(s.batch)}</div>
      <div style="color:var(--text-mid)">Entry Test</div><div>${s.entryTest}</div>
      <div style="color:var(--text-mid)">City</div><div>${s.city}</div>
      <div style="color:var(--text-mid)">Email</div><div style="font-family:var(--font-mono);font-size:0.75rem">${esc(s.email)}</div>
      // <div style="color:var(--text-mid)">Fee Status</div><div><span class="badge ${s.feeStatus === 'Paid' ? 'badge-green' : s.feeStatus === 'Partially Paid' ? 'badge-orange' : 'badge-red'}">${s.feeStatus}</span></div>
    </div>
    <div style="margin-bottom:1rem">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-light);margin-bottom:0.5rem">Assignments</div>
      ${s.assignments.map(a => `
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.82rem">
          <div style="flex:1"><div style="font-weight:500">${esc(a.title)}</div><div style="font-size:0.72rem;color:var(--text-light)">${esc(a.course)}</div></div>
          ${a.submitted ? (a.grade ? `<span class="badge badge-green" style="font-family:var(--font-mono)">${a.marks}/${a.totalMarks} · ${a.grade}</span>` : `<span class="badge badge-orange">Needs grading</span>`) : `<span class="badge badge-red">Not submitted</span>`}
          ${a.submitted && !a.grade ? `<button class="btn btn-outline btn-sm" onclick="closeStudentDetail();openGradeModal('${s.id}','${a.id}','assign')">Grade</button>` : ''}
        </div>`).join('')}
    </div>
    <div>
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-light);margin-bottom:0.5rem">Quiz History</div>
      ${s.quizScores.map(q => {
        const pct = Math.round(q.score / q.total * 100);
        return `<div style="display:flex;align-items:center;gap:0.75rem;padding:0.45rem 0;border-bottom:1px solid var(--border);font-size:0.82rem">
          <div style="flex:1"><div style="font-weight:500">${esc(q.topic)}</div><div style="font-size:0.72rem;color:var(--text-light)">${esc(q.subject)} · ${q.date}</div></div>
          <span style="font-family:var(--font-mono);font-weight:600;color:${pct >= 70 ? 'var(--success)' : 'var(--danger)'}">${q.score}/${q.total}</span>
        </div>`;
      }).join('')}
    </div>`;
  document.getElementById('student-detail-modal').style.display = 'flex';
}
function closeStudentDetail() { document.getElementById('student-detail-modal').style.display = 'none'; }

/**
 * Populates the course-filter dropdown on the Grading page (once), then renders
 * the grading list.
 *
 * The body of this function used to be empty apart from renderGrading(), and the
 * dropdown was filled by a second DOMContentLoaded handler inside grading.html.
 * That handler could never work: this file registers its own DOMContentLoaded
 * listener first and that listener is async, so it yields at `await
 * loadAppData()` - meaning the page's handler ran while COURSES was still {}.
 * The filter therefore only ever contained "All Courses". Doing it here, from
 * inside the router, guarantees the data has already landed.
 */
function initGrading() {
  const cf = document.getElementById('grade-filter-course');
  if (cf) {
    const opts = ['<option value="all">All Courses</option>'];
    getTeacherCourseIds().forEach(cid => {
      const c = COURSES[cid];
      if (c) opts.push(`<option value="${escAttr(cid)}">${esc(c.title)}</option>`);
    });
    cf.innerHTML = opts.join('');
  }
  renderGrading();
}

/**
 * Renders the Grading page: the editable grade-threshold strip at the top,
 * followed by every gradable item (submitted assignments + quiz attempts)
 * across the teacher's courses, filtered by the course/type/status dropdowns.
 */
function renderGrading() {
  const container = document.getElementById('grading-container');
  if (!container) return;

  const teacherCourseIds = getTeacherCourseIds();
  const courseFilter = document.getElementById('grade-filter-course')?.value || 'all';
  const typeFilter   = document.getElementById('grade-filter-type')?.value   || 'all';
  const statusFilter = document.getElementById('grade-filter-status')?.value || 'all';

  let threshHtml = `
    <div class="card" style="margin-bottom:1.25rem">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.85rem">
        <div>
          <div class="card-title" style="margin:0">Grade Thresholds</div>
          <div style="font-size:0.75rem;color:var(--text-light)">
            Change a threshold and click Apply - all auto-grades update instantly.
          </div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="applyThresholds()">Apply & Update All</button>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0.5rem" id="threshold-editor">
        ${GRADE_THRESHOLDS.map((t, i) => `
          <div style="display:flex;align-items:center;gap:4px;background:var(--bg);
                      border:1px solid var(--border);border-radius:var(--radius);
                      padding:4px 8px;font-size:0.78rem">
            <strong style="font-family:var(--font-mono);min-width:22px">${t.grade}</strong>
            <span style="color:var(--text-light)">≥</span>
            <input type="number" value="${t.min}" min="0" max="100"
              data-idx="${i}"
              style="width:44px;border:1px solid var(--border);border-radius:3px;
                     padding:1px 4px;font-size:0.78rem;font-family:var(--font-mono);
                     text-align:center">
            <span style="color:var(--text-light);font-size:0.7rem">%</span>
          </div>`).join('')}
      </div>
    </div>`;

  let items = [];

  if (typeFilter === 'all' || typeFilter === 'assign') {
    STUDENTS_DB.forEach(s => s.assignments.forEach(a => {
      if (!teacherCourseIds.includes(a.courseId)) return;
      if (courseFilter !== 'all' && a.courseId !== parseInt(courseFilter)) return;
      if (statusFilter === 'pending' && a.approved) return;
      if (statusFilter === 'approved' && !a.approved) return;
      items.push({ type: 'assign', studentId: s.id, studentName: s.name, ...a });
    }));
  }

  if (typeFilter === 'all' || typeFilter === 'quiz') {
    STUDENTS_DB.forEach(s => s.quizScores.forEach(q => {
      let qCourseId = null;
      Object.values(COURSES).forEach(c => {
        if (allTopics(c.id).find(t => t.id === q.topicId)) qCourseId = c.id;
      });
      if (!qCourseId || !teacherCourseIds.includes(qCourseId)) return;
      if (courseFilter !== 'all' && qCourseId !== parseInt(courseFilter)) return;
      items.push({ type: 'quiz', studentId: s.id, studentName: s.name, courseId: qCourseId, course: COURSES[qCourseId]?.title, ...q });
    }));
  }

  const countEl = document.getElementById('grade-count');
  if (countEl) countEl.textContent = items.length + ' item' + (items.length !== 1 ? 's' : '');

  container.innerHTML = threshHtml;

  if (!items.length) {
    container.innerHTML += '<div style="text-align:center;padding:3rem;color:var(--text-light);font-size:0.85rem;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--white)">No items found.</div>';
    return;
  }

  items.forEach(item => {
    const isAssign = item.type === 'assign';
    const pct = isAssign
      ? (item.marks !== null && item.totalMarks ? Math.round(item.marks / item.totalMarks * 100) : null)
      : Math.round(item.score / item.total * 100);
    const autoGrade = pct !== null ? calcGradeFromThreshold(pct) : '-';
    const approved  = isAssign ? !!item.approved : true; // quizzes are always auto-approved

    const statusBadge = approved
      ? '<span class="badge badge-green">Approved</span>'
      : item.submitted
        ? '<span class="badge badge-orange">Needs Approval</span>'
        : '<span class="badge badge-red">Not Submitted</span>';

    const div = document.createElement('div');
    div.style.cssText = 'background:var(--white);border:1px solid var(--border);border-radius:var(--radius-lg);padding:1rem 1.25rem;margin-bottom:0.6rem';
    div.innerHTML = `
      <div style="display:flex;align-items:center;gap:1rem">
        <div style="width:36px;height:36px;border-radius:var(--radius);flex-shrink:0;
                    background:${isAssign ? 'var(--success-light)' : 'var(--warning-light)'};
                    color:${isAssign ? 'var(--success)' : 'var(--warning)'};
                    display:flex;align-items:center;justify-content:center;
                    font-family:var(--font-mono);font-weight:700;font-size:0.75rem">
          ${isAssign ? 'A' : 'Q'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:0.88rem">${esc(item.title || item.topic || '-')}</div>
          <div style="font-size:0.75rem;color:var(--text-light)">
            ${esc(item.studentName)} · ${esc(item.course || '-')}
            ${isAssign && item.submittedOn ? ` · Submitted ${esc(item.submittedOn)}` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:0.65rem;flex-shrink:0">
          ${pct !== null ? `
            <div style="text-align:center">
              <div style="font-family:var(--font-mono);font-weight:700;font-size:1rem;
                          color:${pct >= 70 ? 'var(--success)' : pct >= 50 ? 'var(--warning)' : 'var(--danger)'}">
                ${isAssign ? `${item.marks}/${item.totalMarks}` : `${item.score}/${item.total}`}
              </div>
              <div style="font-size:0.65rem;color:var(--text-light)">${pct}%</div>
            </div>
            <div style="text-align:center;background:var(--bg);border:1px solid var(--border);
                        border-radius:var(--radius);padding:4px 10px">
              <div style="font-size:1rem;font-weight:700;font-family:var(--font-mono);
                          color:var(--navy)">${autoGrade}</div>
              <div style="font-size:0.6rem;color:var(--text-light)">Auto Grade</div>
            </div>` : ''}
          ${statusBadge}
          ${isAssign && item.submitted ? `
            <button class="btn btn-outline btn-sm"
              onclick="openGradeModal('${escAttr(item.studentId)}','${escAttr(item.id)}','assign')">
              ${approved ? 'Edit' : 'Review'}
            </button>
            ${!approved ? `
              <button class="btn btn-primary btn-sm"
                onclick="approveGrade('${escAttr(item.studentId)}','${escAttr(item.id)}')">
                Approve
              </button>` : ''}` : ''}
        </div>
      </div>`;
    container.appendChild(div);
  });
}

/** Opens the manual grade-entry modal for one assignment or quiz attempt, pre-filled with its current marks/feedback. */
function openGradeModal(studentId, itemId, type) {
  const student = STUDENTS_DB.find(s => s.id === studentId);
  if (!student) return;
  const item = type === 'assign' ? student.assignments.find(a => a.id === itemId) : student.quizScores.find(q => q.id === itemId);
  if (!item) return;

  document.getElementById('gm-student-id').value = studentId;
  document.getElementById('gm-item-id').value    = itemId;
  document.getElementById('gm-item-type').value  = type;
  setText('gm-type-label',   type === 'assign' ? 'Assignment' : 'Quiz');
  setText('gm-title',        item.title || item.topic || '-');
  setText('gm-student-name', student.name);
  setText('gm-submitted-on', type === 'assign' ? (item.submittedOn || '-') : (item.date || '-'));
  setText('gm-course-name',  item.course || '-');

  // Submission preview. Every value here was typed by the STUDENT, so it goes
  // through esc()/escAttr() - this was raw innerHTML before, which means a
  // student could put markup (or a script tag) in their answer text or file name
  // and have it execute in the teacher's session when the teacher opened the
  // grade modal. That is the one XSS path in this app with a real attacker on
  // the other end of it.
  // const FILE_BASE = API_BASE.replace('/api', '');
  const subEl = document.getElementById('gm-submission-content');
  if (subEl) {
    if (type === 'assign') {
      let html = '';
      if (item.answerText) {
        html += `<div style="margin-bottom:6px"><strong>Answer:</strong> ${esc(item.answerText)}</div>`;
      }
      if (item.fileUrl) {
        const m = /^\/uploads\/([A-Za-z0-9._-]+)$/.exec(item.fileUrl);
        html += m
          ? `<div><strong>File:</strong> <a href="#" onclick="downloadAssignmentFile('${escAttr(m[1])}','${escAttr(item.fileName || m[1])}');return false">${esc(item.fileName || 'Download attachment')}</a></div>`
          : '<div><strong>File:</strong> <em>attachment path looks wrong - not linked</em></div>';
      }
      subEl.innerHTML = html || '<em>No written answer or file submitted.</em>';
      subEl.style.display = 'block';
    } else {
      subEl.style.display = 'none';
    }
  }

  const marksEl = document.getElementById('gm-marks');
  const totalEl = document.getElementById('gm-total');
  const gradeEl = document.getElementById('gm-grade-letter');
  const feedEl  = document.getElementById('gm-feedback');

  if (type === 'assign') {
    marksEl.value = item.marks || ''; totalEl.value = item.totalMarks || 10;
    gradeEl.value = item.grade || ''; feedEl.value  = item.feedback || '';
    totalEl.disabled = false;
  } else {
    marksEl.value = item.score; totalEl.value = item.total;
    totalEl.disabled = true; gradeEl.value = ''; feedEl.value = item.feedback || '';
  }
  // Show the auto-grade strip straight away instead of waiting for the teacher
  // to touch the marks box. Re-opening a graded item used to show the preview
  // hidden and blank even though marks were already filled in.
  previewAutoGrade();
  document.getElementById('grade-modal').style.display = 'flex';
}
function closeGradeModal() { document.getElementById('grade-modal').style.display = 'none'; }

/**
 * Reads the grade modal, validates it, and returns
 * { studentId, itemId, type, marks, total, gradeLtr, feedback, pct, grade }
 * or null if something is wrong (a toast has already been shown).
 *
 * Shared by submitGrade() and submitAndApproveGrade() so the two buttons can
 * never disagree about what counts as valid. They used to be two independent
 * copies of the same twenty lines, living in grading.html.
 */
function readGradeForm() {
  const studentId = document.getElementById('gm-student-id').value;
  const itemId    = document.getElementById('gm-item-id').value;
  const type      = document.getElementById('gm-item-type').value;
  const marks     = parseFloat(document.getElementById('gm-marks').value);
  const total     = parseFloat(document.getElementById('gm-total').value);
  const gradeLtr  = document.getElementById('gm-grade-letter').value;
  const feedback  = document.getElementById('gm-feedback').value.trim();

  if (isNaN(marks) || isNaN(total) || total <= 0) { showToast('Enter valid marks.'); return null; }
  if (marks < 0) { showToast('Marks cannot be negative.'); return null; }
  if (marks > total) { showToast(`Marks (${marks}) cannot exceed the total (${total}).`); return null; }

  const student = STUDENTS_DB.find(s => s.id === studentId);
  if (!student) { showToast('That student is no longer in the list - reload the page.'); return null; }

  const pct = Math.round(marks / total * 100);
  return {
    studentId, itemId, type, marks, total, gradeLtr, feedback, student, pct,
    // The grading list shows calcGradeFromThreshold(pct), because thresholds are
    // editable at the top of the page. Saving used to store calcGradeLetter(pct)
    // - the hard-coded legacy scale - so after any threshold change the letter
    // in the list and the letter actually saved were different grades.
    grade: gradeLtr || calcGradeFromThreshold(pct),
  };
}

/** Live "Auto Grade" preview in the grade modal as the teacher types marks. */
function previewAutoGrade() {
  const marks   = parseFloat(document.getElementById('gm-marks').value);
  const total   = parseFloat(document.getElementById('gm-total').value);
  const preview = document.getElementById('gm-auto-preview');
  const gradeEl = document.getElementById('gm-auto-grade');
  if (!preview || !gradeEl) return;

  if (!isNaN(marks) && !isNaN(total) && total > 0 && marks >= 0 && marks <= total) {
    const pct = Math.round(marks / total * 100);
    gradeEl.textContent = `${calcGradeFromThreshold(pct)} (${pct}%)`;
    preview.style.display = 'block';
  } else {
    preview.style.display = 'none';
  }
}

/** Persists the marks/feedback in the grade modal. Returns true on success. */
async function saveGradeFields(f) {
  if (f.type === 'assign') {
    const updated = await apiFetch(`/students/${f.studentId}/assignments/${f.itemId}/grade`, {
      method: 'PATCH',
      body: JSON.stringify({ marks: f.marks, totalMarks: f.total, grade: f.grade, feedback: f.feedback }),
    });
    const item = f.student.assignments.find(a => a.id === f.itemId);
    if (item) Object.assign(item, updated);
  } else {
    const updated = await apiFetch(`/students/${f.studentId}/quiz-scores/${f.itemId}/grade`, {
      method: 'PATCH',
      body: JSON.stringify({ score: f.marks, feedback: f.feedback }),
    });
    const item = f.student.quizScores.find(q => q.id === f.itemId);
    if (item) Object.assign(item, updated);
  }
  return true;
}

/** Re-renders whatever grade-aware view is on screen. */
function refreshAfterGrade() {
  if (document.getElementById('grading-container')) renderGrading();
  if (document.getElementById('students-tbody'))    refreshStudentTable();
}

/** "Save Marks" - records the marks without publishing the grade to the student. */
async function submitGrade() {
  const f = readGradeForm();
  if (!f) return;
  try {
    await saveGradeFields(f);
    closeGradeModal();
    showToast(`Marks saved - ${f.grade}. Not published until you approve it.`);
    refreshAfterGrade();
  } catch (err) {
    showToast(err.message);
  }
}

/**
 * "Save & Approve" - saves the marks and then approves in one click.
 *
 * This function did not exist in app.js at all. The only copy lived in
 * grading.html's inline <script>, mutated STUDENTS_DB in memory, and then called
 * saveStudentsDB() and autoUpdateAttendance() - neither of which exists anywhere
 * in the codebase. So the button threw a ReferenceError partway through: nothing
 * was persisted, the modal stayed open, and the page never re-rendered. From the
 * teacher's side, clicking "Save & Approve" simply did nothing.
 *
 * Approval is a separate PATCH because the server refuses to approve an
 * assignment with no marks; doing the two in order means the marks are always
 * there by the time approve runs.
 */
async function submitAndApproveGrade() {
  const f = readGradeForm();
  if (!f) return;
  try {
    await saveGradeFields(f);

    if (f.type === 'assign') {
      const approved = await apiFetch(`/students/${f.studentId}/assignments/${f.itemId}/approve`, {
        method: 'PATCH',
      });
      const item = f.student.assignments.find(a => a.id === f.itemId);
      if (item) Object.assign(item, approved);
    }
    // Quiz attempts have no approval step - they are visible to the student as
    // soon as they're scored, which is why there's no /approve route for them.

    closeGradeModal();
    showToast(`Grade published: ${f.grade}`);
    refreshAfterGrade();
  } catch (err) {
    showToast(err.message);
  }
}

/** Renders the teacher's weekly schedule grid (one column per day, editable classes). */
/**
 * The current teacher's own classes, as { row, idx } pairs where idx is the index
 * into TEACHER_SCHEDULE (what editClass/deleteClass expect).
 *
 * GET /api/schedule returns the WHOLE academy timetable - it has to, because the
 * student dashboard reads the same endpoint. The teacher page was rendering all
 * of it, so every teacher saw every colleague's classes and could click "edit" on
 * them. The server now refuses that with a 403, but the row shouldn't be offered
 * in the first place.
 */
function myScheduleRows() {
  const me = getActiveTeacher();
  return TEACHER_SCHEDULE
    .map((row, idx) => ({ row, idx }))
    .filter(({ row }) => {
      if (!me) return true;                       // admin view: show everything
      if (row.teacherId) return row.teacherId === me.id;
      // Legacy rows have no teacherId. Fall back to "is this one of my courses",
      // so an existing timetable doesn't vanish after this change.
      return getTeacherCourseIds().some(cid => COURSES[cid] && COURSES[cid].title === row.course);
    });
}

function renderTeacherSchedule() {
  const grid = document.getElementById('teacher-schedule-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const mine = myScheduleRows();

  let html = '';
  days.forEach(day => {
    const classes = mine.filter(({ row }) => row.day === day)
                        .sort((a, b) => String(a.row.time).localeCompare(String(b.row.time)));
    const isToday = day === today;
    const rows = classes.length
      ? classes.map(({ row: r, idx }) => `
      <div class="day-class" style="cursor:pointer" onclick="editClass(${idx})">
        <div class="class-time">${esc(r.time)}</div>
        <div class="class-info" style="flex:1">
          <h4>${esc(r.subject || 'Unknown subject')} <span class="badge ${r.type === 'online' ? 'badge-blue' : 'badge-green'}">${esc(r.type || '')}</span></h4>
          <p>${esc(r.course || '')}${r.course ? ' · ' : ''}${esc(r.room || 'TBA')} · ${esc(r.duration || 0)}min</p>
        </div>
        <span style="font-size:0.7rem;color:var(--text-light);font-family:var(--font-mono)">edit</span>
      </div>`).join('')
      : '<p style="color:var(--text-light);font-size:0.78rem;padding:0.85rem 0.9rem">No classes.</p>';
    html += `<div class="day-card"><div class="day-card-head ${isToday ? 'today' : ''}">${day}${isToday ? ' - Today' : ''}</div>${rows}</div>`;
  });
  // Built as one string and assigned once. The old loop did `grid.innerHTML +=`
  // per day, which re-parses the entire grid on every iteration.
  grid.innerHTML = html;
}

/**
 * Fills the class modal's course dropdown with the teacher's own courses.
 *
 * Lives here, called on modal open, because schedule.html used to do this in its
 * own DOMContentLoaded handler. That handler always lost the race: app.js's
 * handler runs first, hits `await loadAppData()` and yields, so the inline one
 * executed while COURSES was still {} - the dropdown was permanently empty and
 * no class could be scheduled at all.
 *
 * Option values are course IDS. They used to be course titles, which is what
 * forced submitAddClass() into guessing the subject by matching that title back
 * to a course - and storing the title itself as the "subject" when the match
 * failed.
 */
function populateClassCourseSelect(selectedCourseId = '') {
  const sel = document.getElementById('acm-course');
  if (!sel) return;
  const ids = getTeacherCourseIds().filter(cid => COURSES[cid]);
  if (!ids.length) {
    sel.innerHTML = '<option value="">No courses assigned to you yet</option>';
    return;
  }
  sel.innerHTML = '<option value="">Select course...</option>' + ids.map(cid => {
    const c = COURSES[cid];
    return `<option value="${escAttr(c.id)}">${esc(c.title)} - ${esc(c.subject)}</option>`;
  }).join('');
  if (selectedCourseId !== '' && selectedCourseId != null) sel.value = String(selectedCourseId);
}

function openAddClassModal() {
  document.getElementById('acm-title').textContent = 'Add Class';
  document.getElementById('acm-edit-index').value  = '';
  populateClassCourseSelect('');
  // Every field is reset explicitly. Leaving day/type at whatever the last edit
  // set them to is how a class quietly lands on the wrong day.
  document.getElementById('acm-day').value  = 'Monday';
  document.getElementById('acm-type').value = 'physical';
  document.getElementById('acm-time').value = '09:00';
  document.getElementById('acm-room').value = '';
  document.getElementById('acm-duration').value = '90';
  document.getElementById('acm-delete-btn').style.display = 'none';
  clearFieldErrors('add-class-modal');
  toggleRoomField();
  document.getElementById('add-class-modal').style.display = 'flex';
}
function closeAddClassModal() { document.getElementById('add-class-modal').style.display = 'none'; }

function editClass(idx) {
  const r = TEACHER_SCHEDULE[idx];
  if (!r) return;
  document.getElementById('acm-title').textContent = 'Edit Class';
  document.getElementById('acm-edit-index').value  = idx;

  // Restoring the course is not optional. This step was missing, so opening an
  // existing class showed whatever course was last selected (or nothing), and
  // saving reassigned the class to it.
  const courseId = r.courseId != null
    ? r.courseId
    : (Object.values(COURSES).find(c => c.title === r.course) || {}).id;
  populateClassCourseSelect(courseId != null ? courseId : '');

  document.getElementById('acm-day').value      = r.day || 'Monday';
  document.getElementById('acm-time').value     = r.time || '09:00';
  document.getElementById('acm-type').value     = r.type || 'physical';
  document.getElementById('acm-room').value     = r.room || '';
  document.getElementById('acm-duration').value = r.duration || 90;
  document.getElementById('acm-delete-btn').style.display = 'inline-flex';
  clearFieldErrors('add-class-modal');
  toggleRoomField();
  document.getElementById('add-class-modal').style.display = 'flex';
}
function toggleRoomField() {
  const type = document.getElementById('acm-type')?.value;
  const label = document.getElementById('acm-room-label');
  if (label) label.textContent = type === 'online' ? 'Meeting Link / Platform' : 'Room / Hall';
  const input = document.getElementById('acm-room');
  if (input) input.placeholder = type === 'online' ? 'e.g. Zoom link' : 'e.g. Hall A';
}

async function submitAddClass() {
  const idx      = document.getElementById('acm-edit-index').value;
  const courseId = document.getElementById('acm-course').value;
  const day      = document.getElementById('acm-day').value;
  const time     = document.getElementById('acm-time').value;
  const type     = document.getElementById('acm-type').value;
  const room     = document.getElementById('acm-room').value.trim();
  const duration = document.getElementById('acm-duration').value;

  clearFieldErrors('add-class-modal');
  if (!courseId) {
    setFieldError('acm-course', 'Pick a course - the class subject comes from it.');
    return;
  }
  if (!time) { setFieldError('acm-time', 'Pick a start time.'); return; }

  // `subject` is deliberately NOT sent. The server derives it from the course, so
  // it is always a real Subject name. This used to be computed here as
  // `c ? c.subject : course` - and that fallback wrote the COURSE TITLE into the
  // subject field whenever the title lookup missed, producing schedule rows whose
  // "subject" matched nothing in the Subject collection.
  const payload = { courseId: Number(courseId), day, time, type, room, duration: Number(duration) };
  const course  = COURSES[Number(courseId)];

  try {
    let shouldNotify = true;
    if (idx !== '') {
      const existing = TEACHER_SCHEDULE[parseInt(idx, 10)];
      shouldNotify = existing.day !== payload.day || existing.time !== payload.time ||
        existing.type !== payload.type || existing.room !== payload.room ||
        existing.duration !== payload.duration || existing.courseId !== payload.courseId;
      const updated = await apiFetchDetailed(`/schedule/${existing._id}`, { method: 'PUT', body: JSON.stringify(payload) });
      TEACHER_SCHEDULE[parseInt(idx, 10)] = updated;
    } else {
      const created = await apiFetchDetailed('/schedule', { method: 'POST', body: JSON.stringify(payload) });
      TEACHER_SCHEDULE.push(created);
    }
    closeAddClassModal();
    renderTeacherSchedule();


    showToast('Schedule updated.');
  } catch (err) {
  if (err.fieldErrors && err.fieldErrors.courseId) { err.fieldErrors.course = err.fieldErrors.courseId; delete err.fieldErrors.courseId; }
    const orphans = applyFieldErrors(err.fieldErrors, 'acm', 'add-class-modal');
    if (!err.fieldErrors || orphans.length) showToast(err.message);
  }
}


async function deleteClass() {
  const idx = parseInt(document.getElementById('acm-edit-index').value, 10);
  if (isNaN(idx)) return;
  const existing = TEACHER_SCHEDULE[idx];
  if (!existing) return;
  if (!confirm(`Remove the ${existing.subject || ''} class on ${existing.day} at ${existing.time}?`)) return;

  try {
    await apiFetchDetailed(`/schedule/${existing._id}`, { method: 'DELETE' });
    TEACHER_SCHEDULE.splice(idx, 1);
    closeAddClassModal();
    renderTeacherSchedule();
    showToast('Class removed.');
  } catch (err) {
    showToast(err.message);
  }
}

// ══════════════════════════════════════════════════
//   20. ADMIN PAGES - full CRUD over students, teachers, batches, entry tests
// ══════════════════════════════════════════════════







/** Renders the admin Students table, applying the search box + batch/fee/test filters. */
function renderAdminStudents() {
  const V = window.MRValidate || {};

  // Filter dropdowns are populated once, here, rather than in the HTML. Two
  // reasons: BATCHES/ENTRY_TESTS aren't loaded when the page is parsed, and
  // hard-coded fee-status options had drifted out of sync with the values
  // actually stored ('Unpaid' in the markup vs 'Pending' in the database), so
  // choosing that filter always returned an empty table.
  const batchFilterSel = document.getElementById('admin-batch-filter');
  if (batchFilterSel && !batchFilterSel.dataset.populated) {
    populateSelect(batchFilterSel, BATCHES.map(b => b.name), { placeholder: null, selected: 'all' });
    batchFilterSel.insertAdjacentHTML('afterbegin', '<option value="all">All Batches</option>');
    batchFilterSel.value = 'all';
    batchFilterSel.dataset.populated = 'true';
  }
  const feeFilterSel = document.getElementById('admin-fee-filter');
  if (feeFilterSel && !feeFilterSel.dataset.populated) {
    populateSelect(feeFilterSel, V.FEE_STATUSES || ['Paid', 'Partial', 'Pending', 'Overdue'], { placeholder: null });
    feeFilterSel.insertAdjacentHTML('afterbegin', '<option value="all">All Statuses</option>');
    feeFilterSel.value = 'all';
    feeFilterSel.dataset.populated = 'true';
  }
  const testFilterSel = document.getElementById('admin-test-filter');
  if (testFilterSel && !testFilterSel.dataset.populated) {
    populateSelect(testFilterSel, ENTRY_TESTS.map(t => t.name), { placeholder: null });
    testFilterSel.insertAdjacentHTML('afterbegin', '<option value="all">All Entry Tests</option>');
    testFilterSel.value = 'all';
    testFilterSel.dataset.populated = 'true';
  }

  const tbody   = document.getElementById('admin-students-tbody');
  const countEl = document.getElementById('admin-student-count');
  const search  = (document.getElementById('admin-student-search')?.value || '').toLowerCase();
  const batchF  = batchFilterSel?.value || 'all';
  const feeF    = feeFilterSel?.value   || 'all';
  const testF   = testFilterSel?.value  || 'all';
  if (!tbody) return;

  let students = STUDENTS_DB;
  if (search) {
    students = students.filter(s =>
      (s.name || '').toLowerCase().includes(search) ||
      (s.rollNo || '').toLowerCase().includes(search) ||
      (s.email || '').toLowerCase().includes(search) ||
      (s.phone || '').includes(search) ||
      (s.guardianName || '').toLowerCase().includes(search));
  }
  if (batchF !== 'all') students = students.filter(s => s.batch === batchF);
  if (feeF   !== 'all') students = students.filter(s => s.feeStatus === feeF);
  if (testF  !== 'all') students = students.filter(s => s.entryTest === testF);

  if (countEl) countEl.textContent = students.length + ' student' + (students.length !== 1 ? 's' : '');
  if (!students.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-light);padding:2rem;font-size:0.82rem">No students found.</td></tr>';
    return;
  }

  tbody.innerHTML = students.map(s => {
    const att = Number(s.attendance) || 0;
    const attColor = att >= 85 ? 'var(--success)' : att >= 75 ? 'var(--warning)' : 'var(--danger)';
    const total = Number(s.totalFee) || 0;
    const paid  = Number(s.paidAmount) || 0;
    const balance = Math.max(0, total - paid);
    // Colour by the ACTUAL numbers, not just the stored label. A record marked
    // 'Paid' with money still outstanding is the exact inconsistency that used
    // to hide unpaid balances, so show the balance either way.
    const feeClass = s.feeStatus === 'Paid' ? 'badge-green'
                   : s.feeStatus === 'Partial' ? 'badge-orange'
                   : s.feeStatus === 'Overdue' ? 'badge-red' : 'badge-red';
    return `<tr>
      <td>
        <div style="font-weight:600">${esc(s.name)}</div>
        <div style="font-size:0.72rem;color:var(--text-light);font-family:var(--font-mono)">${esc(s.email)}</div>
      </td>
      <td style="font-family:var(--font-mono);font-size:0.76rem">${esc(s.rollNo)}</td>
      <td>${s.batch ? esc(s.batch) : '<span style="color:var(--text-light);font-size:0.76rem">not enrolled</span>'}</td>
      <td>${s.entryTest ? `<span class="badge badge-blue" style="font-family:var(--font-mono)">${esc(s.entryTest)}</span>` : '-'}</td>
      <td><span style="font-family:var(--font-mono);font-weight:600;color:${attColor}">${att}%</span></td>
      <td>
        <span class="badge ${feeClass}">${esc(s.feeStatus || '-')}</span>
        <div style="font-size:0.7rem;color:var(--text-light);font-family:var(--font-mono)">
          ${balance > 0 ? 'Rs. ' + balance.toLocaleString() + ' due' : 'settled'}
        </div>
      </td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openAdminStudentModal('${escAttr(s.id)}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteStudent('${escAttr(s.id)}')">Remove</button>
      </td>
    </tr>`;
  }).join('');
}

/** Opens the admin Add/Edit Student modal, pre-filled if `sid` is given. */
function openAdminStudentModal(sid) {
  const modal = document.getElementById('admin-student-modal');
  if (!modal) return;
  const V = window.MRValidate || {};
  clearFieldErrors('admin-student-modal');

  const titleEl = document.getElementById('asm-modal-title');
  const delBtn  = document.getElementById('asm-delete-btn');
  const pwWrap  = document.getElementById('asm-password-wrap');

  const s = sid ? STUDENTS_DB.find(st => st.id === sid) : null;
  if (sid && !s) { showToast('That student is no longer in the list. Refresh the page.'); return; }

  // Fill every dropdown at open time - see populateSelect() for why page-parse
  // time doesn't work here.
  populateSelect('asm-gender', V.GENDERS || ['Male', 'Female', 'Other'], { selected: s?.gender || '', placeholder: '- Select -' });
  populateSelect('asm-feeStatus', V.FEE_STATUSES || ['Paid', 'Partial', 'Pending', 'Overdue'], {
    selected: s?.feeStatus || 'Pending', placeholder: null,
  });
  populateSelect('asm-batch', BATCHES.map(b => b.name), {
    selected: s?.batch || '', placeholder: '- Not enrolled yet -',
    emptyText: 'No batches yet - create one on the Batches page',
  });
  populateSelect('asm-entryTest', ENTRY_TESTS.map(t => t.name), {
    selected: s?.entryTest || '', placeholder: '- None -',
    emptyText: 'No entry tests yet - create one on the Entry Tests page',
  });

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val === null || val === undefined ? '' : val; };

  if (s) {
    titleEl.textContent = 'Edit Student';
    delBtn.style.display = 'inline-flex';
    set('asm-id', s.id);
    set('asm-name', s.name);
    set('asm-rollNo', s.rollNo);
    set('asm-email', s.email);
    set('asm-phone', s.phone);
    set('asm-cnic', s.cnic);
    set('asm-dob', (s.dob || '').slice(0, 10));   // <input type="date"> needs yyyy-mm-dd
    set('asm-previousSchool', s.previousSchool);
    set('asm-guardianName', s.guardianName);
    set('asm-guardianPhone', s.guardianPhone);
    set('asm-city', s.city);
    set('asm-address', s.address);
    set('asm-totalFee', s.totalFee);
    set('asm-paidAmount', s.paidAmount);
    set('asm-attendance', s.attendance);
    if (pwWrap) pwWrap.style.display = 'none';
  } else {
    titleEl.textContent = 'Add Student';
    delBtn.style.display = 'none';
    ['asm-id', 'asm-name', 'asm-rollNo', 'asm-email', 'asm-phone', 'asm-cnic', 'asm-dob',
     'asm-previousSchool', 'asm-guardianName', 'asm-guardianPhone', 'asm-city',
     'asm-address', 'asm-totalFee', 'asm-password'].forEach(id => set(id, ''));
    set('asm-paidAmount', '0');
    // Attendance defaults to 0, not 85. The old default invented a number that
    // no attendance record supported, so a brand-new student appeared to have
    // been present at classes that hadn't happened.
    set('asm-attendance', '0');
    if (pwWrap) pwWrap.style.display = 'block';
  }
  syncEntryTestFromBatch();
  const rb = document.getElementById('asm-reset-btn'); if (rb) rb.style.display = s ? 'inline-flex' : 'none';
  const fb = document.getElementById('asm-fees-btn'); if (fb) fb.style.display = s ? 'inline-flex' : 'none';
  const locked = !!(s && (s.fees || []).length);
  ['asm-feeStatus', 'asm-totalFee', 'asm-paidAmount'].forEach(id => { const el = document.getElementById(id); if (el) el.disabled = locked; });
  modal.style.display = 'flex';

}

function closeAdminStudentModal() {
  clearFieldErrors('admin-student-modal');
  const m = document.getElementById('admin-student-modal');
  if (m) m.style.display = 'none';
}

/**
 * Create or update a student.
 *
 * New students get empty course/grade data; enrolment into courses happens
 * through the chosen batch, on the server.
 */
async function saveAdminStudent() {
  const id = fv('asm-id');
  const btn = document.getElementById('asm-save-btn');
  const V = window.MRValidate;

  // Keys match MRValidate.STUDENT_RULES so server-side errors map back onto
  // the matching `asm-<key>` input.
  const raw = {
    name: fv('asm-name'),
    rollNo: fv('asm-rollNo'),
    email: fv('asm-email'),
    phone: fv('asm-phone'),
    cnic: fv('asm-cnic'),
    gender: fv('asm-gender'),
    dob: fv('asm-dob'),
    city: fv('asm-city'),
    address: fv('asm-address'),
    previousSchool: fv('asm-previousSchool'),
    guardianName: fv('asm-guardianName'),
    guardianPhone: fv('asm-guardianPhone'),
    batch: fv('asm-batch'),
    entryTest: fv('asm-entryTest'),
    feeStatus: fv('asm-feeStatus'),
    totalFee: fv('asm-totalFee'),
    paidAmount: fv('asm-paidAmount'),
    attendance: fv('asm-attendance') === '' ? '0' : fv('asm-attendance'),
  };

  const values = validateForm(V && V.STUDENT_RULES, raw, 'asm', 'admin-student-modal');
  if (!values) return;

  // Cross-field checks no single field can make on its own: paid <= total, a
  // guardian number that isn't just the student's own number again, and a fee
  // status that agrees with the amounts. On EDIT the server merges these
  // against what's stored, so this pass is the fast-feedback copy only.
  if (V && V.crossCheckStudent) {
    const xErrors = V.crossCheckStudent(values);
    if (Object.keys(xErrors).length) {
      const orphaned = applyFieldErrors(xErrors, 'asm', 'admin-student-modal');
      showToast(orphaned.length ? orphaned[0] : V.firstError(xErrors));
      return;
    }
  }

  const password = fv('asm-password').trim();
  if (!id && password && password.length < 6) {
    setFieldError('asm-password', 'Must be at least 8 characters, or leave blank.');
    showToast('Password must be at least 8 characters, or leave it blank to generate one.');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    if (id) {
      const updated = await apiFetchDetailed(`/students/${encodeURIComponent(id)}`, {
        method: 'PUT', body: JSON.stringify(values),
      });
      const idx = STUDENTS_DB.findIndex(s => s.id === id);
      if (idx !== -1) STUDENTS_DB[idx] = updated; else STUDENTS_DB.push(updated);
      closeAdminStudentModal();
      renderAdminStudents();
      showToast('Student updated.');
    } else {
      const created = await apiFetchDetailed('/students', {
        method: 'POST',
        body: JSON.stringify({ ...values, ...(password ? { password } : {}) }),
      });
      STUDENTS_DB.push(created.student);
      closeAdminStudentModal();
      renderAdminStudents();
      // `created` only exists in this branch. The old code read
      // created.tempPassword after the if/else, which threw a ReferenceError on
      // every EDIT - and wrongly said "Student added" when updating.
      if (created.tempPassword) {
        showCredentials({ title: 'Student account created', name: created.student.name, email: created.student.email, password: created.tempPassword });
      } else {
        showToast('Student added. They can log in with the password you set.');
      }
    }
    // Enrolling into a batch changes that batch's studentIds server-side, so
    // pull the fresh copy instead of leaving the page showing a stale roster.
    try { BATCHES = await apiFetch('/batches'); } catch (e) { /* table still fine */ }
  } catch (err) {
    if (err.fieldErrors) {
      const orphaned = applyFieldErrors(err.fieldErrors, 'asm', 'admin-student-modal');
      showToast(orphaned.length ? orphaned[0] : err.message);
    } else {
      showToast(err.message);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}

function deleteCurrentStudent() { const id = fv('asm-id'); if (id) deleteStudent(id); }

async function deleteStudent(sid) {
  const s = STUDENTS_DB.find(x => x.id === sid);
  if (!confirm(`Remove ${s ? s.name : 'this student'}? Their login, grades and fee history go with them. This cannot be undone.`)) return;
  try {
    await apiFetchDetailed(`/students/${encodeURIComponent(sid)}`, { method: 'DELETE' });
    const idx = STUDENTS_DB.findIndex(x => x.id === sid);
    if (idx !== -1) STUDENTS_DB.splice(idx, 1);
    closeAdminStudentModal();
    // The server also pulls this student out of every batch roster.
    try { BATCHES = await apiFetch('/batches'); } catch (e) { /* non-fatal */ }
    renderAdminStudents();
    showToast('Student removed.');
  } catch (err) {
    showToast(err.message);
  }
}

/** Renders the admin Teachers stat row + table, applying the search box. */
function renderAdminTeachers() {
  const statsEl = document.getElementById('teacher-stats-row');
  if (statsEl) {
    const active   = TEACHERS_DB.filter(t => t.status === 'active').length;
    const inactive = TEACHERS_DB.filter(t => t.status === 'inactive').length;
    // A teacher with no subject can never be assigned to anything, so surface
    // the count instead of letting it sit invisible in the table.
    const noSubject = TEACHERS_DB.filter(t => !(t.subjects || []).length).length;
    statsEl.innerHTML =
      `<div class="stat-card"><div class="stat-icon si-navy" style="font-family:var(--font-mono);font-weight:700">T</div><div class="stat-info"><div class="sv">${TEACHERS_DB.length}</div><div class="sl">Total Teachers</div></div></div>` +
      `<div class="stat-card"><div class="stat-icon si-green" style="font-family:var(--font-mono);font-weight:700">A</div><div class="stat-info"><div class="sv">${active}</div><div class="sl">Active</div></div></div>` +
      `<div class="stat-card"><div class="stat-icon si-orange" style="font-family:var(--font-mono);font-weight:700">I</div><div class="stat-info"><div class="sv">${inactive}</div><div class="sl">Inactive</div></div></div>` +
      `<div class="stat-card"><div class="stat-icon ${noSubject ? 'si-red' : 'si-blue'}" style="font-family:var(--font-mono);font-weight:700">S</div><div class="stat-info"><div class="sv">${noSubject}</div><div class="sl">No Subject Set</div></div></div>`;
  }

  const tbody  = document.getElementById('admin-teachers-tbody');
  const search = (document.getElementById('teacher-search')?.value || '').toLowerCase();
  if (!tbody) return;

  let teachers = TEACHERS_DB;
  if (search) {
    teachers = teachers.filter(t =>
      (t.name || '').toLowerCase().includes(search) ||
      (t.email || '').toLowerCase().includes(search) ||
      (t.qualification || '').toLowerCase().includes(search) ||
      (t.subjects || []).some(s => s.toLowerCase().includes(search)));
  }
  tbody.innerHTML = '';
  if (!teachers.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-light);padding:2rem;font-size:0.82rem">No teachers found.</td></tr>'; return; }

  // Note the esc() on every interpolated value. These come straight from a
  // form, so without escaping a name containing < or & mangles the row (and a
  // deliberately crafted one would inject markup into the admin's page).
  tbody.innerHTML = teachers.map(t => {
    const courseNames = (t.courseIds || []).map(cid => COURSES[cid]?.title || COURSES[cid]?.subject).filter(Boolean).join(', ') || '-';
    const subjects = (t.subjects || []);
    return `<tr>
      <td>
        <div style="font-weight:600">${esc(t.name)}</div>
        <div style="font-size:0.72rem;color:var(--text-light);font-family:var(--font-mono)">${esc(t.email)}</div>
      </td>
      <td>${subjects.length
            ? subjects.map(s => `<span class="badge badge-blue" style="margin:0 0.2rem 0.2rem 0">${esc(s)}</span>`).join('')
            : '<span class="badge badge-red">none - cannot be assigned</span>'}</td>
      <td style="font-family:var(--font-mono);font-size:0.76rem">${esc(t.phone)}</td>
      <td style="font-size:0.78rem;color:var(--text-mid)">
        ${esc(t.qualification || '-')}${t.experience ? ` · ${esc(t.experience)}y` : ''}
        <div style="font-size:0.7rem;color:var(--text-light)">${esc(courseNames)}</div>
      </td>
      <td><span class="badge ${t.status === 'active' ? 'badge-green' : 'badge-orange'}">${esc(t.status)}</span></td>
      <td style="font-family:var(--font-mono);font-size:0.76rem">${esc(fmtJoinDate(t.joinDate))}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openAdminTeacherModal('${escAttr(t.id)}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTeacher('${escAttr(t.id)}')">Remove</button>
      </td>
    </tr>`;
  }).join('');
}

/**
 * joinDate is now stored as a sortable ISO date ('2026-08-30') instead of a
 * locale string ('Aug 30, 2026'), because the old format sorted alphabetically
 * - 'Apr' before 'Jan' - in every list that ordered by it. Format for display
 * here, keeping any legacy value readable as-is.
 */
function fmtJoinDate(v) {
  // if (!v) return '-';
  // const s = String(v);
  // if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;   // legacy locale string
  // const d = new Date(s + 'T00:00:00');
  // if (isNaN(d.getTime())) return s;
  // return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return fmtDate(v);
}

/**
 * Open the Add/Edit Teacher modal.
 *
 * Every dropdown is filled HERE rather than at page load, because SUBJECTS_DB /
 * QUALIFICATIONS are empty until loadAppData() has resolved. The option lists
 * come from window.MRValidate - the same arrays the server validates against -
 * so the form physically cannot offer a value the API will reject.
 */
function openAdminTeacherModal(tid) {
  const modal = document.getElementById('admin-teacher-modal');
  if (!modal) return;
  const V = window.MRValidate || {};
  clearFieldErrors('admin-teacher-modal');

  const titleEl = document.getElementById('atm-modal-title');
  const delBtn  = document.getElementById('atm-delete-btn');
  const pwWrap  = document.getElementById('atm-password-wrap');

  const t = tid ? TEACHERS_DB.find(x => x.id === tid) : null;
  if (tid && !t) { showToast('That teacher is no longer in the list. Refresh the page.'); return; }

  populateSelect('atm-gender', V.GENDERS || ['Male', 'Female', 'Other'], {
    selected: t?.gender || '', placeholder: '- Select -',
  });
  populateSelect('atm-qualification', V.QUALIFICATIONS || [], {
    selected: t?.qualification || '', placeholder: '- Select -',
  });
  populateSelect('atm-status', [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
  ], { selected: t?.status || 'active', placeholder: null });
  renderSubjectCheckboxes('atm-subjects', t?.subjects || [], 'atm-subject-cb');

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val === null || val === undefined ? '' : val; };

  if (t) {
    titleEl.textContent = 'Edit Teacher';
    delBtn.style.display = 'inline-flex';
    set('atm-id', t.id);
    set('atm-name', t.name);
    set('atm-email', t.email);
    set('atm-phone', t.phone);
    set('atm-cnic', t.cnic);
    // <input type="date"> only accepts yyyy-mm-dd; anything else silently
    // renders blank, which used to look like the stored value had been lost.
    set('atm-dob', (t.dob || '').slice(0, 10));
    set('atm-specialization', t.specialization);
    set('atm-experience', t.experience);
    set('atm-city', t.city);
    set('atm-address', t.address);
    // A password is never sent back by the API (select:false on the schema), so
    // there is nothing to prefill. Hiding the field also stops an admin from
    // thinking a blank box means "clear the password".
    if (pwWrap) pwWrap.style.display = 'none';
  } else {
    titleEl.textContent = 'Add Teacher';
    delBtn.style.display = 'none';
    ['atm-id', 'atm-name', 'atm-email', 'atm-phone', 'atm-cnic', 'atm-dob',
     'atm-specialization', 'atm-experience', 'atm-city', 'atm-address', 'atm-password']
      .forEach(id => set(id, ''));
    if (pwWrap) pwWrap.style.display = 'block';
  }
  const rb = document.getElementById('atm-reset-btn'); if (rb) rb.style.display = t ? 'inline-flex' : 'none';
  modal.style.display = 'flex';
}

function closeAdminTeacherModal() {
  clearFieldErrors('admin-teacher-modal');
  const m = document.getElementById('admin-teacher-modal');
  if (m) m.style.display = 'none';
}

/**
 * Create or update a teacher.
 *
 * Validation runs twice on purpose: once here through MRValidate.TEACHER_RULES
 * so the admin gets a message under the exact field that's wrong, and again on
 * the server with the identical rule set. The client pass is convenience only -
 * skipping it (or calling the API directly) changes nothing about what gets
 * stored.
 */
async function saveAdminTeacher() {
  const id = fv('atm-id');
  const btn = document.getElementById('atm-save-btn');
  const V = window.MRValidate;

  // Field names here must match the keys in TEACHER_RULES, because
  // applyFieldErrors() maps `errors.<field>` onto the input `atm-<field>`.
  const raw = {
    name: fv('atm-name'),
    email: fv('atm-email'),
    phone: fv('atm-phone'),
    cnic: fv('atm-cnic'),
    gender: fv('atm-gender'),
    dob: fv('atm-dob'),
    qualification: fv('atm-qualification'),
    specialization: fv('atm-specialization'),
    experience: fv('atm-experience'),
    city: fv('atm-city'),
    address: fv('atm-address'),
    status: fv('atm-status') || 'active',
  };

  const values = validateForm(V && V.TEACHER_RULES, raw, 'atm', 'admin-teacher-modal');
  if (!values) return;

  // Subjects sit outside the rule engine: valid values come from the database,
  // not from a pattern, so only the server can have the final say. Checking for
  // "at least one" here just saves a round trip.
  const subjects = readSubjectCheckboxes('atm-subject-cb');
  if (!subjects.length) {
    setFieldError('atm-subjects', 'Select at least one subject.');
    showToast('Select at least one subject - a teacher with none can never be assigned to a course.');
    return;
  }
  values.subjects = subjects;

  const password = fv('atm-password').trim();
  if (!id && password && password.length < 8) {
    setFieldError('atm-password', 'Must be at least 8 characters, or leave blank.');
    showToast('Password must be at least 8 characters, or leave it blank to generate one.');
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    if (id) {
      const updated = await apiFetchDetailed(`/teachers/${encodeURIComponent(id)}`, {
        method: 'PUT', body: JSON.stringify(values),
      });
      const idx = TEACHERS_DB.findIndex(t => t.id === id);
      if (idx !== -1) TEACHERS_DB[idx] = updated; else TEACHERS_DB.push(updated);
      closeAdminTeacherModal();
      renderAdminTeachers();
      showToast('Teacher updated.');
    } else {
      const created = await apiFetchDetailed('/teachers', {
        method: 'POST',
        body: JSON.stringify({ ...values, ...(password ? { password } : {}) }),
      });
      TEACHERS_DB.push(created.teacher);
      closeAdminTeacherModal();
      renderAdminTeachers();
      // The generated password is shown exactly once and never again - it's
      // hashed on the way in and select:false on the way out.
      if (created.tempPassword) {
        showCredentials({ title: 'Teacher account created', name: created.teacher.name, email: created.teacher.email, password: created.tempPassword });
      } else {
        showToast('Teacher added. They can log in with the password you set.');
      }
    }
  } catch (err) {
    // The API returns { message, errors: {field: why} }. Painting those inline
    // is the difference between "Failed to update teacher" and knowing the CNIC
    // is already on file.
    if (err.fieldErrors) {
      const orphaned = applyFieldErrors(err.fieldErrors, 'atm', 'admin-teacher-modal');
      showToast(orphaned.length ? orphaned[0] : err.message);
    } else {
      showToast(err.message);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
  }
}

function deleteCurrentTeacher() { const id = fv('atm-id'); if (id) deleteTeacher(id); }

async function deleteTeacher(tid) {
  const t = TEACHERS_DB.find(x => x.id === tid);
  if (!confirm(`Remove ${t ? t.name : 'this teacher'}? Their login account is deleted too.`)) return;
  try {
    await apiFetchDetailed(`/teachers/${encodeURIComponent(tid)}`, { method: 'DELETE' });
  } catch (err) {
    // 409 means the teacher still staffs a batch. The server lists exactly
    // which ones, so ask rather than either failing silently or quietly
    // leaving those subjects unstaffed.
    if (err.status === 409) {
      if (!confirm(`${err.message}\n\nDelete anyway and leave those unstaffed?`)) return;
      try {
        await apiFetchDetailed(`/teachers/${encodeURIComponent(tid)}?force=true`, { method: 'DELETE' });
      } catch (e2) { showToast(e2.message); return; }
    } else {
      showToast(err.message);
      return;
    }
  }
  const idx = TEACHERS_DB.findIndex(x => x.id === tid);
  if (idx !== -1) TEACHERS_DB.splice(idx, 1);
  closeAdminTeacherModal();
  // Batches may have lost an assignment, so refresh them from the server
  // rather than trusting the copy in memory.
  await refreshCourseRelatedData();
  renderAdminTeachers();
  showToast('Teacher removed.');
}

// ──────────────────────────────────────────────────
// ADMIN - SUBJECT MANAGEMENT
//
// Subjects are the root of the chain that decides whether a course is visible
// to anybody at all:
//
//   Subject -> EntryTest.subjects[] -> Course.subject
//           -> Teacher.subjects[]   -> Batch.subjectTeachers{subject: teacherId}
//
// Every link is exact, case-sensitive string equality, and a mismatch is
// completely silent - the course just stops appearing, for the student, the
// teacher, or both, with nothing logged. So this card does three things
// deliberately:
//
//   1. Shows what depends on each subject BEFORE you can delete it.
//   2. Renames through PATCH, which cascades the new spelling everywhere,
//      rather than letting the Subject row drift away from the courses,
//      teachers and batches still holding the old string.
//   3. Refetches the dependent lists afterwards, because a rename changes data
//      this page is holding in memory and a stale SUBJECTS_DB would put the old
//      name back into the next dropdown.
// ──────────────────────────────────────────────────

window._feeRows = [];
window._feeStudentId = null;

function openFeeInstalments() {
  const id = fv('asm-id');
  const s = STUDENTS_DB.find(x => x.id === id);
  if (!s) { showToast('Save the student first, then add instalments.'); return; }
  window._feeStudentId = id;
  window._feeRows = (s.fees || []).map(f => ({ label: f.label, amount: f.amount, dueDate: f.dueDate, paid: f.status === 'Paid' }));
  if (!window._feeRows.length) window._feeRows.push({ label: 'Instalment 1', amount: '', dueDate: '', paid: false });

  let m = document.getElementById('fee-modal');
  if (!m) {
    m = document.createElement('div');
    m.id = 'fee-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.4);display:flex;align-items:center;justify-content:center;z-index:1500;backdrop-filter:blur(2px);padding:1rem';
    document.body.appendChild(m);
  }
  m.innerHTML = `
    <div style="background:var(--white);border-radius:var(--radius-xl);width:100%;max-width:640px;max-height:88vh;display:flex;flex-direction:column;border:1px solid var(--border);box-shadow:var(--shadow-lg)">
      <div style="padding:1.1rem 1.4rem;border-bottom:1px solid var(--border)">
        <div style="font-size:0.7rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.07em">Fee instalments</div>
        <div style="font-weight:600">${esc(s.name)}</div>
      </div>
      <div style="padding:1rem 1.4rem;overflow-y:auto">
        <div id="fee-rows"></div>
        <button class="btn btn-outline btn-sm" onclick="addFeeRow()" style="margin-top:0.5rem">+ Add instalment</button>
        <div id="fee-totals" style="margin-top:0.85rem;font-size:0.78rem;font-family:var(--font-mono);color:var(--text-mid)"></div>
      </div>
      <div style="padding:0.9rem 1.4rem;border-top:1px solid var(--border);display:flex;gap:0.65rem;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" onclick="closeFeeInstalments()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="saveFeeInstalments()">Save Instalments</button>
      </div>
    </div>`;
  m.style.display = 'flex';
  renderFeeRows();
}

function closeFeeInstalments() {
  const m = document.getElementById('fee-modal');
  if (m) m.style.display = 'none';
}

function renderFeeRows() {
  const box = document.getElementById('fee-rows');
  if (!box) return;
  box.innerHTML = window._feeRows.map((r, i) => `
    <div style="display:grid;grid-template-columns:1.4fr 1fr 1fr auto auto;gap:0.5rem;align-items:center;margin-bottom:0.5rem">
      <input type="text" class="form-control" value="${esc(r.label)}" maxlength="60" placeholder="Name" oninput="feeRowChanged(${i},'label',this.value)">
      <input type="number" class="form-control" value="${esc(r.amount)}" min="1" placeholder="Amount (Rs.)" oninput="feeRowChanged(${i},'amount',this.value)">
      <input type="date" class="form-control" value="${esc(r.dueDate)}" onchange="feeRowChanged(${i},'dueDate',this.value)">
      <label style="display:flex;align-items:center;gap:4px;font-size:0.78rem;white-space:nowrap"><input type="checkbox" ${r.paid ? 'checked' : ''} onchange="feeRowChanged(${i},'paid',this.checked)"> Paid</label>
      <button class="btn btn-danger btn-sm" onclick="removeFeeRow(${i})" style="padding:0.3rem 0.5rem">&#215;</button>
    </div>`).join('');
  feeRowChanged(0, null, null);
}

function feeRowChanged(i, key, val) {
  if (key && window._feeRows[i]) window._feeRows[i][key] = val;
  const num = r => parseInt(r.amount, 10) || 0;
  const total = window._feeRows.reduce((a, r) => a + num(r), 0);
  const paid  = window._feeRows.filter(r => r.paid).reduce((a, r) => a + num(r), 0);
  const el = document.getElementById('fee-totals');
  if (el) el.textContent = `Total Rs. ${total.toLocaleString()}  ·  Paid Rs. ${paid.toLocaleString()}  ·  Remaining Rs. ${(total - paid).toLocaleString()}`;
}

function addFeeRow() {
  window._feeRows.push({ label: 'Instalment ' + (window._feeRows.length + 1), amount: '', dueDate: '', paid: false });
  renderFeeRows();
}
function removeFeeRow(i) { window._feeRows.splice(i, 1); renderFeeRows(); }

async function saveFeeInstalments() {
  try {
    const updated = await apiFetchDetailed(`/students/${encodeURIComponent(window._feeStudentId)}/fees`, {
      method: 'PUT', body: JSON.stringify({ fees: window._feeRows }),
    });
    const idx = STUDENTS_DB.findIndex(x => x.id === updated.id);
    if (idx !== -1) STUDENTS_DB[idx] = updated;
    closeFeeInstalments();
    closeAdminStudentModal();
    renderAdminStudents();
    showToast('Fee instalments saved.');
  } catch (err) {
    showToast(err.message);
  }
}




// Which row is currently in inline-rename mode (a subject _id), or null.
window._renamingSubjectId = null;

/**
 * Renders the subject table. Fetches with ?withUsage=true rather than reusing
 * SUBJECTS_DB, because the usage counts only come back from that query and they
 * are the whole point of the card - deleting a subject blind is how a batch
 * loses a teacher slot.
 */
async function renderAdminSubjects() {
  const tbody = document.getElementById('admin-subjects-tbody');
  if (!tbody) return;

  let subjects;
  try {
    subjects = await apiFetch('/subjects?withUsage=true');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:1.25rem;color:var(--red)">Could not load subjects: ${esc(err.message)}</td></tr>`;
    return;
  }

  // Keep the shared list and every dropdown fed from it in step.
  SUBJECTS_DB = subjects.map(s => ({ _id: s._id, name: s.name, isCore: s.isCore }));

  if (!subjects.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:1.25rem;color:var(--text-light)">No subjects yet. Add one above - entry tests and courses cannot be created without at least one.</td></tr>';
    return;
  }

  tbody.innerHTML = subjects.map(s => {
    const u  = s.usage || { teachers: [], courses: [], entryTests: [], batches: [], total: 0 };
    const id = String(s._id);

    // Usage is rendered as one badge per kind, with the actual names in the
    // title attribute. A bare number ("3 courses") isn't enough to act on -
    // you need to know WHICH course you're about to hide.
    const bits = [];
    if (u.courses.length)    bits.push(`<span class="badge badge-blue"  title="${escAttr(u.courses.join(', '))}">${u.courses.length} course${u.courses.length > 1 ? 's' : ''}</span>`);
    if (u.teachers.length)   bits.push(`<span class="badge badge-green" title="${escAttr(u.teachers.join(', '))}">${u.teachers.length} teacher${u.teachers.length > 1 ? 's' : ''}</span>`);
    if (u.entryTests.length) bits.push(`<span class="badge badge-navy"  title="${escAttr(u.entryTests.join(', '))}">${u.entryTests.length} entry test${u.entryTests.length > 1 ? 's' : ''}</span>`);
    if (u.batches.length)    bits.push(`<span class="badge badge-orange" title="${escAttr(u.batches.join(', '))}">${u.batches.length} batch${u.batches.length > 1 ? 'es' : ''}</span>`);
    const usageCell = bits.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:4px">${bits.join('')}</div>`
      : '<span style="font-size:0.72rem;color:var(--text-light)">nothing yet - safe to remove</span>';

    // Rename mode swaps just the name cell for an input, so the usage column
    // stays visible while you're deciding.
    if (window._renamingSubjectId === id) {
      return `<tr>
        <td>
          <input type="text" class="form-control" id="rename-subject-inp" value="${escAttr(s.name)}" maxlength="40" style="height:32px"
                 onkeydown="if(event.key==='Enter'){event.preventDefault();saveRenameSubject();}if(event.key==='Escape'){cancelRenameSubject();}">
          <span class="field-hint">Renaming updates every course, teacher, entry test and batch using the old name.</span>
        </td>
        <td>${usageCell}</td>
        <td>
          <div style="display:flex;gap:4px">
            <button class="btn btn-primary btn-sm" onclick="saveRenameSubject()">Save</button>
            <button class="btn btn-ghost btn-sm" onclick="cancelRenameSubject()">Cancel</button>
          </div>
        </td>
      </tr>`;
    }

    return `<tr>
      <td>
        <strong>${esc(s.name)}</strong>
        ${s.isCore ? '<span class="badge badge-navy" style="margin-left:6px;font-size:0.62rem" title="Seeded subject the built-in entry tests depend on">core</span>' : ''}
      </td>
      <td>${usageCell}</td>
      <td>
        <div style="display:flex;gap:4px">
          <button class="btn btn-outline btn-sm" onclick="startRenameSubject('${escAttr(id)}')">Rename</button>
          ${s.isCore
            ? '<button class="btn btn-ghost btn-sm" disabled title="Core subjects cannot be deleted" style="opacity:0.45;cursor:not-allowed">Delete</button>'
            : `<button class="btn btn-danger btn-sm" onclick="deleteSubject('${escAttr(id)}', '${escAttr(s.name)}')">Delete</button>`}
        </div>
      </td>
    </tr>`;
  }).join('');
}

/**
 * Re-pulls everything a subject name is embedded in. Called after a rename or a
 * forced delete, both of which rewrite strings inside other collections - without
 * this, the page keeps rendering the old spelling and the next dropdown built
 * from memory would reintroduce it.
 */
async function refreshSubjectDependentData() {
  try {
    const [tests, courseList, teachers, batches] = await Promise.all([
      apiFetch('/tests'),
      apiFetch('/courses'),
      apiFetch('/teachers'),
      apiFetch('/batches'),
    ]);
    ENTRY_TESTS = tests;
    COURSES = {};
    courseList.forEach(c => { COURSES[c.id] = c; });
    TEACHERS_DB = teachers;
    BATCHES = batches;
  } catch (err) {
    console.error('Could not refresh subject-dependent data:', err.message);
  }
}


/** Re-pulls everything a course/batch change can touch on the server. */
async function refreshCourseRelatedData() {
  try {
    const [courseList, students, teachers, batches] = await Promise.all([
      apiFetch('/courses'), apiFetch('/students'), apiFetch('/teachers'), apiFetch('/batches'),
    ]);
    COURSES = {};
    courseList.forEach(c => { COURSES[c.id] = c; });
    STUDENTS_DB = students; TEACHERS_DB = teachers; BATCHES = batches;
  } catch (err) {
    console.error('Could not refresh course data:', err.message);
  }
}


async function addSubject() {
  const inp = document.getElementById('new-subject-name');
  const btn = document.getElementById('add-subject-btn');
  if (!inp) return;

  const name = inp.value.trim();
  clearFieldErrors('admin-subjects-card');
  if (!name) { setFieldError('new-subject-name', 'Enter a subject name.'); return; }
  if (name.length < 2) { setFieldError('new-subject-name', 'Subject name is too short.'); return; }

  if (btn) { btn.disabled = true; btn.textContent = 'Adding...'; }
  try {
    const created = await apiFetchDetailed('/subjects', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    inp.value = '';
    await renderAdminSubjects();
    renderTestTags();               // refills the "Subjects Taught" dropdown
    showToast(`Subject "${created.name}" added.`);
  } catch (err) {
    // 409 means a case-variant already exists - the server tells us which, and
    // that message is more useful than "duplicate".
    setFieldError('new-subject-name', (err.fieldErrors && err.fieldErrors.name) || err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Add Subject'; }
  }
}

function startRenameSubject(id) {
  window._renamingSubjectId = String(id);
  renderAdminSubjects().then(() => {
    const inp = document.getElementById('rename-subject-inp');
    if (inp) { inp.focus(); inp.select(); }
  });
}

function cancelRenameSubject() {
  window._renamingSubjectId = null;
  renderAdminSubjects();
}

async function saveRenameSubject() {
  const id  = window._renamingSubjectId;
  const inp = document.getElementById('rename-subject-inp');
  if (!id || !inp) return;

  const name = inp.value.trim();
  if (!name) { setFieldError('rename-subject-inp', 'Enter a subject name.'); return; }

  try {
    const res = await apiFetchDetailed(`/subjects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    window._renamingSubjectId = null;
    await refreshSubjectDependentData();
    await renderAdminSubjects();
    renderTestTags();

    // The server reports what the cascade touched. Showing it is the difference
    // between trusting the rename and wondering whether it half-applied.
    const c = res.cascaded;
    if (c) {
      const parts = [];
      if (c.courses)    parts.push(`${c.courses} course(s)`);
      if (c.teachers)   parts.push(`${c.teachers} teacher(s)`);
      if (c.entryTests) parts.push(`${c.entryTests} entry test(s)`);
      if (c.batches)    parts.push(`${c.batches} batch(es)`);
      showToast(parts.length
        ? `Renamed to "${res.subject.name}" and updated ${parts.join(', ')}.`
        : `Renamed to "${res.subject.name}".`);
    } else {
      showToast('Subject renamed.');
    }
  } catch (err) {
    setFieldError('rename-subject-inp', (err.fieldErrors && err.fieldErrors.name) || err.message);
  }
}

async function deleteSubject(id, name) {
  if (!confirm(`Remove the subject "${name}"?`)) return;

  try {
    await apiFetchDetailed(`/subjects/${id}`, { method: 'DELETE' });
    await renderAdminSubjects();
    renderTestTags();
    showToast(`"${name}" removed.`);
    return;
  } catch (err) {
    // 409 = still in use. The server's message names every course, teacher,
    // entry test and batch that depends on it, so put that in front of the
    // admin verbatim instead of a generic "cannot delete".
    if (err.status !== 409) { showToast(err.message); return; }
    if (!confirm(`${err.message}\n\nRemove it anyway and strip it from all of them?`)) return;

    try {
      await apiFetchDetailed(`/subjects/${id}?force=true`, { method: 'DELETE' });
      await refreshSubjectDependentData();
      await renderAdminSubjects();
      renderTestTags();
      showToast(`"${name}" removed and detached from everything that used it.`);
    } catch (err2) {
      showToast(err2.message);
    }
  }
}

// ──────────────────────────────────────────────────
// ADMIN - ENTRY TEST MANAGEMENT
// ──────────────────────────────────────────────────
//
// renderAdminTests() used to live here. It guarded on `#admin-tests-container`,
// an id that exists in no HTML file in this project, so it returned on its first
// line every time it was called. renderTestTags() below is the real entry point
// and the router calls it directly.

/** Opens a small dynamically-built modal for editing one entry test's subject list. */
function openEditTestSubjects(tid) {
  const test = ENTRY_TESTS.find(t => t.id === tid);
  if (!test) return;
  window._editingTestId = tid;
  window._editTestSubjects = [...(test.subjects || [])];

  let modal = document.getElementById('edit-test-subjects-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'edit-test-subjects-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.35);display:flex;align-items:center;justify-content:center;z-index:1000;backdrop-filter:blur(3px)';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="background:var(--white);border-radius:var(--radius-xl);padding:1.75rem;width:100%;max-width:420px;box-shadow:var(--shadow-lg);border:1px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem">
        <h3 style="font-size:1rem;font-weight:600">${esc(test.name)} - Subjects</h3>
        <button onclick="closeEditTestSubjects()" style="background:none;border:none;font-size:1.25rem;cursor:pointer;color:var(--text-light)">&#215;</button>
      </div>
      <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem">
        <select class="form-control" id="edit-test-subject-inp" style="flex:1">
          <option value="">- Choose subject -</option>
          ${subjectNames().map(n => `<option value="${escAttr(n)}">${esc(n)}</option>`).join('')}
        </select>
        <button class="btn btn-outline btn-sm" onclick="addSubjectToEditTest()">Add</button>
      </div>
      <div id="edit-test-subjects-list" style="display:flex;flex-wrap:wrap;gap:6px;min-height:36px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:1rem"></div>
      <span class="field-hint" style="display:block;margin-bottom:1rem">Removing a subject that still has courses under it will be refused - the courses would vanish for everyone.</span>
      <div style="display:flex;gap:0.65rem;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" onclick="closeEditTestSubjects()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="saveEditTestSubjects()">Save</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
  renderEditTestSubjectTags();
}

function addSubjectToEditTest() {
  const sel = document.getElementById('edit-test-subject-inp');
  if (!sel || !sel.value) return;
  const sub = sel.value;
  if (!window._editTestSubjects.includes(sub)) {
    window._editTestSubjects.push(sub);
    renderEditTestSubjectTags();
  }
  sel.value = '';
}

function removeEditTestSubject(sub) {
  window._editTestSubjects = window._editTestSubjects.filter(s => s !== sub);
  renderEditTestSubjectTags();
}
function renderEditTestSubjectTags() {
  const el = document.getElementById('edit-test-subjects-list');
  if (!el) return;
  if (!window._editTestSubjects.length) {
    el.innerHTML = '<span style="font-size:0.72rem;color:var(--text-light)">No subjects - this test cannot hold any courses.</span>';
    return;
  }
  el.innerHTML = window._editTestSubjects.map(s => `
    <span style="display:inline-flex;align-items:center;gap:4px;background:var(--blue-pale);color:var(--navy);font-size:0.72rem;padding:2px 8px;border-radius:20px;font-weight:500">
      ${esc(s)}
      <button onclick="removeEditTestSubject('${escAttr(s)}')" style="background:none;border:none;cursor:pointer;color:var(--text-light);font-size:0.8rem;line-height:1;padding:0">&#215;</button>
    </span>`).join('');
}

async function saveEditTestSubjects() {
  const test = ENTRY_TESTS.find(t => t.id === window._editingTestId);
  if (!test) { closeEditTestSubjects(); return; }
  try {
    const updated = await apiFetchDetailed(`/tests/${test.id}/subjects`, {
      method: 'PUT', body: JSON.stringify({ subjects: [...window._editTestSubjects] }),
    });
    const idx = ENTRY_TESTS.findIndex(t => t.id === test.id);
    if (idx !== -1) ENTRY_TESTS[idx] = updated.entryTest || updated;
    renderTestTags();
    closeEditTestSubjects();
    showToast('Subjects updated.');
  } catch (err) {
    showToast(err.message);
  }
}

function closeEditTestSubjects() {
  const modal = document.getElementById('edit-test-subjects-modal');
  if (modal) modal.style.display = 'none';
}

/**
 * Renders the tag-list summary, the entry-tests table, AND fills the
 * "Subjects Taught" dropdown in the add form.
 *
 * That last part is not incidental: the dropdown in tests.html ships with only
 * a placeholder option, so before this it was permanently empty, meaning
 * addSubjectToNewTest() had nothing to add and "Add Entry Test" was rejected
 * every single time for having no subjects.
 */
function renderTestTags() {
  const el = document.getElementById('test-tag-list');
  if (!el) return;

  el.innerHTML = ENTRY_TESTS.length
    ? ENTRY_TESTS.map(t => `
      <div class="tag-item" id="tag-${escAttr(t.id)}">
        <span style="width:7px;height:7px;border-radius:50%;background:${escAttr(t.color || '#1B5FAD')};flex-shrink:0"></span>
        ${esc(t.name)}
        <button onclick="removeTest('${escAttr(t.id)}')" title="Remove">&#215;</button>
      </div>`).join('')
    : '<span style="font-size:0.78rem;color:var(--text-light)">No entry tests yet.</span>';

  // Fill the add-form subject picker from the live subject list.
  const subjSel = document.getElementById('new-test-subject-inp');
  if (subjSel) {
    const names = subjectNames();
    subjSel.innerHTML = names.length
      ? '<option value="">- Choose subject -</option>' +
        names.map(n => `<option value="${escAttr(n)}">${esc(n)}</option>`).join('')
      : '<option value="">No subjects yet - add one above first</option>';
    renderNewTestSubjectTags();
  }

  const tbody = document.getElementById('tests-tbody');
  if (tbody) {
    tbody.innerHTML = ENTRY_TESTS.length
      ? ENTRY_TESTS.map((t, i) => {
          const color = t.color || '#1B5FAD';
          const subs  = t.subjects || [];
          return `<tr>
        <td style="font-family:var(--font-mono)">${i + 1}</td>
        <td><strong>${esc(t.name)}</strong><div style="font-size:0.7rem;color:var(--text-light)">${esc(t.desc || '')}</div></td>
        <td>
          <div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center">
            ${subs.length
              ? subs.map(s => `<span class="badge badge-blue" style="font-size:0.65rem">${esc(s)}</span>`).join('')
              : '<span class="badge badge-red" style="font-size:0.65rem">none - no course can use this test</span>'}
            <button onclick="openEditTestSubjects('${escAttr(t.id)}')" style="background:none;border:1px dashed var(--border);border-radius:3px;font-size:0.65rem;padding:1px 6px;cursor:pointer;color:var(--text-light)">edit</button>
          </div>
        </td>
        <td><span class="badge" style="background:${escAttr(color)}22;color:${escAttr(color)}">${esc(t.name)}</span></td>
        <td><button class="btn btn-danger btn-sm" onclick="removeTest('${escAttr(t.id)}')">Remove</button></td>
      </tr>`;
        }).join('')
      : '<tr><td colspan="5" style="text-align:center;padding:1.25rem;color:var(--text-light)">No entry tests yet.</td></tr>';
  }
}


async function addTest() {
  const nameEl = document.getElementById('new-test-name');
  const descEl = document.getElementById('new-test-desc');
  const btn    = document.getElementById('add-test-btn');
  if (!nameEl) return;

  clearFieldErrors('add-test-card');
  if (!nameEl.value.trim()) { setFieldError('new-test-name', 'Enter a program name.'); return; }
  if (!window._newTestSubjects || !window._newTestSubjects.length) {
    setFieldError('new-test-subject-inp', 'Pick at least one subject - a test with no subjects can hold no courses.');
    return;
  }

  // No `color` here on purpose. This used to send a client-picked colour from a
  // local palette indexed by ENTRY_TESTS.length, which (a) collided as soon as
  // one test was deleted and re-added, and (b) was thrown away regardless -
  // routes/tests.js only accepts name, desc and subjects, and assigns the colour
  // itself. Sending it just made the client look like it was in control.
  const payload = {
    name: nameEl.value.trim().toUpperCase(),
    desc: descEl?.value.trim() || 'Entry test preparation program',
    subjects: [...window._newTestSubjects],
  };

  if (btn) btn.disabled = true;
  try {
    const created = await apiFetchDetailed('/tests', { method: 'POST', body: JSON.stringify(payload) });
    ENTRY_TESTS.push(created);
    nameEl.value = '';
    if (descEl) descEl.value = '';
    window._newTestSubjects = [];
    renderNewTestSubjectTags();
    renderTestTags();
    showToast('Entry test "' + created.name + '" added.');
  } catch (err) {
    const orphans = applyFieldErrors(err.fieldErrors, 'new-test', 'add-test-card');
    if (!err.fieldErrors || orphans.length) showToast(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}



async function removeTest(id) {
  const test = ENTRY_TESTS.find(t => t.id === id);
  const label = test ? `"${test.name}"` : 'this entry test';

  // Batches point at an entry test by name, and students inherit it from the
  // batch. Deleting the test underneath them leaves both dangling, so say so
  // before asking.
  const usedBy = BATCHES.filter(b => test && b.entryTest === test.name).map(b => b.name);
  const warn = usedBy.length
    ? `\n\n${usedBy.length} batch(es) still use it: ${usedBy.join(', ')}.`
    : '';

  if (!confirm(`Remove ${label}?${warn}`)) return;
  try {
    await apiFetchDetailed(`/tests/${id}`, { method: 'DELETE' });
    ENTRY_TESTS = ENTRY_TESTS.filter(t => t.id !== id);
    renderTestTags();
    if (document.getElementById('admin-subjects-tbody')) renderAdminSubjects();
    showToast('Test removed.');
  } catch (err) {
    showToast(err.message);
  }
}

// ──────────────────────────────────────────────────
// 21. LOGIN
// ──────────────────────────────────────────────────
//
// setupLogin() used to live here. It was dead code - it looked for
// `#login-form` and `#login-error`, neither of which exists in any HTML file in
// this project (login.html uses a plain div layout with a button calling
// doLogin(), plus `#login-err`). So it bailed on its own second line, every
// time, on every page.
//
// The live login implementation is the inline doLogin() at the bottom of
// public/login.html. There is deliberately only one now: having two made it
// possible to "fix" the login in the copy that never runs. If you're looking for
// the login logic, it is in login.html.

// ──────────────────────────────────────────────────
// 22. TOAST NOTIFICATIONS (bottom-right confirmation messages)
// ──────────────────────────────────────────────────
function showToast(msg) {
  const existing = document.getElementById('mr-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'mr-toast';
  t.style.cssText = 'position:fixed;bottom:20px;right:20px;background:var(--navy);color:#fff;padding:.65rem 1.1rem;border-radius:var(--radius);box-shadow:var(--shadow-lg);font-size:.82rem;z-index:9999;max-width:300px;font-family:var(--font-body);border:1px solid rgba(255,255,255,0.08)';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.style.opacity = '0', 2700);
  setTimeout(() => t.remove(), 3000);
}

/** Renders the "one teacher per subject" dropdown rows inside the admin batch modal, based on the selected entry test's subject list. */
function renderBatchTeacherSlots() {
  const slots = document.getElementById('abm-teacher-slots');
  if (!slots) return;

  const test     = ENTRY_TESTS.find(t => t.id === fv('abm-entry-test'));
  const subjects = (test && test.subjects) || [];
  const editing  = BATCHES.find(b => b.id === fv('abm-id'));

  if (!subjects.length) {
    slots.innerHTML = '<div style="padding:0.75rem;font-size:0.78rem;color:var(--text-light)">No subjects defined for this entry test. Add subjects in Entry Tests first.</div>';
    return;
  }

  slots.innerHTML = subjects.map((sub, i) => {
    const current = editing && editing.subjectTeachers ? editing.subjectTeachers[sub] : '';
    const teachers = TEACHERS_DB.filter(t => (t.subjects || []).includes(sub) && (t.status === 'active' || t.id === current));
    return `
      <div style="display:grid;grid-template-columns:120px 1fr;align-items:center;gap:0.75rem;padding:0.6rem 0.85rem;${i > 0 ? 'border-top:1px solid var(--border);' : ''}background:var(--white)">
        <div style="font-size:0.82rem;font-weight:600;color:var(--text-dark)">${esc(sub)}</div>
        <select class="form-control" id="slot-${esc(sub.replace(/\s+/g, '_'))}" style="height:34px;font-size:0.82rem">
          <option value="">- Select teacher -</option>
          ${teachers.map(t => `<option value="${esc(t.id)}">${esc(t.name)}${t.status === 'active' ? '' : ' (inactive)'}</option>`).join('')}
        </select>
      </div>`;
  }).join('');
}

// ──────────────────────────────────────────────────
// RETIRED: ADMIN SPA ROUTER
//
// A ~330-line `const ADMIN_ROUTES = {...}` object used to live here, plus
// navigateTo() and initAdminSPA() further down. The Admin area was once a
// single HTML shell (`<div id="page-content">`) that swapped its innerHTML
// based on location.hash. It has been a real multi-page app for a while now:
// Admin/dashboard.html, students.html, teachers.html, courses.html,
// batches.html and tests.html are actual files, and the page router in §16
// finds each one by its element id.
//
// It was deleted rather than left in place because it was actively harmful:
//
//  1. It was the last place in the whole project where a user could type a
//     subject name as free text - `<input type="text" id="new-test-subject-inp"
//     placeholder="e.g. Biology">`. Its own render hook tried to fix that by
//     assigning `.innerHTML` to that element, which does nothing at all on an
//     <input>. So arbitrary strings could reach EntryTest.subjects, and since
//     every subject comparison in this codebase is case-sensitive, "biology"
//     would silently match nothing.
//
//  2. It was the source of several phantom element ids that app.js still read
//     but no live page contained - `asm-password`, `atm-subjects-list` - which
//     is why the Add Student and Save Teacher buttons threw a TypeError and
//     failed 100% of the time. Those ids now exist in the real .html files.
//
//  3. It was still reachable. `initAdminSPA()` fired on any page containing
//     `id="page-content"`, and Student/index.html - a stale copy of the old
//     admin shell - still had it, so admin templates were being injected into
//     the student shell.
//
// If you need to add an admin screen, create a real .html file modelled on
// Admin/courses.html, give it a unique container id, and add one line to the
// router in §16. Do not reintroduce a hash-routed shell.
// ──────────────────────────────────────────────────

// The old renderTeacherSubjectCheckboxes() lived here. It has been replaced by
// the generic renderSubjectCheckboxes(containerId, selected, cssClass) in the
// shared-helpers section near the top of this file, which the batch form uses
// too - one implementation instead of two that could drift. It also read the id
// `atm-subjects-list`, which existed in no live HTML file, so Save Teacher threw
// a TypeError and failed on every attempt.


/**
 * A batch already belongs to an entry test, so once a batch is chosen the entry
 * test is decided - leaving it editable let an admin file a student under MDCAT
 * while their batch prepared for ECAT, and nothing downstream reconciled the
 * two.
 *
 * The element id is `asm-entryTest` (matching the STUDENT_RULES key), not
 * `asm-entry-test`; the old name meant this function silently found nothing and
 * the two fields could drift apart unchecked.
 */
function syncEntryTestFromBatch() {
  const bSel  = document.getElementById('asm-batch');
  const etSel = document.getElementById('asm-entryTest');
  if (!bSel || !etSel) return;
  const batch = BATCHES.find(b => b.name === bSel.value);
  etSel.value = batch && [...etSel.options].some(o => o.value === batch.entryTest) ? batch.entryTest : '';
  etSel.disabled = true;
}


// ── Batch CRUD (one teacher per subject, via `subjectTeachers`) ────────────

/** Renders the admin Batches stat row + card grid. */
function renderAdminBatches() {
  const statsEl = document.getElementById('batch-stats-row');
  if (statsEl) {
    const active   = BATCHES.filter(b => b.status === 'active').length;
    const upcoming = BATCHES.filter(b => b.status === 'upcoming').length;
    const totalS   = [...new Set(BATCHES.flatMap(b => b.studentIds || []))].length;
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-icon si-blue" style="font-family:var(--font-mono);font-weight:700">B</div><div class="stat-info"><div class="sv">${BATCHES.length}</div><div class="sl">Total Batches</div></div></div>
      <div class="stat-card"><div class="stat-icon si-green" style="font-family:var(--font-mono);font-weight:700">A</div><div class="stat-info"><div class="sv">${active}</div><div class="sl">Active</div></div></div>
      <div class="stat-card"><div class="stat-icon si-orange" style="font-family:var(--font-mono);font-weight:700">U</div><div class="stat-info"><div class="sv">${upcoming}</div><div class="sl">Upcoming</div></div></div>
      <div class="stat-card"><div class="stat-icon si-navy" style="font-family:var(--font-mono);font-weight:700">S</div><div class="stat-info"><div class="sv">${totalS}</div><div class="sl">Enrolled Students</div></div></div>`;
  }

  const grid = document.getElementById('admin-batches-grid');
  if (!grid) return;
  if (!BATCHES.length) {
    grid.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-light);font-size:0.85rem;border:1px dashed var(--border);border-radius:var(--radius-lg)">No batches yet.</div>';
    return;
  }

  grid.innerHTML = BATCHES.map(b => {
    const test = ENTRY_TESTS.find(t => t.id === b.entryTestId) || ENTRY_TESTS.find(t => t.name === b.entryTest);
    const testColor = (test && test.color) || '#1B5FAD';
    const subjects = (test && test.subjects) || [];
    const students = STUDENTS_DB.filter(s => (b.studentIds || []).includes(s.id));
    const courseCount = Object.values(COURSES).filter(c => c.batchId === b.id).length;

    const staffRows = subjects.map(sub => {
      const tid = b.subjectTeachers && b.subjectTeachers[sub];
      const t = tid ? teacherFromRef(tid) : null;
      return `<div style="font-size:0.8rem;display:flex;justify-content:space-between;gap:8px;margin-bottom:3px">
        <span style="color:var(--text-mid)">${esc(sub)}</span>
        ${t ? `<span style="font-weight:500">${esc(t.name)}</span>` : '<span style="color:var(--danger);font-size:0.72rem">no teacher</span>'}
      </div>`;
    }).join('') || '<div style="font-size:0.78rem;color:var(--text-light)">This entry test has no subjects.</div>';

    return `
      <div class="card" style="border-top:3px solid ${escAttr(testColor)}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:0.85rem">
          <div>
            <div style="font-size:0.95rem;font-weight:600;color:var(--text-dark);margin-bottom:3px">${esc(b.name)}</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap">
              <span class="badge" style="background:${escAttr(testColor)}22;color:${escAttr(testColor)}">${esc(b.entryTest)}</span>
              <span class="badge ${b.status === 'active' ? 'badge-green' : b.status === 'completed' ? 'badge-navy' : 'badge-orange'}">${esc(b.status)}</span>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="openAdminBatchModal('${escAttr(b.id)}')">Edit</button>
        </div>
        <div style="margin-bottom:0.85rem">
          <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-light);margin-bottom:0.35rem">Subjects &amp; teachers</div>
          ${staffRows}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:1rem">
          <div style="font-size:0.78rem;color:var(--text-mid)">Start Date</div>
          <div style="font-size:0.78rem;font-family:var(--font-mono)">${esc(fmtDate(b.startDate))}</div>
          <div style="font-size:0.78rem;color:var(--text-mid)">Students</div>
          <div style="font-size:0.78rem;font-family:var(--font-mono);font-weight:600">${students.length}</div>
          <div style="font-size:0.78rem;color:var(--text-mid)">Courses created</div>
          <div style="font-size:0.78rem;font-family:var(--font-mono);font-weight:600">${courseCount} of ${subjects.length}</div>
        </div>
        ${students.length ? `
        <div style="border-top:1px solid var(--border);padding-top:0.75rem">
          <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-light);margin-bottom:0.4rem">Enrolled</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            ${students.slice(0, 4).map(s => `<span class="badge badge-blue" style="font-size:0.65rem">${esc(firstName(s.name))}</span>`).join('')}
            ${students.length > 4 ? `<span class="badge badge-navy">+${students.length - 4}</span>` : ''}
          </div>
        </div>` : '<div style="border-top:1px solid var(--border);padding-top:0.75rem;font-size:0.78rem;color:var(--text-light)">No students enrolled yet.</div>'}
      </div>`;
  }).join('');
}

/** Opens the admin Add/Edit Batch modal, restoring saved subject-teacher assignments and student checkboxes if editing. */
function openAdminBatchModal(bid) {
  const modal = document.getElementById('admin-batch-modal');
  if (!modal) return;

  // Build the static parts that a page-specific inline script used to build
  const etSel = document.getElementById('abm-entry-test');
  if (etSel) etSel.innerHTML = ENTRY_TESTS.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  const sList = document.getElementById('abm-student-list');
  if (sList) {
    const editingBatch = bid ? BATCHES.find(x => x.id === bid) : null;
    const available = STUDENTS_DB.filter(s => {
      const inOtherRoster   = BATCHES.some(b => b.id !== bid && (b.studentIds || []).includes(s.id));
      const labelledElsewhere = s.batch && (!editingBatch || s.batch !== editingBatch.name);
      return !inOtherRoster && !labelledElsewhere;
    });
    sList.innerHTML = available.length
      ? available.map(s => `
          <div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0.5rem;border-radius:4px">
            <input type="checkbox" id="scb-${esc(s.id)}" value="${esc(s.id)}">
            <label for="scb-${esc(s.id)}" style="cursor:pointer;font-size:0.82rem;flex:1">
              <strong>${esc(s.name)}</strong>
              <span style="color:var(--text-light);font-family:var(--font-mono);font-size:0.7rem;margin-left:6px">${esc(s.rollNo)}</span>
            </label>
          </div>`).join('')
      : '<div style="color:var(--text-light);font-size:0.78rem;padding:0.5rem">No unassigned students available.</div>';
  }

  const titleEl = document.getElementById('abm-modal-title');
  const delBtn  = document.getElementById('abm-delete-btn');
  let currentSubjectTeachers = {};
  let currentStudentIds = [];

  if (bid) {
    const b = BATCHES.find(x => x.id === bid);
    if (!b) return;
    currentSubjectTeachers = b.subjectTeachers || {};
    currentStudentIds = b.studentIds || [];
    titleEl.textContent = 'Edit Batch';
    delBtn.style.display = 'inline-flex';
    document.getElementById('abm-id').value         = b.id;
    document.getElementById('abm-name').value       = b.name;
    document.getElementById('abm-entry-test').value = b.entryTestId || '';
    document.getElementById('abm-start').value      = b.startDate;
    document.getElementById('abm-status').value     = b.status;
  } else {
    titleEl.textContent = 'Create Batch';
    delBtn.style.display = 'none';
    document.getElementById('abm-id').value    = '';
    document.getElementById('abm-name').value  = '';
    document.getElementById('abm-start').value = '';
    document.getElementById('abm-status').value = 'upcoming';
  }

  renderBatchTeacherSlots();

  Object.entries(currentSubjectTeachers).forEach(([sub, tid]) => {
    const sel = document.getElementById('slot-' + sub.replace(/\s+/g, '_'));
    if (sel) sel.value = tid;
  });

  document.querySelectorAll('#abm-student-list input[type=checkbox]').forEach(cb => {
    cb.checked = currentStudentIds.includes(cb.value);
  });

  modal.style.display = 'flex';
}

function closeAdminBatchModal() {
  const modal = document.getElementById('admin-batch-modal');
  if (modal) modal.style.display = 'none';
}






// ── Admin: Dashboard ──────────────────────────────────────────────────────
// Backs public/Admin/dashboard.html (router trigger: #admin-overview).
//
// This function previously existed ONLY inside dashboard.html's inline
// <script> block. When that block was commented out to fix the inline-script
// shadowing bug, the definition disappeared with it - but the router in §16
// still calls renderAdminDashboard(), so the page threw a ReferenceError and
// rendered nothing. This is the real, backend-driven replacement: it reads the
// globals loadAppData() populates instead of localStorage.

function mkStatCard(iconClass, letter, value, label) {
  return `<div class="stat-card">
      <div class="stat-icon ${iconClass}" style="font-family:var(--font-mono);font-weight:700">${letter}</div>
      <div class="stat-info"><div class="sv">${value}</div><div class="sl">${label}</div></div>
    </div>`;
}

function renderAdminDashboard() {
  const students = STUDENTS_DB || [];
  const teachers = TEACHERS_DB || [];
  const batches  = BATCHES || [];
  const courses  = Object.values(COURSES);

  const overviewEl = document.getElementById('admin-overview');
  if (overviewEl) {
    const activeBatches = batches.filter(b => b.status === 'active').length;
    const unpaidFees    = students.filter(s => s.feeStatus !== 'Paid').length;
    const pendingGrades = students.flatMap(s =>
      (s.assignments || []).filter(a => a.submitted && !a.approved)
    ).length;

    overviewEl.innerHTML =
      mkStatCard('si-blue',   'S', students.length,     'Total Students') +
      mkStatCard('si-navy',   'T', teachers.length,     'Teachers') +
      mkStatCard('si-green',  'B', activeBatches,       'Active Batches') +
      mkStatCard('si-blue',   'C', courses.length,      'Courses') +
      mkStatCard('si-red',    'F', unpaidFees,          'Fee Pending') +
      mkStatCard('si-orange', 'G', pendingGrades,       'Pending Grading');
  }

  const rsEl = document.getElementById('admin-recent-students');
  if (rsEl) {
    if (!students.length) {
      rsEl.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-light);padding:1rem;font-size:0.82rem">No students yet.</td></tr>';
    } else {
      rsEl.innerHTML = students.slice(0, 5).map(s => {
        const feeClass = feeBadgeClass(s.feeStatus);
        return `<tr>
            <td><strong>${esc(s.name)}</strong><div style="font-size:0.7rem;color:var(--text-light);font-family:var(--font-mono)">${esc(s.email)}</div></td>
            <td style="font-family:var(--font-mono);font-size:0.76rem">${esc(s.rollNo)}</td>
            <td>${esc(s.batch) || '-'}</td>
            <td><span class="badge ${feeClass}">${s.feeStatus}</span></td>
          </tr>`;
      }).join('');
    }
  }

  const bsEl = document.getElementById('admin-batch-summary');
  if (bsEl) {
    if (!batches.length) {
      bsEl.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-light);padding:1rem;font-size:0.82rem">No batches yet - create one from the Batches page.</td></tr>';
    } else {
      bsEl.innerHTML = batches.map(b => {
        const statusClass = b.status === 'active' ? 'badge-green' : 'badge-orange';
        return `<tr>
            <td><strong>${esc(b.name)}</strong></td>
            <td><span class="badge badge-blue" style="font-family:var(--font-mono)">${esc(b.entryTest)}</span></td>
            <td style="font-family:var(--font-mono)">${(b.studentIds || []).length}</td>
            <td><span class="badge ${statusClass}">${b.status}</span></td>
          </tr>`;
      }).join('');
    }
  }
}

// ── Admin: Courses ────────────────────────────────────────────────────────
// Backs public/Admin/courses.html. A Course is the "shell" (title, subject,
// teacher, styling); the assigned teacher fills in weeks/topics from their
// own Courses page via openCourseEditor().
//
// Why the subject string matters so much: batch auto-enrollment (see
// routes/batches.js) finds courses by matching Course.subject against the
// batch's EntryTest.subjects list. A course whose subject isn't required by
// any entry test will never auto-enroll a single student, so we surface that
// as a visible warning on the card rather than letting it fail silently.

const COURSE_COLOR_TINTS = {
  '#1B5FAD': '#EBF2FB',
  '#0E8A5F': '#E7F5EF',
  '#C47C08': '#FCF3E3',
  '#7c3aed': '#F1EAFE',
  '#C0392B': '#FBEDEB',
};

/** True if any entry test requires this subject - i.e. auto-enrollment can reach it. */
function subjectIsRequiredByAnyTest(subject) {
  return ENTRY_TESTS.some(t => (t.subjects || []).includes(subject));
}

function countCourseTopics(c) {
  return (c.weeks || []).reduce((n, w) => n + (w.topics || []).length, 0);
}

function renderAdminCourses() {
  const grid = document.getElementById('admin-courses-grid');
  if (!grid) return;

  const courses = Object.values(COURSES).sort((a, b) => a.id - b.id);

  const statsEl = document.getElementById('course-stats-row');
  if (statsEl) {
    const topics    = courses.reduce((n, c) => n + countCourseTopics(c), 0);
    const noContent = courses.filter(c => countCourseTopics(c) === 0).length;
    const noTeacher = courses.filter(c => !c.teacher).length;
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-icon si-blue" style="font-family:var(--font-mono);font-weight:700">C</div><div class="stat-info"><div class="sv">${courses.length}</div><div class="sl">Total Courses</div></div></div>
      <div class="stat-card"><div class="stat-icon si-green" style="font-family:var(--font-mono);font-weight:700">T</div><div class="stat-info"><div class="sv">${topics}</div><div class="sl">Topics Published</div></div></div>
      <div class="stat-card"><div class="stat-icon si-orange" style="font-family:var(--font-mono);font-weight:700">E</div><div class="stat-info"><div class="sv">${noContent}</div><div class="sl">Awaiting Curriculum</div></div></div>
      <div class="stat-card"><div class="stat-icon si-red" style="font-family:var(--font-mono);font-weight:700">!</div><div class="stat-info"><div class="sv">${noTeacher}</div><div class="sl">No Teacher</div></div></div>`;
  }

  if (!courses.length) {
    grid.innerHTML = `
      <div style="grid-column:1/-1;text-align:center;padding:2.5rem 1.5rem;background:var(--white);
                  border:1px dashed var(--border);border-radius:var(--radius-xl)">
        <div style="font-size:0.95rem;font-weight:600;color:var(--text-dark);margin-bottom:0.5rem">No courses yet</div>
        <p style="font-size:0.82rem;color:var(--text-mid);max-width:460px;margin:0 auto 1rem;line-height:1.6">
          Click <strong>Add Course</strong>, pick a batch, then one of its subjects. The teacher is
          assigned automatically from the batch, and the batch's students are enrolled straight away.
        </p>
        <button class="btn btn-primary btn-sm" onclick="openAdminCourseModal(null)">Add Course</button>
      </div>`;
    return;
  }

  grid.innerHTML = courses.map(c => {
    const topics   = countCourseTopics(c);
    const weeks    = (c.weeks || []).length;
    const enrolled = (STUDENTS_DB || []).filter(s => (s.enrolledCourseIds || []).includes(c.id)).length;
    const batch    = BATCHES.find(b => b.id === c.batchId);
    const teacherName = c.teacher ? esc(teacherLabel(c.teacher)) : '<em>no teacher assigned</em>';

    return `
      <div class="card">
        <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem">
          <div style="width:36px;height:36px;border-radius:var(--radius);background:${escAttr(c.colorLight || '#EBF2FB')};
                      color:${escAttr(c.color || '#1B5FAD')};display:flex;align-items:center;justify-content:center;
                      font-family:var(--font-mono);font-weight:700;flex-shrink:0">${esc(c.icon || '?')}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;color:var(--text-dark)">${esc(c.title)}</div>
            <div style="font-size:0.72rem;color:var(--text-light)">
              ${esc(batch ? batch.name : 'Unknown batch')} &middot; ${esc(c.subject)} &middot; ${teacherName}
            </div>
          </div>
          <span class="badge badge-blue">${enrolled} student${enrolled === 1 ? '' : 's'}</span>
        </div>

        <p style="font-size:0.8rem;color:var(--text-mid);margin-bottom:0.75rem">
          ${c.description ? esc(c.description) : '<em style="color:var(--text-light)">No description.</em>'}
        </p>

        <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem">
          <div style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:0.5rem;text-align:center">
            <div style="font-size:1rem;font-weight:700;font-family:var(--font-mono)">${weeks}</div>
            <div style="font-size:0.62rem;color:var(--text-light);text-transform:uppercase">Weeks</div>
          </div>
          <div style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:0.5rem;text-align:center">
            <div style="font-size:1rem;font-weight:700;font-family:var(--font-mono)">${topics}</div>
            <div style="font-size:0.62rem;color:var(--text-light);text-transform:uppercase">Topics</div>
          </div>
        </div>

        ${c.teacher ? '' : `
          <div style="font-size:0.72rem;color:#C0392B;background:#FBEDEB;border-radius:var(--radius);
                      padding:0.45rem 0.6rem;margin-bottom:0.75rem;line-height:1.5">
            No teacher is assigned to <strong>${esc(c.subject)}</strong> in this batch. Assign one on the Batches page.
          </div>`}

        ${topics ? '' : `
          <div style="font-size:0.72rem;color:var(--text-mid);background:var(--bg);border-radius:var(--radius);
                      padding:0.45rem 0.6rem;margin-bottom:0.75rem;line-height:1.5">
            Curriculum is empty. ${c.teacher ? esc(teacherLabel(c.teacher)) : 'The assigned teacher'} needs to add weeks and topics.
          </div>`}

        <div style="display:flex;gap:6px">
          <button class="btn btn-outline btn-sm" onclick="openAdminCourseModal(${Number(c.id)})">Edit</button>
          <button class="btn btn-ghost btn-sm" onclick="deleteAdminCourse(${Number(c.id)})">Delete</button>
        </div>
      </div>`;
  }).join('');
}

/** Subjects of a batch's entry test, flagged by whether they can take a new course. */
function courseSubjectChoices(batchId) {
  const batch = BATCHES.find(b => b.id === batchId);
  if (!batch) return [];
  const test = ENTRY_TESTS.find(t => t.id === batch.entryTestId);
  const taken = new Set(Object.values(COURSES).filter(c => c.batchId === batchId).map(c => c.subject));
  const staff = batch.subjectTeachers || {};
  return ((test && test.subjects) || []).map(name => ({
    name, teacherId: staff[name] || '', hasCourse: taken.has(name),
  }));
}

function refreshCourseTeacherDisplay() {
  const out = document.getElementById('acm2-teacher-display');
  if (!out) return;
  const batch = BATCHES.find(b => b.id === fv('acm2-batch'));
  const subject = fv('acm2-subject');
  if (!batch || !subject) { out.value = ''; return; }
  const tid = (batch.subjectTeachers || {})[subject];
  const t = tid ? teacherFromRef(tid) : null;
  out.value = t ? t.name : 'No teacher assigned in this batch';
}

function onCourseBatchChange() {
  const batchId = fv('acm2-batch');
  const sel  = document.getElementById('acm2-subject');
  const hint = document.getElementById('acm2-subject-hint');
  if (!batchId) {
    sel.innerHTML = '<option value="">- Pick a batch first -</option>';
    sel.disabled = true; hint.textContent = '';
    refreshCourseTeacherDisplay();
    return;
  }
  const choices = courseSubjectChoices(batchId);
  sel.disabled = false;
  sel.innerHTML = '<option value="">- Select subject -</option>' + choices.map(c => {
    const note = c.hasCourse ? ' - course already exists' : (!c.teacherId ? ' - no teacher assigned in this batch' : '');
    return `<option value="${escAttr(c.name)}" ${c.hasCourse || !c.teacherId ? 'disabled' : ''}>${esc(c.name + note)}</option>`;
  }).join('');
  const usable = choices.filter(c => !c.hasCourse && c.teacherId);
  hint.textContent = usable.length ? ''
    : choices.length ? 'Nothing left to create: every subject here already has a course or has no teacher yet (assign teachers on the Batches page).'
    : "This batch's entry test has no subjects.";
  if (usable.length === 1) sel.value = usable[0].name;
  refreshCourseTeacherDisplay();
}



/**
 * Opens the course modal. Pass a course id to edit, or null/undefined to create.
 * Populates the subject + teacher dropdowns here rather than in the HTML, because
 * this is a static page - SUBJECTS_DB/TEACHERS_DB aren't loaded until
 * loadAppData() has run, long after the markup was parsed.
 */
function openAdminCourseModal(id = null) {
  const modal = document.getElementById('admin-course-modal');
  if (!modal) return;
  clearFieldErrors('admin-course-modal');

  const course = id != null ? COURSES[id] : null;
  const batchSel = document.getElementById('acm2-batch');
  const subjSel  = document.getElementById('acm2-subject');
  const hint     = document.getElementById('acm2-subject-hint');

  batchSel.innerHTML = BATCHES.length
    ? '<option value="">- Select batch -</option>' +
      BATCHES.map(b => `<option value="${escAttr(b.id)}">${esc(b.name)} (${esc(b.entryTest)})</option>`).join('')
    : '<option value="">- no batches yet: create one first -</option>';

  document.getElementById('acm2-modal-title').textContent = course ? 'Edit Course' : 'Add Course';
  document.getElementById('acm2-id').value    = course ? course.id : '';
  document.getElementById('acm2-title').value = course ? (course.title || '') : '';
  document.getElementById('acm2-icon').value  = course ? (course.icon || '') : '';
  document.getElementById('acm2-desc').value  = course ? (course.description || '') : '';
  document.getElementById('acm2-color').value = course ? (course.color || '#1B5FAD') : '#1B5FAD';

  if (course) {
    batchSel.value = course.batchId; batchSel.disabled = true;
    subjSel.innerHTML = `<option value="${escAttr(course.subject)}">${esc(course.subject)}</option>`;
    subjSel.value = course.subject; subjSel.disabled = true;
    hint.textContent = 'Batch and subject cannot be changed after creation.';
    refreshCourseTeacherDisplay();
  } else {
    batchSel.disabled = false; batchSel.value = '';
    hint.textContent = '';
    onCourseBatchChange();
  }

  const delBtn = document.getElementById('acm2-delete-btn');
  if (delBtn) delBtn.style.display = course ? 'inline-flex' : 'none';
  modal.style.display = 'flex';
}

function closeAdminCourseModal() {
  const modal = document.getElementById('admin-course-modal');
  if (modal) modal.style.display = 'none';
}

/** Creates (POST) or updates (PUT) a course depending on whether acm2-id is set. */
async function saveAdminCourse() {
  const editingId   = fv('acm2-id');
  const title       = fv('acm2-title').trim();
  const batchId     = fv('acm2-batch');
  const subject     = editingId ? ((COURSES[editingId] || {}).subject || '') : fv('acm2-subject');
  const description = fv('acm2-desc').trim();
  const color       = fv('acm2-color') || '#1B5FAD';
  const icon        = (fv('acm2-icon').trim() || subject.charAt(0)).toUpperCase();

  clearFieldErrors('admin-course-modal');
  if (!title) { setFieldError('acm2-title', 'Course title is required.'); return; }
  if (!editingId && !batchId) { setFieldError('acm2-batch', 'Pick a batch first.'); return; }
  if (!editingId && !subject) { setFieldError('acm2-subject', 'Pick a subject.'); return; }

  const payload = { title, icon, color, colorLight: COURSE_COLOR_TINTS[color] || '#EBF2FB', description };
  if (!editingId) { payload.batchId = batchId; payload.subject = subject; }

  const btn = document.getElementById('acm2-save-btn');
  if (btn) btn.disabled = true;
  try {
    const saved = editingId
      ? await apiFetchDetailed(`/courses/${editingId}`, { method: 'PUT',  body: JSON.stringify(payload) })
      : await apiFetchDetailed('/courses',              { method: 'POST', body: JSON.stringify(payload) });

    COURSES[saved.id] = saved;
    closeAdminCourseModal();
    renderAdminCourses();                       // appears immediately
    showToast(editingId ? 'Course updated.' : 'Course created.');

    await refreshCourseRelatedData();           // enrolment counts, teacher links
    renderAdminCourses();
  } catch (err) {
    const orphans = applyFieldErrors(err.fieldErrors, 'acm2', 'admin-course-modal');
    if (!err.fieldErrors || orphans.length) showToast(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** Delete button inside the edit modal. */
function deleteCurrentCourse() {
  const id = document.getElementById('acm2-id').value;
  if (id) deleteAdminCourse(Number(id));
}

async function deleteAdminCourse(id) {
  const course = COURSES[id];
  const enrolled = (STUDENTS_DB || []).filter(s => (s.enrolledCourseIds || []).includes(Number(id))).length;
  const warning = enrolled
    ? `\n\n${enrolled} student(s) are enrolled and will lose access to its content.`
    : '';
  if (!confirm(`Delete "${course ? course.title : 'this course'}"?${warning}`)) return;

  try {
    await apiFetch(`/courses/${id}?force=true`, { method: 'DELETE' });
    delete COURSES[id];
    closeAdminCourseModal();
    renderAdminCourses();
    showToast('Course removed.');
  } catch (err) {
    showToast(err.message);
  }
}

/** Reads the batch modal's fields (including the per-subject teacher dropdowns), then creates/updates the batch and syncs each selected student's `batch` field. */
// NEW
async function saveAdminBatch() {
  const id           = document.getElementById('abm-id').value;
  const name         = document.getElementById('abm-name').value.trim();
  const entryTestId  = document.getElementById('abm-entry-test').value;
  const startDate    = document.getElementById('abm-start').value;
  const status       = document.getElementById('abm-status').value;
  const studentIds   = [...document.querySelectorAll('#abm-student-list input[type=checkbox]:checked')].map(cb => cb.value);

  if (!name) { showToast('Batch name is required.'); return; }
  if (!startDate) { showToast('Pick the batch start date.'); return; }

  const test = ENTRY_TESTS.find(t => t.id === entryTestId);
  const subjects = test?.subjects || [];
  const subjectTeachers = {};
  subjects.forEach(sub => {
    const sel = document.getElementById('slot-' + sub.replace(/\s+/g, '_'));
    if (sel && sel.value) subjectTeachers[sub] = sel.value;
  });

  const entryTestName = test?.name || entryTestId;
  const payload = { name, entryTest: entryTestName, entryTestId, subjectTeachers, startDate, status, studentIds };

  try {
    let savedBatch;
    if (id) {
      savedBatch = await apiFetch(`/batches/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      const idx = BATCHES.findIndex(b => b.id === id);
      if (idx !== -1) BATCHES[idx] = savedBatch;
    } else {
      savedBatch = await apiFetch('/batches', { method: 'POST', body: JSON.stringify(payload) });
      BATCHES.push(savedBatch);
    }

    // Reflect the batch assignment locally (server already persisted this
    // on each student's record - this just keeps STUDENTS_DB in sync so
    // the students table doesn't need a full re-fetch).


    closeAdminBatchModal();

    await refreshCourseRelatedData();

    renderAdminBatches();
    showToast(id ? 'Batch updated.' : 'Batch created.');
  } catch (err) {
    showToast(err.message);
  }
}



async function deleteCurrentBatch() {
  const id = document.getElementById('abm-id').value;
  if (!id || !confirm('Delete this batch?')) return;
  try {
    try {
      await apiFetchDetailed(`/batches/${id}`, { method: 'DELETE' });
    } catch (err) {
      if (err.status !== 409) throw err;
      if (!confirm(`${err.message}\n\nDelete the batch and those courses anyway?`)) return;
      await apiFetchDetailed(`/batches/${id}?force=true`, { method: 'DELETE' });
    }
    closeAdminBatchModal();
    await refreshCourseRelatedData();
    renderAdminBatches();
    showToast('Batch deleted.');
  } catch (err) {
    showToast(err.message);
  }
}


// navigateTo() and initAdminSPA() used to live here. Both were part of the
// retired hash-routing Admin shell - see the "RETIRED: ADMIN SPA ROUTER" note
// where ADMIN_ROUTES used to be defined. Nothing calls them any more; the
// router in §16 no longer has an `if (document.getElementById('page-content'))`
// branch.

// Temp working list while building a new entry test in the "Add Entry Test" form.
window._newTestSubjects = [];
// Working copies for the edit-subjects modal. Declared here so they exist before
// any handler can read them - tests.html used to declare them in an inline
// <script>, which meant a second set of the same globals shadowing these.
window._editTestSubjects = [];
window._editingTestId    = null;

function addSubjectToNewTest() {
  const inp = document.getElementById('new-test-subject-inp');
  if (!inp || !inp.value.trim()) return;
  const sub = inp.value.trim();
  if (!window._newTestSubjects.includes(sub)) {
    window._newTestSubjects.push(sub);
    renderNewTestSubjectTags();
  }
  inp.value = '';
  // Clear any "pick at least one subject" error now that one is picked.
  inp.classList.remove('is-invalid');
  const holder = inp.parentElement;
  if (holder) holder.querySelectorAll('.field-error').forEach(el => el.remove());
}
function removeNewTestSubject(sub) {
  window._newTestSubjects = window._newTestSubjects.filter(s => s !== sub);
  renderNewTestSubjectTags();
}
function renderNewTestSubjectTags() {
  const el = document.getElementById('new-test-subjects-list');
  if (!el) return;
  if (!window._newTestSubjects.length) {
    el.innerHTML = '<span style="font-size:0.72rem;color:var(--text-light)">No subjects picked yet.</span>';
    return;
  }
  el.innerHTML = window._newTestSubjects.map(s => `
    <span style="display:inline-flex;align-items:center;gap:4px;background:var(--blue-pale);color:var(--navy);font-size:0.72rem;padding:2px 8px;border-radius:20px;font-weight:500">
      ${esc(s)}
      <button onclick="removeNewTestSubject('${escAttr(s)}')" style="background:none;border:none;cursor:pointer;color:var(--text-light);font-size:0.8rem;line-height:1;padding:0">&#215;</button>
    </span>`).join('');
}

// Pressing Enter in the "new subject" input adds it, instead of submitting anything.
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.id === 'new-test-subject-inp') {
    e.preventDefault();
    addSubjectToNewTest();
  }
});

// ══════════════════════════════════════════════════
//   23. AI STUDY ASSISTANT + AI-GENERATED QUIZ RE-ATTEMPTS
//    Calls the Anthropic API directly from the browser to generate
//    revision notes and fresh quiz questions for a student's weak topics.
// ══════════════════════════════════════════════════

const MAX_ATTEMPTS = 3;

// ── Attempt tracking (per student, per course) ──────────────────────────────
function getAttempts(studentId, courseId) {
  const s = getActiveStudent();
  return s ? (s.quizScores || []).filter(q => q.isAIRetry && q.courseId === courseId).length : 0;
}
function incrementAttempt(studentId, courseId) {
  const n = getAttempts(studentId, courseId) + 1;
  localStorage.setItem(`attempts_${studentId}_${courseId}`, n);
  return n;
}

// ── Weak-topic detection ─────────────────────────────────────────────────────

/** Topics in a course where the student scored below `threshold` (default 70%). Topics never attempted are skipped, not flagged. */
function getWeakTopics(student, courseId, threshold = 70) {
  const weak = [];
  allTopics(courseId).forEach(topic => {
    const quizScore = student.quizScores.find(q => q.topicId === topic.id);
    if (!quizScore) return;
    const pct = Math.round(quizScore.score / quizScore.total * 100);
    if (pct < threshold) {
      weak.push({ topicId: topic.id, title: topic.title, pct, score: quizScore.score, total: quizScore.total });
    }
  });
  return weak;
}

/** All topics in a course the student has attempted at least once, with their score %. */
function getAttemptedTopics(student, courseId) {
  const attempted = [];
  allTopics(courseId).forEach(topic => {
    const quizScore = student.quizScores.find(q => q.topicId === topic.id);
    if (quizScore) {
      attempted.push({ topicId: topic.id, title: topic.title, pct: Math.round(quizScore.score / quizScore.total * 100) });
    }
  });
  return attempted;
}

// // ── Anthropic API call ───────────────────────────────────────────────────────
// async function callClaude(systemPrompt, userMessage, maxTokens = 1000) {
//   const response = await fetch('https://api.anthropic.com/v1/messages', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({
//       model: 'claude-sonnet-4-20250514',
//       max_tokens: maxTokens,
//       system: systemPrompt,
//       messages: [{ role: 'user', content: userMessage }],
//     }),
//   });
//   if (!response.ok) throw new Error(`API error ${response.status}`);
//   const data = await response.json();
//   return data.content?.[0]?.text || '';
// }

/** Asks Claude for short bullet-point revision notes covering the student's weak topics. */
async function generateStudyNotes(course, topics) {
  const data = await apiFetch('/ai/study-notes', {
    method: 'POST',
    body: JSON.stringify({ courseId: course.id, topicIds: topics.map(t => t.topicId) }),
  });
  return data.notes;
}


async function generateQuizQuestions(course, topics) {
  const data = await apiFetch('/ai/generate-quiz', {
    method: 'POST',
    body: JSON.stringify({ courseId: course.id, topicIds: topics.map(t => t.topicId) }),
  });
  return data.questions;
}

// /** Asks Claude for a fresh set of MCQ questions targeting the student's weak topics. Returns a parsed array of { q, options, ans, topicTitle }. */
// async function generateQuizQuestions(course, weakTopics, numQuestions = 5) {
//   const topicList = weakTopics.map(t => t.title).join(', ');
//   const systemPrompt = `You are a quiz generator for ${esc(course.subject)} (${esc(course.title)}).
// Generate exactly ${numQuestions} multiple-choice questions targeting these weak topics: ${topicList}.
// CRITICAL: Respond with ONLY a valid JSON array. No preamble, no markdown, no explanation. Just the raw JSON array.
// Format:
// [
//   {
//     "q": "Question text here?",
//     "options": ["Option A", "Option B", "Option C", "Option D"],
//     "ans": 0,
//     "topicTitle": "Topic name"
//   }
// ]
// Rules:
// - ans is the 0-based index of the correct option
// - All 4 options must be plausible (no obviously wrong distractors)
// - Questions must be different from previous attempts
// - Focus on concepts the student got wrong`;

//   const userMessage = `Generate ${numQuestions} fresh MCQ questions for these weak topics: ${topicList}`;
//   const raw = await callClaude(systemPrompt, userMessage, 1200);

//   // The model is asked for raw JSON, but strip markdown fences just in case it adds them anyway.
//   const clean = raw.replace(/```json|```/g, '').trim();
//   const questions = JSON.parse(clean);
//   if (!Array.isArray(questions) || !questions.length) throw new Error('Invalid quiz format from AI');
//   return questions;
// }

/** Opens the main "AI Study Assistant" modal for a course: topic-score pills, weak-topic summary, and entry points into notes / quiz retry. */
function openAIStudyPanel(courseId) {
  const course   = COURSES[courseId];
  const student  = getActiveStudent();
  const attempts = getAttempts(student.id, courseId);
  const remaining = MAX_ATTEMPTS - attempts;

  const weakTopics      = getWeakTopics(student, courseId);
  const attemptedTopics = getAttemptedTopics(student, courseId);
  const allCourseTopics = allTopics(courseId);

  let modal = document.getElementById('ai-study-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'ai-study-modal';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.45);
      display:flex;align-items:center;justify-content:center;
      z-index:500;backdrop-filter:blur(4px);padding:1rem`;
    document.body.appendChild(modal);
  }

  const topicPillsHtml = allCourseTopics.map(t => {
    const attempted = attemptedTopics.find(a => a.topicId === t.id);
    if (!attempted) {
      return `<span style="font-size:0.72rem;padding:3px 9px;border-radius:20px;
        background:var(--border);color:var(--text-light)">${esc(t.title)}</span>`;
    }
    const isWeak = attempted.pct < 70;
    return `<span style="font-size:0.72rem;padding:3px 9px;border-radius:20px;
      background:${isWeak ? '#fecaca' : '#bbf7d0'};
      color:${isWeak ? '#991b1b' : '#166534'}">
      ${esc(t.title)} · ${attempted.pct}%
    </span>`;
  }).join('');

  const hasWeak = weakTopics.length > 0;

  modal.innerHTML = `
    <div style="background:var(--white);border-radius:var(--radius-xl);
                width:100%;max-width:600px;max-height:90vh;overflow-y:auto;
                box-shadow:var(--shadow-lg);border:1px solid var(--border)">

      <div style="padding:1.25rem 1.5rem;border-bottom:1px solid var(--border);
                  display:flex;align-items:flex-start;justify-content:space-between;
                  position:sticky;top:0;background:var(--white);z-index:10">
        <div>
          <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.09em;
                      color:var(--text-light);font-family:var(--font-mono);margin-bottom:2px">
            AI Study Assistant
          </div>
          <div style="font-size:1rem;font-weight:600;color:var(--text-dark)">${esc(course.title)}</div>
          <div style="font-size:0.75rem;color:var(--text-light);margin-top:2px">
            ${remaining > 0
              ? `${remaining} re-attempt${remaining !== 1 ? 's' : ''} remaining`
              : '<span style="color:var(--danger)">No re-attempts remaining</span>'}
          </div>
        </div>
        <button onclick="document.getElementById('ai-study-modal').style.display='none'"
          style="background:none;border:none;font-size:1.3rem;cursor:pointer;
                 color:var(--text-light);line-height:1;padding:4px">&#215;</button>
      </div>

      <div style="padding:1.5rem">

        <div style="margin-bottom:1.25rem">
          <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.07em;
                      color:var(--text-light);font-weight:600;margin-bottom:0.5rem">
            Topic scores
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:5px">${topicPillsHtml}</div>
          <div style="font-size:0.68rem;color:var(--text-light);margin-top:6px">
            Green = passed (≥70%) · Red = needs work · Grey = not attempted
          </div>
        </div>

        ${hasWeak ? `
        <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:var(--radius);
                    padding:0.85rem 1rem;margin-bottom:1.25rem">
          <div style="font-size:0.78rem;font-weight:600;color:#92400E;margin-bottom:4px">
            ${weakTopics.length} topic${weakTopics.length !== 1 ? 's' : ''} need${weakTopics.length === 1 ? 's' : ''} review
          </div>
          <div style="font-size:0.75rem;color:#78350F;line-height:1.5">
            ${weakTopics.map(t => `${esc(t.title)} (${t.pct}%)`).join(' · ')}
          </div>
        </div>

        <div style="border:1px solid var(--border);border-radius:var(--radius);
                    overflow:hidden;margin-bottom:1.25rem">
          <div style="padding:0.75rem 1rem;background:var(--bg);border-bottom:1px solid var(--border);
                      display:flex;align-items:center;justify-content:space-between">
            <span style="font-size:0.82rem;font-weight:600;color:var(--text-dark)">
              AI Revision Notes
            </span>
            <button id="ai-notes-btn"
              class="btn btn-primary btn-sm"
              onclick="loadStudyNotes(${courseId})">
              Generate Notes
            </button>
          </div>
          <div id="ai-notes-body"
            style="padding:1rem;font-size:0.82rem;color:var(--text-mid);
                   line-height:1.75;min-height:80px">
            <span style="color:var(--text-light)">
              Click "Generate Notes" to get AI-written revision bullets for your weak topics.
            </span>
          </div>
        </div>` : `
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:var(--radius);
                    padding:0.85rem 1rem;margin-bottom:1.25rem">
          <div style="font-size:0.82rem;font-weight:600;color:#166534">
            ${attemptedTopics.length === 0
              ? 'No quizzes attempted yet in this course.'
              : 'You\'ve passed all attempted topics! Great work.'}
          </div>
          <div style="font-size:0.75rem;color:#15803D;margin-top:3px">
            ${attemptedTopics.length === 0
              ? 'Complete some quizzes first, then return here to review any weak areas.'
              : 'You can still re-attempt quizzes to reinforce your understanding.'}
          </div>
        </div>`}

        ${remaining > 0 ? `
        <div style="display:flex;gap:0.65rem">
          <button class="btn btn-primary" style="flex:1"
            onclick="startRetryQuiz(${courseId})">
            ${hasWeak ? 'Generate AI Quiz on Weak Topics' : 'Start Re-attempt Quiz'}
            <span style="font-size:0.72rem;opacity:0.8;margin-left:6px">(${attempts + 1}/${MAX_ATTEMPTS})</span>
          </button>
          <button class="btn btn-ghost btn-sm"
            onclick="document.getElementById('ai-study-modal').style.display='none'">
            Close
          </button>
        </div>` : `
        <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:var(--radius);
                    padding:0.85rem 1rem;font-size:0.82rem;color:#991B1B;text-align:center">
          All ${MAX_ATTEMPTS} attempts used. Please speak to your teacher for further guidance.
        </div>`}
      </div>
    </div>`;

  modal.style.display = 'flex';
}

/** Fetches and renders AI revision notes into the study panel's notes card, with a loading state and error handling. */
async function loadStudyNotes(courseId) {
  const course  = COURSES[courseId];
  const student = getActiveStudent();
  const weak    = getWeakTopics(student, courseId);
  const btn     = document.getElementById('ai-notes-btn');
  const body    = document.getElementById('ai-notes-body');
  if (!btn || !body) return;

  // No weak topics? Fall back to overview notes on everything attempted so far.
  const topicsToRevise = weak.length > 0 ? weak : getAttemptedTopics(student, courseId);

  if (!topicsToRevise.length) {
    body.innerHTML = '<span style="color:var(--text-light)">No topics to generate notes for yet.</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Generating…';
  body.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;color:var(--text-light);font-size:0.82rem">
      <div style="width:14px;height:14px;border:2px solid var(--blue);border-top-color:transparent;
                  border-radius:50%;animation:spin 0.7s linear infinite;flex-shrink:0"></div>
      Generating revision notes for ${topicsToRevise.length} topic${topicsToRevise.length !== 1 ? 's' : ''}…
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;

  try {
    const notes = await generateStudyNotes(course, topicsToRevise);
    // Turn the "## Heading" / "• bullet" markdown-ish output into styled HTML.
    const html = notes
      .split('\n')
      .map(line => {
        if (line.startsWith('## ')) {
          return `<div style="font-weight:600;color:var(--text-dark);margin-top:0.85rem;
                              margin-bottom:0.3rem;font-size:0.85rem">${esc(line.slice(3))}</div>`;
        }
        if (line.startsWith('• ') || line.startsWith('- ')) {
          return `<div style="display:flex;gap:7px;margin-bottom:4px">
                    <span style="color:var(--blue);flex-shrink:0;margin-top:1px">•</span>
                    <span style="font-size:0.8rem;line-height:1.55">${esc(line.slice(2))}</span>
                  </div>`;
        }
        if (line.trim()) {
          return `<div style="font-size:0.8rem;line-height:1.55;margin-bottom:3px">${esc(line)}</div>`;
        }
        return '';
      })
      .join('');

    body.innerHTML = html || '<span style="color:var(--text-light)">Notes generated - no content returned.</span>';
    btn.textContent = 'Regenerate';
    btn.disabled = false;
  } catch (err) {
    body.innerHTML = `<span style="color:var(--danger);font-size:0.8rem">
      Failed to generate notes: ${err.message}.<br>
      Check your network connection and try again.
    </span>`;
    btn.textContent = 'Retry';
    btn.disabled = false;
  }
}

/** Kicks off a re-attempt: shows a loading state, asks the AI for questions on the weak (or attempted) topics, then opens the quiz modal. */
async function startRetryQuiz(courseId) {
  const student  = getActiveStudent();
  const attempts = getAttempts(student.id, courseId);
  if (attempts >= MAX_ATTEMPTS) { showToast('No attempts remaining for this subject.'); return; }

  const course    = COURSES[courseId];
  const weak      = getWeakTopics(student, courseId);
  const attempted = getAttemptedTopics(student, courseId);
  const modal     = document.getElementById('ai-study-modal');

  const bodyEl = modal.querySelector('[style*="padding:1.5rem"]');
  if (bodyEl) {
    bodyEl.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;
                  justify-content:center;padding:3rem 1rem;gap:1rem">
        <div style="width:32px;height:32px;border:3px solid var(--blue);
                    border-top-color:transparent;border-radius:50%;
                    animation:spin 0.7s linear infinite"></div>
        <div style="font-size:0.85rem;color:var(--text-mid);text-align:center">
          Generating personalized quiz questions…<br>
          <span style="font-size:0.75rem;color:var(--text-light)">This may take a few seconds</span>
        </div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>`;
  }

  try {
    const topicsForQuiz = weak.length > 0 ? weak : attempted;
    if (!topicsForQuiz.length) {
      showToast('No quiz topics available yet. Complete some quizzes first.');
      if (modal) modal.style.display = 'none';
      return;
    }

    const questions = await generateQuizQuestions(course, topicsForQuiz);
    const attemptNum = attempts + 1;

    if (modal) modal.style.display = 'none';
    openRetryQuizModal(courseId, attemptNum, questions);
  } catch (err) {
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div style="padding:2rem;text-align:center">
          <div style="font-size:0.85rem;color:var(--danger);margin-bottom:1rem">
            Failed to generate quiz: ${err.message}
          </div>
          <div style="display:flex;gap:0.65rem;justify-content:center">
            <button class="btn btn-primary btn-sm"
              onclick="startRetryQuiz(${courseId})">Try Again</button>
            <button class="btn btn-ghost btn-sm"
              onclick="document.getElementById('ai-study-modal').style.display='none'">Cancel</button>
          </div>
        </div>`;
    }
  }
}

/** Renders the AI-generated quiz modal (separate from the in-page topic quizzes) for the student to answer and submit. */
function openRetryQuizModal(courseId, attemptNum, questions) {
  const course = COURSES[courseId];

  let modal = document.getElementById('retry-quiz-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'retry-quiz-modal';
    modal.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,0.45);
      display:flex;align-items:center;justify-content:center;
      z-index:600;backdrop-filter:blur(4px);padding:1rem`;
    document.body.appendChild(modal);
  }

  const qHtml = questions.map((q, qi) => `
    <div class="quiz-q" style="margin-bottom:1.2rem" id="rq-${qi}">
      <p style="font-size:0.85rem;font-weight:500;margin-bottom:0.5rem;
                color:var(--text-dark);line-height:1.5">
        ${qi + 1}. ${esc(q.q)}
        ${q.topicTitle ? `<span style="display:block;font-size:0.68rem;color:var(--text-light);
          font-weight:400;margin-top:2px">${esc(q.topicTitle)}</span>` : ''}
      </p>
      ${q.options.map((opt, oi) => `
        <div class="quiz-opt"
          data-qi="${qi}" data-oi="${oi}" data-ans="${Number(q.ans)}"
          onclick="pickOpt(this)"
          style="font-size:0.82rem;padding:0.5rem 0.75rem;margin-bottom:5px;
                 border-radius:var(--radius);border:1px solid var(--border);
                 cursor:pointer;display:flex;align-items:flex-start;gap:9px;
                 transition:background 0.1s,border-color 0.1s">
          <span style="font-family:var(--font-mono);font-size:0.68rem;
                       color:var(--text-light);flex-shrink:0;margin-top:2px;
                       min-width:14px">
            ${String.fromCharCode(65 + oi)}
          </span>
          <span>${esc(opt)}</span>
        </div>`).join('')}
    </div>`).join('');

  modal.innerHTML = `
    <div style="background:var(--white);border-radius:var(--radius-xl);
                width:100%;max-width:580px;max-height:90vh;overflow-y:auto;
                box-shadow:var(--shadow-lg);border:1px solid var(--border)">

      <div style="padding:1.1rem 1.5rem;border-bottom:1px solid var(--border);
                  display:flex;align-items:center;justify-content:space-between;
                  position:sticky;top:0;background:var(--white);z-index:10">
        <div>
          <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.09em;
                      color:var(--text-light);font-family:var(--font-mono)">
            AI Quiz · Attempt ${attemptNum} of ${MAX_ATTEMPTS}
          </div>
          <div style="font-size:0.95rem;font-weight:600;color:var(--text-dark)">
            ${esc(course.subject)} - Personalized Questions
          </div>
        </div>
        <div style="font-size:0.75rem;color:var(--text-light);font-family:var(--font-mono)">
          ${questions.length} Qs
        </div>
      </div>

      <div style="padding:1.25rem 1.5rem" id="retry-quiz-body">
        <div style="background:var(--bg);border:1px solid var(--border);
                    border-radius:var(--radius);padding:0.7rem 0.9rem;
                    margin-bottom:1.1rem;font-size:0.78rem;color:var(--text-mid)">
          These questions were generated by AI based on your weak topics.
          Answer all, then submit.
        </div>
        ${qHtml}
        <div style="display:flex;gap:0.65rem;justify-content:flex-end;
                    padding-top:1rem;border-top:1px solid var(--border)">
          <button class="btn btn-ghost btn-sm"
            onclick="document.getElementById('retry-quiz-modal').style.display='none'">
            Cancel
          </button>
          <button class="btn btn-primary"
            id="retry-submit-btn"
            onclick="submitRetryQuiz(${courseId}, ${attemptNum}, ${questions.length})">
            Submit Quiz
          </button>
        </div>
        <div id="retry-quiz-result"></div>
      </div>
    </div>`;

  modal.style.display = 'flex';
}

/** Grades the AI quiz, saves the attempt to the student's quizScores, and renders the pass/fail result card with next-step buttons. */
async function submitRetryQuiz(courseId, attemptNum, total) {
  const modal   = document.getElementById('retry-quiz-modal');
  const student = getActiveStudent();
  let correct  = 0;
  let answered = 0;

  modal.querySelectorAll('.quiz-q').forEach(qEl => {
    const sel = qEl.querySelector('.quiz-opt.selected');
    if (!sel) return;
    answered++;
    const chosen = parseInt(sel.dataset.oi);
    const ans    = parseInt(sel.dataset.ans);
    qEl.querySelectorAll('.quiz-opt').forEach(o => {
      o.style.pointerEvents = 'none';
      if (parseInt(o.dataset.oi) === ans) o.classList.add('correct');
      else if (parseInt(o.dataset.oi) === chosen) o.classList.add('wrong');
    });
    if (chosen === ans) correct++;
  });

  if (answered < total) { showToast(`Please answer all ${total} questions before submitting.`); return; }

  const pct       = Math.round(correct / total * 100);
  const grade     = calcGradeFromThreshold(pct);
  const passed    = pct >= 60;
  const remaining = MAX_ATTEMPTS - attemptNum;

  const submitBtn = document.getElementById('retry-submit-btn');
  if (submitBtn) submitBtn.style.display = 'none';

  // Record this as a distinct AI-retry quiz entry (not tied to a specific topicId).
    try {
      const entry = await apiFetch(`/students/${student.id}/quiz-scores/ai-retry`, {
        method: 'POST',
        body: JSON.stringify({ courseId, score: correct, total }),
      });
      student.quizScores.push(entry);
    } catch (err) {
      showToast('Result shown but not saved: ' + err.message);
    }
  

  const resultEl = document.getElementById('retry-quiz-result');
  if (resultEl) {
    resultEl.style.cssText = `
      margin-top:1rem;padding:1rem 1.25rem;border-radius:var(--radius);
      background:${passed ? '#F0FDF4' : '#FEF2F2'};
      border:1px solid ${passed ? '#BBF7D0' : '#FECACA'}`;
    resultEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  margin-bottom:0.5rem">
        <strong style="font-size:0.95rem;color:${passed ? '#166534' : '#991B1B'}">
          ${passed ? 'Good work.' : 'Keep going.'}
        </strong>
        <span style="font-family:var(--font-mono);font-size:1.1rem;font-weight:700;
                     color:${passed ? '#166534' : '#991B1B'}">
          ${correct}/${total} · ${grade}
        </span>
      </div>
      <div style="font-size:0.78rem;color:${passed ? '#15803D' : '#991B1B'};
                  margin-bottom:0.85rem;line-height:1.5">
        You scored ${pct}%.
        ${passed
          ? ' Your performance has improved. Keep practising to stay sharp.'
          : remaining > 0
            ? ` You have ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining. Review the notes and try again.`
            : ' You have used all attempts. Please speak to your teacher for guidance.'}
      </div>
      <div style="display:flex;gap:0.65rem;flex-wrap:wrap">
        <button class="btn btn-sm"
          style="background:${passed ? '#16A34A' : '#DC2626'};color:#fff;border:none"
          onclick="document.getElementById('retry-quiz-modal').style.display='none';renderPerformance()">
          ${passed ? 'View Progress' : 'Close'}
        </button>
        ${!passed && remaining > 0 ? `
          <button class="btn btn-outline btn-sm"
            onclick="document.getElementById('retry-quiz-modal').style.display='none';openAIStudyPanel(${courseId})">
            Study Again
          </button>` : ''}
        ${passed ? `
          <button class="btn btn-ghost btn-sm"
            onclick="document.getElementById('retry-quiz-modal').style.display='none'">
            Close
          </button>` : ''}
      </div>`;
  }
}

/** Legacy entry point (still referenced by some "Re-attempt Quizzes" buttons) - just opens the main study panel. */
function openRetryQuiz(courseId) {
  const student  = getActiveStudent();
  const attempts = getAttempts(student.id, courseId);
  if (attempts >= MAX_ATTEMPTS) { showToast('No attempts remaining for this subject.'); return; }
  openAIStudyPanel(courseId);
}

// ── Assignment file upload (drag/drop + browse) ──────────────────────────────

function showFileName(topicSafe, input) {
  const nameEl = document.getElementById('file-name-' + topicSafe);
  if (nameEl && input.files.length) {
    nameEl.textContent = input.files[0].name;
    nameEl.style.display = 'block';
    const zone = document.getElementById('upload-zone-' + topicSafe);
    if (zone) zone.style.borderColor = 'var(--blue)';
  }
}

function handleFileDrop(event, topicSafe) {
  event.preventDefault();
  const zone = document.getElementById('upload-zone-' + topicSafe);
  if (zone) zone.style.borderColor = 'var(--border)';
  const file = event.dataTransfer.files[0];
  if (!file) return;
  const inp = document.getElementById('file-inp-' + topicSafe);
  if (inp) {
    const dt = new DataTransfer();
    dt.items.add(file);
    inp.files = dt.files;
    showFileName(topicSafe, inp);
  }
}

/**
 * Submits a student's assignment (text answer and/or file). This is a mock
 * submission - there's no real backend/file storage - it just updates the
 * student's assignment record, fires a notification, and re-renders the
 * topic's content panel to show the "submitted" state.
 */
async function submitAssignment(topicId, topicSafe) {
  const statusEl = document.getElementById('assign-status-' + topicSafe);
  const textEl   = document.getElementById('assign-text-' + topicSafe);
  const fileInp  = document.getElementById('file-inp-' + topicSafe);

  const hasText = textEl && textEl.value.trim().length > 0;
  const hasFile = fileInp && fileInp.files.length > 0;
  if (!hasText && !hasFile) {
    if (statusEl) { statusEl.textContent = 'Please write an answer or attach a file before submitting.'; statusEl.style.color = 'var(--danger)'; }
    return;
  }

  if (statusEl) { statusEl.textContent = 'Submitting...'; statusEl.style.color = 'var(--text-light)'; }

  const student = getActiveStudent();
  const assign = student.assignments.find(a => a.topicId === topicId);
  const assignId = assign ? assign.id : 'a_' + topicId;


  const formData = new FormData();
  if (hasText) formData.append('text', textEl.value.trim());
  if (hasFile) formData.append('file', fileInp.files[0]);

  try {
    const updated = await apiFetch(`/students/${encodeURIComponent(student.id)}/assignments/${encodeURIComponent(assignId)}/submit`, {
      method: 'PATCH',
      body: formData,
    });
    if (assign) Object.assign(assign, updated); else student.assignments.push(updated);

    const topicEl = document.querySelector(`.topic-item[data-id="${topicId}"]`);
    if (topicEl) topicEl.click(); // re-render the panel into its "submitted" state
    try {
      const notif = await apiFetch('/notifications', {
        method: 'POST',
        body: JSON.stringify({
          type: 'upload',
          title: 'Assignment submitted',
          body: 'Your assignment has been submitted and is awaiting teacher review.',
        }),
      });
      NOTIFICATIONS.unshift(notif);
      renderNotifBell();
    } catch (err) {
      console.error('Failed to create notification:', err.message);
    }
    showToast('Assignment submitted successfully.');
  } catch (err) {
    if (statusEl) { statusEl.textContent = err.message; statusEl.style.color = 'var(--danger)'; }
  }
}