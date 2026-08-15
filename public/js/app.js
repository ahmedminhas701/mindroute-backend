// ╔══════════════════════════════════════════════════════════════╗
// ║  MIND ROUTE LMS — app.js                                     ║
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

const API_BASE = 'http://localhost:3000/api'; // swap for your deployed URL later

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

// ── Data globals — populated by loadAppData(), not hardcoded anymore ──
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



  // Everyone needs these — course catalog, entry tests, schedule, thresholds, notifications
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

  // Batches + teacher directory — needed by student dashboard too (teacher-name lookup)
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





// Replaces the old TEACHERS_DB.find()/STUDENTS_DB.find() lookups —
// these now just return the already-loaded current-user record.
function getActiveStudent() { return CURRENT_STUDENT; }
function getActiveTeacher() { return CURRENT_TEACHER; }





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
 * — checking for that id would wrongly say "not the login page," causing
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
  const homes = { student: 'Student/dashboard.html', teacher: 'Teacher/dashboard.html', admin: 'Admin/index.html' };
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
    showToast('Could not save progress — check your connection.');
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
  const scores = student.quizScores;
  if (!scores.length) return 0;
  const total = scores.reduce((a, b) => a + b.total, 0);
  const got   = scores.reduce((a, b) => a + b.score, 0);
  return total ? Math.round(got / total * 100) : 0;
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
        <div class="notif-icon ${notifColors[n.type] || 'si-blue'}" style="font-size:0.7rem;font-family:var(--font-mono)">${n.type.slice(0, 2).toUpperCase()}</div>
        <div class="notif-body" style="flex:1"><p><strong>${n.title}</strong> — ${n.body}</p><small>${timeAgo(n.createdAt)}</small></div>
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
// 14. SIDEBAR SETUP (runs on every page — avatar initials, active nav link, logout)
// ──────────────────────────────────────────────────
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
    const initials = session.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
    const av = document.getElementById('sb-avatar');
    const sn = document.getElementById('sb-name');
    if (av) av.textContent = initials;
    if (sn) sn.textContent = session.name.split(' ')[0];
  }

  const nb = document.getElementById('notif-nav-badge');
  const uc = unreadCount();
  if (nb) { nb.textContent = uc; nb.style.display = uc > 0 ? 'inline' : 'none'; }

  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', e => {
    e.preventDefault();
    clearSession();
    window.location.href = loginPagePath();
  });

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

async function applyThresholds() {
  document.querySelectorAll('#threshold-editor input[type=number]').forEach(inp => {
    const idx = parseInt(inp.dataset.idx);
    GRADE_THRESHOLDS[idx].min = parseInt(inp.value) || 0;
  });

  try {
    const result = await apiFetch('/thresholds', {
      method: 'PUT',
      body: JSON.stringify({ thresholds: GRADE_THRESHOLDS }),
    });
    GRADE_THRESHOLDS = result.thresholds;
    STUDENTS_DB = await apiFetch('/students'); // refresh recomputed grades
    renderGrading();
    showToast(`Thresholds updated — ${result.recomputedStudents} students recomputed.`);
  } catch (err) {
    showToast(err.message);
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
    showToast('Failed to load data — check your connection.');
    return;
  }

  setupSidebar();

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

  if (document.getElementById('page-content'))          initAdminSPA();
  if (document.getElementById('login-form'))            setupLogin();
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
  if (av) av.textContent = s.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  if (sn) sn.textContent = s.name.split(' ')[0];

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
  setText('stat-due',        s.nextDue);

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
            <h4>${c.title}</h4>
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
          <div class="dl-info" style="flex:1"><h4>${dl.title}</h4><p>${c.title}</p></div>
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
  let teacherNames = '—';
  if (studentBatch?.subjectTeachers) {
    const names = Object.values(studentBatch.subjectTeachers)
      .map(tid => TEACHERS_DB.find(t => t.id === tid)?.name)
      .filter(Boolean);
    teacherNames = [...new Set(names)].join(', ') || '—';
  }
  setText('dash-teacher', teacherNames);
}

/** Renders the "Today" / "Tomorrow" class list widgets on the student dashboard. */
function renderDayClasses(containerId, dayName, label) {
  const el = document.getElementById(containerId);
  if (!el) return;
  const classes = TEACHER_SCHEDULE.filter(r => r.day === dayName);
  el.innerHTML = '';
  if (!classes.length) {
    el.innerHTML = `<p style="color:var(--text-light);font-size:0.8rem">No classes ${label}.</p>`;
    return;
  }
  classes.forEach(r => {
    el.innerHTML += `<div class="day-class">
      <div class="class-time">${r.time}</div>
      <div class="class-info">
        <h4>${r.subject} <span class="badge badge-blue">Online</span></h4>
        <p>${r.room || 'Online'} · ${r.duration || 60}min</p>
      </div>
    </div>`;
  });
}

/** Renders the "My Courses" grid page (one card per enrolled course). */
function renderCoursesList() {
  const student = getActiveStudent();
  const container = document.getElementById('courses-container');
  student.enrolledCourseIds.forEach(id => {
    const c = COURSES[id]; const pct = courseProgress(id);
    const done = allTopics(id).filter(t => isTopicDone(t.id)).length;
    const total = allTopics(id).length;
    container.innerHTML += `
      <div class="course-card">
        <div class="cc-header">
          <div class="cc-icon-row">
            <div class="cc-icon" style="background:${c.colorLight};color:${c.color};font-family:var(--font-mono);font-weight:700">${c.icon}</div>
            <span class="badge" style="background:${c.colorLight};color:${c.color}">${c.subject}</span>
          </div>
          <h3 style="font-size:0.95rem;font-weight:600;color:var(--text-dark);margin-bottom:0.25rem">${c.title}</h3>
          <p style="font-size:0.8rem;color:var(--text-mid)">${c.description}</p>
        </div>
        <div class="cc-body">
          <div class="cc-meta"><span>${c.weeks.length} weeks</span><span>${total} topics</span><span>${done} done</span><span>${c.teacher}</span></div>
          <div class="progress-track" style="margin-bottom:4px"><div class="progress-fill" style="width:${pct}%;background:${c.color}"></div></div>
          <small style="color:var(--text-light);font-size:0.72rem;font-family:var(--font-mono)">${pct}% complete</small>
        </div>
        <div class="cc-footer">
          <a href="course-detail.html?id=${c.id}" class="btn btn-primary btn-full btn-sm">Open Course</a>
          <button class="btn btn-ghost btn-sm" onclick="openMessage('${c.teacher}','${c.title}')">Message</button>
        </div>
      </div>`;
  });
}

/** Renders the course-detail page: week/topic curriculum tree on the left, selected topic's content tabs on the right. */
function renderCourseDetail() {
  const params = new URLSearchParams(location.search);
  const cid = parseInt(params.get('id')) || 1;
  const course = COURSES[cid];
  if (!course) return;

  setText('cd-title', course.title);
  setText('cd-desc', course.description);
  setText('cd-teacher', course.teacher);

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
          <div style="font-size:0.62rem;color:var(--text-light);font-weight:400;text-transform:none;letter-spacing:0;margin-top:1px">Uploaded ${week.uploadedDate}</div>
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
          <div class="topic-title-text" style="${done ? 'text-decoration:line-through;color:var(--text-light)' : ''}">${topic.num} — ${topic.title}</div>
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
  const resumeEl = savedTopicId ? container.querySelector(`.topic-item[data-id="${savedTopicId}"]`) : null;
  if (resumeEl) {
    resumeEl.classList.add('active');
    const savedTopic = allTopics(cid).find(t => t.id === savedTopicId);
    loadContent(savedTopic, course);
  } else if (firstTopic) {
    container.querySelector('.topic-item').classList.add('active');
    loadContent(firstTopic, course);
  }

  const msgBtn = document.getElementById('msg-teacher-btn');
  if (msgBtn) msgBtn.onclick = () => openMessage(course.teacher, course.title);
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
  setText('content-topic-title', topic.num + ' — ' + topic.title);
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
    panel.innerHTML = buildPanel(c, topic);
    panelsEl.appendChild(panel);
  });
}

/**
 * Renders the inner HTML for one content-tab panel, based on its type:
 * video / notes / link / assign (submission form or submitted-state view) / quiz.
 */
function buildPanel(c, topic) {
  const student = getActiveStudent();

  if (c.type === 'video') return `
    <div class="video-player" style="margin-bottom:0.75rem">
      <div class="vp-play">&#9654;</div>
      <div class="vp-text">${topic.title}</div>
      <div style="font-size:0.68rem;margin-top:4px;opacity:0.3;font-family:var(--font-mono)">${c.duration || ''}</div>
    </div>`;

  if (c.type === 'notes') return `
    <div style="display:flex;align-items:center;gap:1rem;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem">
      <div style="flex:1">
        <div style="font-size:0.82rem;font-weight:600;margin-bottom:3px">${topic.title} — Notes</div>
        <p style="font-size:0.78rem;color:var(--text-mid);margin-bottom:0.75rem">Click to download the PDF notes for this topic.</p>
        <a href="${c.url || '#'}" target="_blank" class="btn btn-outline btn-sm">Download Notes</a>
      </div>
    </div>`;

  if (c.type === 'link') return `
    <div style="display:flex;align-items:center;gap:1rem;background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:1.25rem">
      <div style="flex:1">
        <div style="font-size:0.82rem;font-weight:600;margin-bottom:3px">${c.label}</div>
        <p style="font-size:0.78rem;color:var(--text-mid);margin-bottom:0.75rem">External reference resource.</p>
        <a href="${c.url || '#'}" target="_blank" class="btn btn-outline btn-sm">Open Resource</a>
      </div>
    </div>`;

  if (c.type === 'assign') {
    const assignRec = student.assignments.find(a => a.topicId === topic.id);

    // Already submitted → show status card (graded or awaiting review).
    if (assignRec?.submitted) {
      const pct = assignRec.marks !== null && assignRec.totalMarks
        ? Math.round(assignRec.marks / assignRec.totalMarks * 100) : null;
      const approved = assignRec.approved;
      return `
        <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:var(--radius);
                    padding:0.85rem 1rem;margin-bottom:0.85rem">
          <div style="font-weight:600;font-size:0.82rem;color:#166534;margin-bottom:2px">
            Submitted on ${assignRec.submittedOn}
          </div>
          <div style="font-size:0.75rem;color:#15803D">
            ${approved
              ? `Grade: <strong style="font-family:var(--font-mono)">${assignRec.grade}</strong>
                 — ${assignRec.marks}/${assignRec.totalMarks} marks`
              : 'Submitted — awaiting teacher review'}
          </div>
          ${assignRec.feedback
            ? `<div style="margin-top:0.5rem;padding-top:0.5rem;border-top:1px solid #BBF7D0;
                           font-size:0.78rem;color:#166534">
                 <strong>Feedback:</strong> ${assignRec.feedback}
               </div>` : ''}
        </div>
        ${pct !== null ? `
          <div class="progress-track" style="margin-bottom:6px">
            <div class="progress-fill ${pct >= 70 ? 'green' : pct >= 50 ? 'orange' : 'red'}"
              style="width:${pct}%"></div>
          </div>
          <div style="font-size:0.72rem;color:var(--text-light);font-family:var(--font-mono)">
            ${pct}% — ${assignRec.grade || 'Pending'}
          </div>` : ''}`;
    }

    // Not yet submitted → show the submission form (text answer + file attach).
    const topicSafe = topic.id.replace(/[^a-z0-9]/gi, '_');
    return `
      <div style="background:var(--bg);border:1px solid var(--border);
                  border-radius:var(--radius);padding:0.85rem 1rem;
                  margin-bottom:0.85rem;font-size:0.82rem;
                  color:var(--text-mid);line-height:1.6">
        ${c.detail || 'Complete and submit this assignment.'}
        ${c.totalMarks
          ? `<div style="margin-top:4px;font-size:0.72rem;color:var(--text-light);
                         font-family:var(--font-mono)">Total marks: ${c.totalMarks}</div>`
          : ''}
      </div>

      <div style="margin-bottom:0.85rem">
        <label style="display:block;font-size:0.72rem;font-weight:600;
                      text-transform:uppercase;letter-spacing:0.06em;
                      color:var(--text-mid);margin-bottom:0.35rem">
          Your Answer / Comments
        </label>
        <textarea id="assign-text-${topicSafe}" class="form-control"
          placeholder="Type your answer, notes, or any comments for the teacher..."
          style="min-height:100px;font-size:0.82rem;resize:vertical"></textarea>
      </div>

      <div style="margin-bottom:0.85rem">
        <label style="display:block;font-size:0.72rem;font-weight:600;
                      text-transform:uppercase;letter-spacing:0.06em;
                      color:var(--text-mid);margin-bottom:0.35rem">
          Attach File (PDF, Word, Image)
        </label>
        <div id="upload-zone-${topicSafe}"
          style="border:2px dashed var(--border);border-radius:var(--radius);
                 padding:1.25rem;text-align:center;cursor:pointer;
                 background:var(--bg);transition:border-color 0.15s"
          onclick="document.getElementById('file-inp-${topicSafe}').click()"
          ondragover="event.preventDefault();this.style.borderColor='var(--blue)'"
          ondragleave="this.style.borderColor='var(--border)'"
          ondrop="handleFileDrop(event,'${topicSafe}')">
          <div style="font-size:1.2rem;margin-bottom:4px;color:var(--text-light)">↑</div>
          <div style="font-size:0.82rem;font-weight:500;color:var(--text-dark)">
            Click to browse or drag a file here
          </div>
          <div style="font-size:0.72rem;color:var(--text-light);margin-top:3px">
            PDF, DOC, DOCX, JPG, PNG — max 10MB
          </div>
          <div id="file-name-${topicSafe}"
            style="margin-top:6px;font-size:0.75rem;font-family:var(--font-mono);
                   color:var(--blue);display:none"></div>
        </div>
        <input type="file" id="file-inp-${topicSafe}"
          accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
          style="display:none"
          onchange="showFileName('${topicSafe}',this)">
      </div>

      <div style="display:flex;gap:0.65rem;align-items:center">
        <button class="btn btn-primary btn-sm"
          onclick="submitAssignment('${topic.id}','${topicSafe}')">
          Submit Assignment
        </button>
        <span id="assign-status-${topicSafe}"
          style="font-size:0.78rem;color:var(--text-light)"></span>
      </div>`;
  }

  if (c.type === 'quiz') {
    const prevScore = student.quizScores.find(q => q.topicId === topic.id);
    const prevPct   = prevScore ? Math.round(prevScore.score / prevScore.total * 100) : null;
    const courseId  = Object.values(COURSES).find(course =>
      course.weeks.some(w => w.topics.some(t => t.id === topic.id))
    )?.id;
    const lowScore = prevPct !== null && prevPct < 70;

    const qs = c.questions.map((q, qi) => `
      <div class="quiz-q">
        <p>Q${qi + 1}. ${q.q}</p>
        ${q.options.map((opt, oi) => `
          <div class="quiz-opt" data-qi="${qi}" data-oi="${oi}" data-ans="${q.ans}"
            onclick="pickOpt(this)">
            <span class="quiz-opt-label">${String.fromCharCode(65 + oi)}</span> ${opt}
          </div>`).join('')}
      </div>`).join('');

    return `
      ${lowScore && courseId ? `
      <div style="background:#FEF3C7;border:1px solid #FDE68A;border-radius:var(--radius);
                  padding:0.65rem 0.85rem;margin-bottom:0.85rem;font-size:0.78rem;
                  display:flex;align-items:center;justify-content:space-between;gap:0.75rem">
        <span style="color:#92400E">
          Your previous score was ${prevPct}%. You can re-attempt with AI-generated questions.
        </span>
        <button class="btn btn-sm"
          style="background:#D97706;color:#fff;border:none;white-space:nowrap;flex-shrink:0"
          onclick="openAIStudyPanel(${courseId})">
          Study &amp; Retry
        </button>
      </div>` : ''}
      <div id="qz${Math.random().toString(36).slice(2, 7)}">${qs}
        <button class="btn btn-primary btn-sm"
          onclick="submitQuiz(this, ${c.questions.length}, '${topic.id}', ${course.id}, '${course.subject.replace(/'/g, "\\'")}', '${topic.title.replace(/'/g, "\\'")}')"
          style="margin-top:0.5rem">Submit Quiz</button>
        <div class="quiz-result"></div>
      </div>`;
  }

  return '<p style="color:var(--text-light);font-size:0.82rem">Content coming soon.</p>';
}

function unreadCount() { return NOTIFICATIONS.filter(n => !n.read).length; }

function getTeacherCourseIds() {
  const teacher = getActiveTeacher();
  if (!teacher) return [];
  const assignedCourseIds = new Set();
  BATCHES.forEach(b => {
    if (!b.subjectTeachers) return;
    Object.entries(b.subjectTeachers).forEach(([subject, tid]) => {
      if (tid === teacher.id) {
        Object.values(COURSES).forEach(c => {
          if (c.subject === subject) assignedCourseIds.add(c.id);
        });
      }
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

  const assigns     = student.assignments.filter(a => a.courseId === courseId && a.marks !== null);
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
async function submitQuiz(btn, total, topicId, courseId, subject, topicTitle) {
  const wrap = btn.closest('div[id]');
  let correct = 0;

  wrap.querySelectorAll('.quiz-q').forEach(qEl => {
    const sel = qEl.querySelector('.quiz-opt.selected');
    if (!sel) return;
    const chosen = parseInt(sel.dataset.oi), ans = parseInt(sel.dataset.ans);
    qEl.querySelectorAll('.quiz-opt').forEach(o => {
      if (parseInt(o.dataset.oi) === ans) o.classList.add('correct');
      else if (parseInt(o.dataset.oi) === chosen) o.classList.add('wrong');
    });
    if (chosen === ans) correct++;
  });

  btn.style.display = 'none';
  const res = wrap.querySelector('.quiz-result');
  const pct = Math.round(correct / total * 100);
  res.style.display = 'block';
  res.style.cssText = `display:block;padding:.7rem .9rem;border-radius:var(--radius);font-weight:500;font-size:.82rem;background:${pct >= 70 ? 'var(--success-light)' : 'var(--danger-light)'};color:${pct >= 70 ? 'var(--success)' : 'var(--danger)'};border:1px solid ${pct >= 70 ? '#bbf7d0' : '#fecaca'}`;
  res.innerHTML = `You scored <strong style="font-family:var(--font-mono)">${correct}/${total}</strong> (${pct}%) — ${pct >= 70 ? 'Well done.' : 'Review and try again.'}`;

  try {
    const student = getActiveStudent();
    const entry = await apiFetch(`/students/${student.id}/quiz-scores`, {
      method: 'POST',
      body: JSON.stringify({ topic: topicTitle, subject, topicId, score: correct, total }),
    });
    const existing = student.quizScores.find(q => q.topicId === topicId);
    if (existing) Object.assign(existing, entry); else student.quizScores.push(entry);
  } catch (err) {
    showToast('Score shown but not saved: ' + err.message);
  }
}

/** Renders the student's weekly class schedule page, grouped by day. */
function renderSchedule() {
  const container = document.getElementById('schedule-container');
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  days.forEach(day => {
    const classes = TEACHER_SCHEDULE.filter(r => r.day === day);
    if (!classes.length) return;
    const isToday = day === today;
    const rows = classes.map(r => {
      const badge = `<span class="badge badge-blue">Online</span>`;
      return `<div class="day-class"><div class="class-time">${r.time}</div><div class="class-info"><h4>${r.subject} ${badge}</h4><p>${r.room}</p></div></div>`;
    }).join('');
    container.innerHTML += `<div class="day-card"><div class="day-card-head ${isToday ? 'today' : ''}">${day}${isToday ? ' — Today' : ''}</div>${rows}</div>`;
  });
}

/** Renders the student's attendance table (per-subject) plus the assignment-status table below it. */
function renderAttendance() {
  const student = getActiveStudent();
  const tbody = document.getElementById('attendance-tbody');
  const overall = document.getElementById('att-overall');

  student.attendanceDetail.forEach(row => {
    const pct = Math.round(row.attended / row.total * 100);
    const color = pct >= 85 ? 'var(--success)' : pct >= 75 ? 'var(--warning)' : 'var(--danger)';
    const status = pct >= 85 ? 'Good' : pct >= 75 ? 'Low' : 'Critical';
    tbody.innerHTML += `<tr>
      <td><strong>${row.subject}</strong></td>
      <td style="color:var(--success);font-weight:600;font-family:var(--font-mono)">${row.attended}</td>
      <td style="color:var(--danger);font-weight:600;font-family:var(--font-mono)">${row.missed}</td>
      <td style="font-family:var(--font-mono)">${row.total}</td>
      <td><div style="display:flex;align-items:center;gap:8px">
        <div class="progress-track" style="width:70px"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
        <strong style="color:${color};font-family:var(--font-mono)">${pct}%</strong>
      </div></td>
      <td><span class="badge ${pct >= 85 ? 'badge-green' : pct >= 75 ? 'badge-orange' : 'badge-red'}">${status}</span></td>
    </tr>`;
  });

  if (overall) { overall.textContent = student.attendance + '%'; overall.style.color = student.attendance >= 85 ? 'var(--success)' : 'var(--warning)'; }

  const atbody = document.getElementById('assignment-tbody');
  if (atbody) {
    student.assignments.forEach(a => {
      const days = getDueDays(a.dueDate);
      const statusHtml = a.submitted ? `<span class="badge badge-green">Submitted</span>` :
        days !== null && days < 0 ? `<span class="badge badge-red">Overdue</span>` :
        days !== null && days <= 3 ? `<span class="badge badge-orange">Due Soon</span>` :
        `<span class="badge badge-blue">Pending</span>`;
      const gradeHtml = a.grade ? `<strong>${a.grade}</strong>` : a.submitted ? '<span style="color:var(--text-light)">Awaiting</span>' : '—';
      atbody.innerHTML += `<tr>
        <td><strong>${a.title}</strong></td><td>${a.course}</td>
        <td style="font-family:var(--font-mono);font-size:0.8rem">${a.dueDate}</td>
        <td style="font-family:var(--font-mono);font-size:0.8rem">${a.submittedOn || '—'}</td>
        <td>${statusHtml}</td><td>${gradeHtml}</td>
      </tr>`;
    });
  }
}

/** Renders the student's fee installment table and the payment summary at the top. */
function renderFees() {
  const student = getActiveStudent();
  const tbody = document.getElementById('fees-tbody');
  student.fees.forEach(r => {
    const paid = r.status === 'paid';
    tbody.innerHTML += `<tr>
      <td>${r.label}</td>
      <td style="font-family:var(--font-mono);font-weight:600">Rs. ${r.amount.toLocaleString()}</td>
      <td style="font-family:var(--font-mono);font-size:0.8rem">${r.dueDate}</td>
      <td><span class="badge ${paid ? 'badge-green' : 'badge-red'}">${paid ? 'Paid' : 'Unpaid'}</span></td>
    </tr>`;
  });
  setText('fee-total', 'Rs. ' + student.totalFee.toLocaleString());
  setText('fee-paid',  'Rs. ' + student.paidAmount.toLocaleString());
  setText('fee-rem',   'Rs. ' + (student.totalFee - student.paidAmount).toLocaleString());
  setText('fee-due',   student.nextDue);
  const pct = Math.round(student.paidAmount / student.totalFee * 100);
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

    // Quiz breakdown for this course only
    const courseTopicIds = new Set(allTopics(courseId).map(t => t.id));
    const quizzes   = student.quizScores.filter(q => courseTopicIds.has(q.topicId));
    const quizTotal = quizzes.reduce((a, b) => a + b.total, 0);
    const quizGot   = quizzes.reduce((a, b) => a + b.score, 0);
    const quizPct   = quizTotal ? Math.round(quizGot / quizTotal * 100) : 0;

    // Assignment breakdown for this course only
    const assigns     = student.assignments.filter(a => a.courseId === courseId && a.marks !== null);
    const assignTotal = assigns.reduce((a, b) => a + b.totalMarks, 0);
    const assignGot   = assigns.reduce((a, b) => a + b.marks, 0);
    const assignPct   = assignTotal ? Math.round(assignGot / assignTotal * 100) : 0;

    // Attendance for this course's subject
    const attRow = student.attendanceDetail.find(a => a.subject === course.subject);
    const attPct = attRow ? Math.round(attRow.attended / attRow.total * 100) : 0;

    const needsReview = progress < 60;

    container.innerHTML += `
      <div class="perf-subject-card">
        <div class="perf-header">
          <div class="perf-icon"
            style="background:${course.colorLight};color:${course.color};
                   font-family:var(--font-mono);font-weight:700">${course.icon}</div>
          <div style="flex:1">
            <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:.08em;
                        color:var(--text-light);font-weight:600">${course.subject}</div>
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
              <span style="font-family:var(--font-body);color:var(--text-mid)">${q.topic}</span>
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
      </div>`;
  });

  // Top summary strip (overall score / quiz average / attendance / assignments submitted)
  const summaryEl = document.getElementById('perf-summary');
  if (summaryEl) {
    const overallPct = overallProgress();
    const totalQ   = student.quizScores.reduce((a, b) => a + b.total, 0);
    const gotQ     = student.quizScores.reduce((a, b) => a + b.score, 0);
    const avgQuiz  = totalQ ? Math.round(gotQ / totalQ * 100) : 0;
    const submitted = student.assignments.filter(a => a.submitted).length;
    const total     = student.assignments.length;
    summaryEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1rem">
        <div style="text-align:center">
          <div style="font-size:1.8rem;font-weight:700;color:var(--text-dark);
                      font-family:var(--font-mono)">${overallPct}%</div>
          <div style="font-size:0.72rem;color:var(--text-light)">Overall Score</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:1.8rem;font-weight:700;color:var(--text-dark);
                      font-family:var(--font-mono)">${avgQuiz}%</div>
          <div style="font-size:0.72rem;color:var(--text-light)">Quiz Average</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:1.8rem;font-weight:700;color:var(--text-dark);
                      font-family:var(--font-mono)">${student.attendance}%</div>
          <div style="font-size:0.72rem;color:var(--text-light)">Attendance</div>
        </div>
        <div style="text-align:center">
          <div style="font-size:1.8rem;font-weight:700;color:var(--text-dark);
                      font-family:var(--font-mono)">${submitted}/${total}</div>
          <div style="font-size:0.72rem;color:var(--text-light)">Assignments</div>
        </div>
      </div>`;
  }
}

// ══════════════════════════════════════════════════
//   18. MESSAGING (mock student ↔ teacher chat — not persisted)
// ══════════════════════════════════════════════════
let msgHistory = [];

function openMessage(teacher, course) {
  const modal = document.getElementById('msg-modal');
  if (!modal) return;
  setText('msg-teacher-name', teacher);
  setText('msg-course-name', course);
  msgHistory = [{ from: 'teacher', text: `Hello — how can I help you with ${course}?` }];
  renderMessages();
  modal.classList.add('open');
}
function closeMessage() { const modal = document.getElementById('msg-modal'); if (modal) modal.classList.remove('open'); }

function renderMessages() {
  const hist = document.getElementById('msg-history');
  if (!hist) return;
  hist.innerHTML = msgHistory.map(m => `<div class="msg-bubble ${m.from}">${m.text}</div>`).join('');
  hist.scrollTop = hist.scrollHeight;
}

function sendMessage() {
  const inp = document.getElementById('msg-input');
  if (!inp || !inp.value.trim()) return;
  msgHistory.push({ from: 'student', text: inp.value.trim() }); inp.value = '';
  renderMessages();
  // Canned auto-reply, since there's no real backend behind this chat yet.
  setTimeout(() => { msgHistory.push({ from: 'teacher', text: "Thank you — I'll respond shortly." }); renderMessages(); }, 1000);
}

// ══════════════════════════════════════════════════
//   19. TEACHER PAGES
// ══════════════════════════════════════════════════

/** Renders the teacher home dashboard: stat cards, course list, pending-grading queue, today's classes, and recent activity table. */
function renderTeacherDashboard() {
  const courseIds = getTeacherCourseIds();
  const myCourses = courseIds.map(id => COURSES[id]).filter(Boolean);

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
            <h4>${c.title}</h4>
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
              <div style="font-size:0.82rem;font-weight:500">${a.title}</div>
              <div style="font-size:0.72rem;color:var(--text-light)">${a.studentName} · ${a.course}</div>
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
              <h4>${r.subject} ${badge}</h4>
              <p>${r.room} · ${r.duration}min</p>
            </div>
          </div>`;
      });
    }
  }

  // Recent activity table — last submissions + quiz completions across the teacher's courses
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
          time: a.submittedOn || '—',
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
          time: q.date || '—',
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
          <td>${a.course}</td>
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

  myCourses.forEach(c => {
    const enrolled    = STUDENTS_DB.filter(s => s.enrolledCourseIds.includes(c.id)).length;
    const topicCount  = allTopics(c.id).length;
    const pendingG    = STUDENTS_DB.flatMap(s =>
      s.assignments.filter(a => a.courseId === c.id && a.submitted && !a.approved)
    ).length;

    grid.innerHTML += `
      <div class="card" style="display:flex;flex-direction:column;gap:0">
        <div style="display:flex;align-items:center;gap:0.85rem;margin-bottom:1rem">
          <div style="width:40px;height:40px;border-radius:var(--radius);
                      background:${c.colorLight};color:${c.color};
                      display:flex;align-items:center;justify-content:center;
                      font-family:var(--font-mono);font-weight:700;flex-shrink:0">${c.icon}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:0.95rem;font-weight:600;color:var(--text-dark)">${c.title}</div>
            <div style="font-size:0.72rem;color:var(--text-light)">${c.subject} · ${c.teacher}</div>
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
        <p style="font-size:0.78rem;color:var(--text-mid);margin-bottom:1rem;line-height:1.5">${c.description}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:auto">
          <button class="btn btn-primary btn-sm" onclick="openCourseEditor(${c.id})">Edit Curriculum</button>
          <a href="students.html" class="btn btn-ghost btn-sm">View Students</a>
          ${pendingG > 0 ? `<a href="grading.html" class="btn btn-outline btn-sm"
            style="color:var(--warning);border-color:var(--warning)">${pendingG} to approve</a>` : ''}
        </div>
      </div>`;
  });
}

let _editorCourseId = null;

function openCourseEditor(cid) {
  _editorCourseId = cid;
  const course = COURSES[cid];
  setText('editor-course-label', course.subject + ' · ' + course.teacher);
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
          <input type="text" value="${week.title}"
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
          <input type="text" value="${topic.title}"
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
            value="${c.url || ''}" placeholder="https://youtube.com/..."
            onchange="updateContentField(${cid},${wi},${ti},${ci},'url',this.value)">
        </div>
        <div class="form-group" style="margin:0.4rem 0 0">
          <label style="font-size:0.72rem">Duration (e.g. 18:30)</label>
          <input type="text" class="form-control" style="font-size:0.78rem;width:120px"
            value="${c.duration || ''}" placeholder="00:00"
            onchange="updateContentField(${cid},${wi},${ti},${ci},'duration',this.value)">
        </div>`;
    } else if (c.type === 'notes') {
      inner = `
        <div class="form-group" style="margin:0">
          <label style="font-size:0.72rem">Notes PDF URL</label>
          <input type="text" class="form-control" style="font-size:0.78rem"
            value="${c.url || ''}" placeholder="https://drive.google.com/..."
            onchange="updateContentField(${cid},${wi},${ti},${ci},'url',this.value)">
        </div>`;
    } else if (c.type === 'assign') {
      inner = `
        <div class="form-group" style="margin:0">
          <label style="font-size:0.72rem">Assignment Instructions</label>
          <textarea class="form-control" style="font-size:0.78rem;min-height:60px"
            onchange="updateContentField(${cid},${wi},${ti},${ci},'detail',this.value)"
            >${c.detail || ''}</textarea>
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
            value="${c.label || ''}" placeholder="PMC Reference"
            onchange="updateContentField(${cid},${wi},${ti},${ci},'label',this.value)">
        </div>
        <div class="form-group" style="margin:0.4rem 0 0">
          <label style="font-size:0.72rem">URL</label>
          <input type="text" class="form-control" style="font-size:0.78rem"
            value="${c.url || ''}" placeholder="https://..."
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

function addContentToTopic(cid, wi, ti, type) {
  const defaults = {
    video:  { type: 'video',  label: 'Recorded Lecture', url: '', duration: '' },
    notes:  { type: 'notes',  label: 'Written Notes',    url: '' },
    quiz:   { type: 'quiz',   label: 'Quiz',             questions: [] },
    assign: { type: 'assign', label: 'Assignment',       detail: '', totalMarks: 10 },
    link:   { type: 'link',   label: 'Reference Link',   url: '' },
  };
  COURSES[cid].weeks[wi].topics[ti].contents.push(defaults[type]);
  renderEditorBody(cid);
  // Re-open the topic editor panel after the re-render collapses everything.
  setTimeout(() => {
    const el = document.getElementById(`topic-edit-${cid}-${wi}-${ti}`);
    if (el) el.style.display = 'block';
  }, 50);
}

function removeContentFromTopic(cid, wi, ti, ci) {
  COURSES[cid].weeks[wi].topics[ti].contents.splice(ci, 1);
  renderEditorBody(cid);
  setTimeout(() => {
    const el = document.getElementById(`topic-edit-${cid}-${wi}-${ti}`);
    if (el) el.style.display = 'block';
  }, 50);
}

function updateContentField(cid, wi, ti, ci, field, value) {
  COURSES[cid].weeks[wi].topics[ti].contents[ci][field] = value;
}

/** Opens a modal for editing a quiz content-item's questions/options/correct-answer. */
function openQuizEditor(cid, wi, ti, ci) {
  const topic   = COURSES[cid].weeks[wi].topics[ti];
  const content = topic.contents[ci];
  const questions = content.questions || [];

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
          value="${q.q || ''}" placeholder="Question text"
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
            value="${opt}" placeholder="Option ${String.fromCharCode(65 + oi)}"
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
          <div style="font-weight:600">${topic.title}</div>
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
  try {
    const updated = await apiFetch(`/courses/${cid}`, {
      method: 'PUT',
      body: JSON.stringify(COURSES[cid]),
    });
    COURSES[cid] = updated;
    document.getElementById('quiz-editor-modal').style.display = 'none';
    renderEditorBody(cid);
    showToast('Quiz saved.');
  } catch (err) {
    showToast(err.message);
  }
}

function updateWeekTitle(cid, wi, val)      { COURSES[cid].weeks[wi].title = val; }
function updateTopicTitle(cid, wi, ti, val) { COURSES[cid].weeks[wi].topics[ti].title = val; }
function updateTopicDue(cid, wi, ti, val)   { COURSES[cid].weeks[wi].topics[ti].dueDate = val; }
function promptAddDue(cid, wi, ti) {
  const val = prompt('Enter due date (YYYY-MM-DD):');
  if (val) { COURSES[cid].weeks[wi].topics[ti].dueDate = val; renderEditorBody(cid); }
}

function addWeekToEditor() {
  const inp = document.getElementById('new-week-title');
  if (!inp || !inp.value.trim()) { showToast('Enter a week title first.'); return; }
  const course = COURSES[_editorCourseId];
  course.weeks.push({ num: course.weeks.length + 1, title: inp.value.trim(), uploadedDate: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), topics: [] });
  inp.value = '';
  renderEditorBody(_editorCourseId);
  showToast('Week added.');
}
function deleteWeek(cid, wi) {
  if (!confirm('Delete this week and all its topics?')) return;
  COURSES[cid].weeks.splice(wi, 1);
  COURSES[cid].weeks.forEach((w, i) => w.num = i + 1); // renumber remaining weeks
  renderEditorBody(cid); showToast('Week removed.');
}
function deleteTopic(cid, wi, ti) {
  if (!confirm('Remove this topic?')) return;
  COURSES[cid].weeks[wi].topics.splice(ti, 1);
  COURSES[cid].weeks[wi].topics.forEach((t, i) => { t.num = COURSES[cid].weeks[wi].num + '.' + (i + 1); }); // renumber
  renderEditorBody(cid); showToast('Topic removed.');
}


async function saveEditorChanges() {
  try {
    const updated = await apiFetch(`/courses/${_editorCourseId}`, {
      method: 'PUT',
      body: JSON.stringify(COURSES[_editorCourseId]),
    });
    COURSES[_editorCourseId] = updated;
    showToast('Curriculum saved.');
    closeCourseEditor();
    if (document.getElementById('teacher-courses-grid')) renderTeacherCourses();
  } catch (err) {
    showToast(err.message);
  }
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
function submitAddTopic() {
  const cid   = parseInt(document.getElementById('add-topic-cid').value);
  const wnum  = parseInt(document.getElementById('add-topic-wnum').value);
  const title = document.getElementById('new-topic-title').value.trim();
  const due   = document.getElementById('new-topic-due').value || null;
  if (!title) { showToast('Enter a topic title.'); return; }
  const week = COURSES[cid].weeks.find(w => w.num === wnum);
  if (!week) return;

  const types = [...document.querySelectorAll('#content-type-checks input:checked')].map(cb => cb.value);
  const ti = week.topics.length + 1;
  const contents = types.map(type => {
    if (type === 'video')  return { type: 'video',  label: 'Recorded Lecture', duration: '—' };
    if (type === 'notes')  return { type: 'notes',  label: 'Written Notes' };
    if (type === 'quiz')   return { type: 'quiz',   label: 'Quiz', questions: [] };
    if (type === 'assign') return { type: 'assign', label: 'Assignment', detail: 'Submit as PDF.' };
    if (type === 'link')   return { type: 'link',   label: 'Reference Link', url: '#' };
    return null;
  }).filter(Boolean);

  week.topics.push({ id: 't' + Date.now(), num: wnum + '.' + ti, title, dueDate: due, contents });
  closeAddTopicModal(); renderEditorBody(cid); showToast('Topic added.');
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
        <div style="font-weight:600;font-size:0.85rem">${s.name}</div>
        <div style="font-size:0.7rem;color:var(--text-light);font-family:var(--font-mono)">${s.batch}</div>
      </td>
      <td style="font-family:var(--font-mono);font-size:0.75rem">${s.rollNo}</td>
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
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:0.75rem;text-align:center"><div style="font-size:1.4rem;font-weight:700;font-family:var(--font-mono)">${assignAv !== null ? assignAv + '%' : '—'}</div><div style="font-size:0.65rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.06em">Assignments</div></div>
      <div style="background:var(--bg);border:1px solid var(--border);border-radius:var(--radius);padding:0.75rem;text-align:center"><div style="font-size:1.4rem;font-weight:700;font-family:var(--font-mono)">${s.assignments.filter(a => a.submitted).length}/${s.assignments.length}</div><div style="font-size:0.65rem;color:var(--text-light);text-transform:uppercase;letter-spacing:0.06em">Submitted</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:1.25rem;font-size:0.82rem">
      <div style="color:var(--text-mid)">Roll No</div><div style="font-family:var(--font-mono)">${s.rollNo}</div>
      <div style="color:var(--text-mid)">Batch</div><div>${s.batch}</div>
      <div style="color:var(--text-mid)">Entry Test</div><div>${s.entryTest}</div>
      <div style="color:var(--text-mid)">City</div><div>${s.city}</div>
      <div style="color:var(--text-mid)">Email</div><div style="font-family:var(--font-mono);font-size:0.75rem">${s.email}</div>
      <div style="color:var(--text-mid)">Fee Status</div><div><span class="badge ${s.feeStatus === 'Paid' ? 'badge-green' : s.feeStatus === 'Partially Paid' ? 'badge-orange' : 'badge-red'}">${s.feeStatus}</span></div>
    </div>
    <div style="margin-bottom:1rem">
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-light);margin-bottom:0.5rem">Assignments</div>
      ${s.assignments.map(a => `
        <div style="display:flex;align-items:center;gap:0.75rem;padding:0.5rem 0;border-bottom:1px solid var(--border);font-size:0.82rem">
          <div style="flex:1"><div style="font-weight:500">${a.title}</div><div style="font-size:0.72rem;color:var(--text-light)">${a.course}</div></div>
          ${a.submitted ? (a.grade ? `<span class="badge badge-green" style="font-family:var(--font-mono)">${a.marks}/${a.totalMarks} · ${a.grade}</span>` : `<span class="badge badge-orange">Needs grading</span>`) : `<span class="badge badge-red">Not submitted</span>`}
          ${a.submitted && !a.grade ? `<button class="btn btn-outline btn-sm" onclick="closeStudentDetail();openGradeModal('${s.id}','${a.id}','assign')">Grade</button>` : ''}
        </div>`).join('')}
    </div>
    <div>
      <div style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-light);margin-bottom:0.5rem">Quiz History</div>
      ${s.quizScores.map(q => {
        const pct = Math.round(q.score / q.total * 100);
        return `<div style="display:flex;align-items:center;gap:0.75rem;padding:0.45rem 0;border-bottom:1px solid var(--border);font-size:0.82rem">
          <div style="flex:1"><div style="font-weight:500">${q.topic}</div><div style="font-size:0.72rem;color:var(--text-light)">${q.subject} · ${q.date}</div></div>
          <span style="font-family:var(--font-mono);font-weight:600;color:${pct >= 70 ? 'var(--success)' : 'var(--danger)'}">${q.score}/${q.total}</span>
        </div>`;
      }).join('')}
    </div>`;
  document.getElementById('student-detail-modal').style.display = 'flex';
}
function closeStudentDetail() { document.getElementById('student-detail-modal').style.display = 'none'; }

/** Populates the course-filter dropdown on the Grading page (once), then renders the grading list. */
function initGrading() {

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
            Change a threshold and click Apply — all auto-grades update instantly.
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
    const autoGrade = pct !== null ? calcGradeFromThreshold(pct) : '—';
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
          <div style="font-weight:600;font-size:0.88rem">${item.title || item.topic}</div>
          <div style="font-size:0.75rem;color:var(--text-light)">
            ${item.studentName} · ${item.course}
            ${isAssign && item.submittedOn ? ` · Submitted ${item.submittedOn}` : ''}
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
              onclick="openGradeModal('${item.studentId}','${item.id}','assign')">
              ${approved ? 'Edit' : 'Review'}
            </button>
            ${!approved ? `
              <button class="btn btn-primary btn-sm"
                onclick="approveGrade('${item.studentId}','${item.id}')">
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
  setText('gm-title',        item.title || item.topic || '—');
  setText('gm-student-name', student.name);
  setText('gm-submitted-on', type === 'assign' ? (item.submittedOn || '—') : (item.date || '—'));
  setText('gm-course-name',  item.course || '—');

  // --- NEW SUBMISSION DISPLAY CODE ---
  const FILE_BASE = API_BASE.replace('/api', '');
  const subEl = document.getElementById('gm-submission-content');
  if (subEl) {
    if (type === 'assign') {
      let html = '';
      if (item.answerText) html += `<div style="margin-bottom:6px"><strong>Answer:</strong> ${item.answerText}</div>`;
      if (item.fileUrl) html += `<div><strong>File:</strong> <a href="${FILE_BASE}${item.fileUrl}" target="_blank">${item.fileName || 'Download attachment'}</a></div>`;
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
  document.getElementById('grade-modal').style.display = 'flex';
}
function closeGradeModal() { document.getElementById('grade-modal').style.display = 'none'; }

/** Validates and saves the grade-entry modal's values back to the student's assignment/quiz record. */
async function submitGrade() {
  const studentId = document.getElementById('gm-student-id').value;
  const itemId    = document.getElementById('gm-item-id').value;
  const type      = document.getElementById('gm-item-type').value;
  const marks     = parseFloat(document.getElementById('gm-marks').value);
  const total     = parseFloat(document.getElementById('gm-total').value);
  const gradeLtr  = document.getElementById('gm-grade-letter').value;
  const feedback  = document.getElementById('gm-feedback').value.trim();

  if (isNaN(marks) || isNaN(total) || total <= 0) { showToast('Enter valid marks.'); return; }
  if (marks > total) { showToast('Marks cannot exceed total.'); return; }

  const student = STUDENTS_DB.find(s => s.id === studentId);
  if (!student) return;
  const pct = Math.round(marks / total * 100);
  const computedGrade = gradeLtr || calcGradeLetter(pct);

  try {
    if (type === 'assign') {
      const updated = await apiFetch(`/students/${studentId}/assignments/${itemId}/grade`, {
        method: 'PATCH',
        body: JSON.stringify({ marks, totalMarks: total, grade: computedGrade, feedback }),
      });
      const item = student.assignments.find(a => a.id === itemId);
      if (item) Object.assign(item, updated);
    } else {
      const updated = await apiFetch(`/students/${studentId}/quiz-scores/${itemId}/grade`, {
        method: 'PATCH',
        body: JSON.stringify({ score: marks, feedback }),
      });
      const item = student.quizScores.find(q => q.id === itemId);
      if (item) Object.assign(item, updated);
    }

    closeGradeModal();
    showToast('Grade published: ' + computedGrade);
    if (document.getElementById('grading-container')) renderGrading();
    if (document.getElementById('students-tbody')) refreshStudentTable();
  } catch (err) {
    showToast(err.message);
  }
}

/** Renders the teacher's weekly schedule grid (one column per day, editable classes). */
function renderTeacherSchedule() {
  const grid = document.getElementById('teacher-schedule-grid');
  if (!grid) return;
  grid.innerHTML = '';
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });



  days.forEach(day => {
    const classes = TEACHER_SCHEDULE.map((r, i) => ({ ...r, _idx: i })).filter(r => r.day === day);
    const isToday = day === today;
    const rows = classes.length ? classes.map(r => `
      <div class="day-class" style="cursor:pointer" onclick="editClass(${r._idx})">
        <div class="class-time">${r.time}</div>
        <div class="class-info" style="flex:1"><h4>${r.subject} <span class="badge ${r.type === 'online' ? 'badge-blue' : 'badge-green'}">${r.type}</span></h4><p>${r.room} · ${r.duration}min</p></div>
        <span style="font-size:0.7rem;color:var(--text-light);font-family:var(--font-mono)">edit</span>
      </div>`).join('') : '<p style="color:var(--text-light);font-size:0.78rem;padding:0.85rem 0.9rem">No classes.</p>';
    grid.innerHTML += `<div class="day-card"><div class="day-card-head ${isToday ? 'today' : ''}">${day}${isToday ? ' — Today' : ''}</div>${rows}</div>`;
  });
}

function openAddClassModal() {
  document.getElementById('acm-title').textContent = 'Add Class';
  document.getElementById('acm-edit-index').value  = '';
  document.getElementById('acm-time').value = '09:00';
  document.getElementById('acm-room').value = '';
  document.getElementById('acm-duration').value = '90';
  document.getElementById('acm-delete-btn').style.display = 'none';
  document.getElementById('add-class-modal').style.display = 'flex';
}
function closeAddClassModal() { document.getElementById('add-class-modal').style.display = 'none'; }
function editClass(idx) {
  const r = TEACHER_SCHEDULE[idx];
  document.getElementById('acm-title').textContent = 'Edit Class';
  document.getElementById('acm-edit-index').value  = idx;
  document.getElementById('acm-day').value         = r.day;
  document.getElementById('acm-time').value        = r.time;
  document.getElementById('acm-type').value        = r.type;
  document.getElementById('acm-room').value        = r.room;
  document.getElementById('acm-duration').value    = r.duration;
  document.getElementById('acm-delete-btn').style.display = 'inline-flex';
  toggleRoomField();
  document.getElementById('add-class-modal').style.display = 'flex';
}
function toggleRoomField() {
  const type = document.getElementById('acm-type')?.value;
  const label = document.getElementById('acm-room-label');
  if (label) label.textContent = type === 'online' ? 'Meeting Link / Platform' : 'Room / Hall';
}

async function submitAddClass() {
  const idx = document.getElementById('acm-edit-index').value;
  const course = document.getElementById('acm-course').value;
  const day = document.getElementById('acm-day').value;
  const time = document.getElementById('acm-time').value;
  const type = document.getElementById('acm-type').value;
  const room = document.getElementById('acm-room').value.trim() || (type === 'online' ? 'Zoom' : 'Hall A');
  const duration = parseInt(document.getElementById('acm-duration').value) || 90;
  const c = Object.values(COURSES).find(c => c.title === course);
  const subject = c ? c.subject : course;
  const payload = { day, time, subject, course, type, room, duration };

  try {
    let shouldNotify = true;
    if (idx !== '') {
      const existing = TEACHER_SCHEDULE[parseInt(idx)];
      shouldNotify = existing.day !== payload.day || existing.time !== payload.time ||
        existing.type !== payload.type || existing.room !== payload.room ||
        existing.duration !== payload.duration || existing.course !== payload.course;
      const updated = await apiFetch(`/schedule/${existing._id}`, { method: 'PUT', body: JSON.stringify(payload) });
      TEACHER_SCHEDULE[parseInt(idx)] = updated;
    } else {
      const created = await apiFetch('/schedule', { method: 'POST', body: JSON.stringify(payload) });
      TEACHER_SCHEDULE.push(created);
    }
    closeAddClassModal();
    renderTeacherSchedule();

    if (shouldNotify) {
      try {
        const notif = await apiFetch('/notifications', {
          method: 'POST',
          body: JSON.stringify({ type: 'schedule', title: 'Schedule updated', body: `${subject} class on ${day} at ${time} has been updated.` }),
        });
        NOTIFICATIONS.unshift(notif);
        renderNotifBell();
      } catch (err) { console.error('Failed to create notification:', err.message); }
    }
    showToast('Schedule updated.');
  } catch (err) {
    showToast(err.message);
  }
}


async function deleteClass() {
  const idx = parseInt(document.getElementById('acm-edit-index').value);
  if (isNaN(idx)) return;
  if (!confirm('Remove this class?')) return;

  const existing = TEACHER_SCHEDULE[idx];
  try {
    await apiFetch(`/schedule/${existing._id}`, { method: 'DELETE' });
    TEACHER_SCHEDULE.splice(idx, 1);
    closeAddClassModal();
    renderTeacherSchedule();
    showToast('Class removed.');
  } catch (err) {
    showToast(err.message);
  }
}

// ══════════════════════════════════════════════════
//   20. ADMIN PAGES — full CRUD over students, teachers, batches, entry tests
// ══════════════════════════════════════════════════

/** Renders the admin Students table, applying the search box + batch/fee filters. */
function renderAdminStudents() {
  const tbody   = document.getElementById('admin-students-tbody');
  const countEl = document.getElementById('admin-student-count');
  const search  = (document.getElementById('admin-student-search')?.value || '').toLowerCase();
  const batchF  = document.getElementById('admin-batch-filter')?.value || 'all';
  const feeF    = document.getElementById('admin-fee-filter')?.value   || 'all';
  if (!tbody) return;

  let students = STUDENTS_DB;
  if (search)          students = students.filter(s => s.name.toLowerCase().includes(search) || s.rollNo.toLowerCase().includes(search) || s.email.toLowerCase().includes(search));
  if (batchF !== 'all') students = students.filter(s => s.batch === batchF);
  if (feeF   !== 'all') students = students.filter(s => s.feeStatus === feeF);

  if (countEl) countEl.textContent = students.length + ' student' + (students.length !== 1 ? 's' : '');
  tbody.innerHTML = '';
  if (!students.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-light);padding:2rem;font-size:0.82rem">No students found.</td></tr>'; return; }

  students.forEach(s => {
    const attColor = s.attendance >= 85 ? 'var(--success)' : s.attendance >= 75 ? 'var(--warning)' : 'var(--danger)';
    tbody.innerHTML += `<tr>
      <td><div style="font-weight:600">${s.name}</div><div style="font-size:0.72rem;color:var(--text-light);font-family:var(--font-mono)">${s.email}</div></td>
      <td style="font-family:var(--font-mono);font-size:0.76rem">${s.rollNo}</td>
      <td>${s.batch}</td>
      <td><span class="badge badge-blue" style="font-family:var(--font-mono)">${s.entryTest}</span></td>
      <td><span style="font-family:var(--font-mono);font-weight:600;color:${attColor}">${s.attendance}%</span></td>
      <td><span class="badge ${s.feeStatus === 'Paid' ? 'badge-green' : s.feeStatus === 'Partially Paid' ? 'badge-orange' : 'badge-red'}">${s.feeStatus}</span></td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openAdminStudentModal('${s.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteStudent('${s.id}')">Remove</button>
      </td>
    </tr>`;
  });
}

/** Opens the admin Add/Edit Student modal, pre-filled if `sid` is given. */
function openAdminStudentModal(sid) {
  const titleEl = document.getElementById('asm-modal-title');
  const delBtn  = document.getElementById('asm-delete-btn');
  const etSel   = document.getElementById('asm-entry-test');
  const bSel    = document.getElementById('asm-batch');
  etSel.innerHTML = ''; ENTRY_TESTS.forEach(t => { const o = document.createElement('option'); o.value = t.name; o.textContent = t.name; etSel.appendChild(o); });
  bSel.innerHTML  = ''; BATCHES.forEach(b => { const o = document.createElement('option'); o.value = b.name; o.textContent = b.name; bSel.appendChild(o); });

  if (sid) {
    const s = STUDENTS_DB.find(st => st.id === sid); if (!s) return;
    titleEl.textContent = 'Edit Student'; delBtn.style.display = 'inline-flex';
    document.getElementById('asm-id').value          = s.id;
    document.getElementById('asm-name').value        = s.name;
    document.getElementById('asm-roll').value        = s.rollNo;
    document.getElementById('asm-email').value       = s.email;
    document.getElementById('asm-phone').value       = s.phone;
    document.getElementById('asm-city').value        = s.city;
    document.getElementById('asm-entry-test').value  = s.entryTest;
    document.getElementById('asm-batch').value       = s.batch;
    document.getElementById('asm-fee-status').value  = s.feeStatus;
    document.getElementById('asm-total-fee').value   = s.totalFee;
    document.getElementById('asm-paid-amount').value = s.paidAmount;
    document.getElementById('asm-attendance').value  = s.attendance;
  } else {
    titleEl.textContent = 'Add Student'; delBtn.style.display = 'none';
    ['asm-id', 'asm-name', 'asm-roll', 'asm-email', 'asm-phone', 'asm-city'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('asm-fee-status').value  = 'Unpaid';
    document.getElementById('asm-total-fee').value   = '';
    document.getElementById('asm-paid-amount').value = '0';
    document.getElementById('asm-attendance').value  = '85';
  }
  document.getElementById('admin-student-modal').style.display = 'flex';
}
function closeAdminStudentModal() { document.getElementById('admin-student-modal').style.display = 'none'; }

/** Creates or updates a student from the admin modal's fields. New students get empty course/grade data — enroll them via a batch afterwards. */
async function saveAdminStudent() {
  const id         = document.getElementById('asm-id').value;
  const name       = document.getElementById('asm-name').value.trim();
  const rollNo     = document.getElementById('asm-roll').value.trim();
  const email      = document.getElementById('asm-email').value.trim();
  const phone      = document.getElementById('asm-phone').value.trim();
  const city       = document.getElementById('asm-city').value.trim();
  const entryTest  = document.getElementById('asm-entry-test').value;
  const batch      = document.getElementById('asm-batch').value;
  const feeStatus  = document.getElementById('asm-fee-status').value;
  const totalFee   = parseInt(document.getElementById('asm-total-fee').value) || 0;
  const paidAmount = parseInt(document.getElementById('asm-paid-amount').value) || 0;
  const attendance = parseInt(document.getElementById('asm-attendance').value) || 85;

  if (!name || !email) { showToast('Name and email are required.'); return; }

  const payload = { name, rollNo, email, phone, city, entryTest, batch, feeStatus, totalFee, paidAmount, attendance };

  try {
    if (id) {
      const updated = await apiFetch(`/students/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const idx = STUDENTS_DB.findIndex(s => s.id === id);
      if (idx !== -1) STUDENTS_DB[idx] = updated;
    } else {
      // CREATE — POST to /students
      const created = await apiFetch('/students', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      STUDENTS_DB.push(created.student);
    }
    closeAdminStudentModal();
    renderAdminStudents();
    showToast(created.tempPassword ? `Student added. Temp password: ${created.tempPassword}` : 'Student added.');
  } catch (err) {
    showToast(err.message);
  }
}

function deleteCurrentStudent() { const id = document.getElementById('asm-id').value; if (id) deleteStudent(id); }
async function deleteStudent(sid) {
  if (!confirm('Remove this student?')) return;
  try {
    await apiFetch(`/students/${sid}`, { method: 'DELETE' });
    const idx = STUDENTS_DB.findIndex(s => s.id === sid);
    if (idx !== -1) STUDENTS_DB.splice(idx, 1);
    closeAdminStudentModal();
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
    const totalC   = TEACHERS_DB.reduce((a, t) => a + t.courseIds.length, 0);
    statsEl.innerHTML =
      `<div class="stat-card"><div class="stat-icon si-navy" style="font-family:var(--font-mono);font-weight:700">T</div><div class="stat-info"><div class="sv">${TEACHERS_DB.length}</div><div class="sl">Total Teachers</div></div></div>` +
      `<div class="stat-card"><div class="stat-icon si-green" style="font-family:var(--font-mono);font-weight:700">A</div><div class="stat-info"><div class="sv">${active}</div><div class="sl">Active</div></div></div>` +
      `<div class="stat-card"><div class="stat-icon si-orange" style="font-family:var(--font-mono);font-weight:700">I</div><div class="stat-info"><div class="sv">${inactive}</div><div class="sl">Inactive</div></div></div>` +
      `<div class="stat-card"><div class="stat-icon si-blue" style="font-family:var(--font-mono);font-weight:700">C</div><div class="stat-info"><div class="sv">${totalC}</div><div class="sl">Total Courses</div></div></div>`;
  }

  const tbody  = document.getElementById('admin-teachers-tbody');
  const search = (document.getElementById('teacher-search')?.value || '').toLowerCase();
  if (!tbody) return;

  let teachers = TEACHERS_DB;
  if (search) teachers = teachers.filter(t => t.name.toLowerCase().includes(search) || t.subject.toLowerCase().includes(search));
  tbody.innerHTML = '';
  if (!teachers.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-light);padding:2rem;font-size:0.82rem">No teachers found.</td></tr>'; return; }

  teachers.forEach(t => {
    const courseNames = t.courseIds.map(cid => COURSES[cid]?.subject || '?').join(', ') || '—';
    tbody.innerHTML += `<tr>
      <td><div style="font-weight:600">${t.name}</div><div style="font-size:0.72rem;color:var(--text-light);font-family:var(--font-mono)">${t.email}</div></td>
      <td>${t.subject}</td>
      <td style="font-family:var(--font-mono);font-size:0.76rem">${t.phone}</td>
      <td style="font-size:0.78rem;color:var(--text-mid)">${courseNames}</td>
      <td><span class="badge ${t.status === 'active' ? 'badge-green' : 'badge-orange'}">${t.status}</span></td>
      <td style="font-family:var(--font-mono);font-size:0.76rem">${t.joinDate}</td>
      <td>
        <button class="btn btn-ghost btn-sm" onclick="openAdminTeacherModal('${t.id}')">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteTeacher('${t.id}')">Remove</button>
      </td>
    </tr>`;
  });
}

function openAdminTeacherModal(tid) {
  const titleEl = document.getElementById('atm-modal-title');
  const delBtn  = document.getElementById('atm-delete-btn');
  if (tid) {
    const t = TEACHERS_DB.find(x => x.id === tid); if (!t) return;
    titleEl.textContent = 'Edit Teacher'; delBtn.style.display = 'inline-flex';
    document.getElementById('atm-id').value      = t.id;
    document.getElementById('atm-name').value    = t.name;
    document.getElementById('atm-email').value   = t.email;
    document.getElementById('atm-phone').value   = t.phone;
    document.getElementById('atm-subject').value = t.subject;
    document.getElementById('atm-status').value  = t.status;
  } else {
    titleEl.textContent = 'Add Teacher'; delBtn.style.display = 'none';
    ['atm-id', 'atm-name', 'atm-email', 'atm-phone', 'atm-subject'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('atm-status').value = 'active';
  }
  document.getElementById('admin-teacher-modal').style.display = 'flex';
}
function closeAdminTeacherModal() { document.getElementById('admin-teacher-modal').style.display = 'none'; }

// NEW
async function saveAdminTeacher() {
  const id      = document.getElementById('atm-id').value;
  const name    = document.getElementById('atm-name').value.trim();
  const email   = document.getElementById('atm-email').value.trim();
  const phone   = document.getElementById('atm-phone').value.trim();
  const subject = document.getElementById('atm-subject').value.trim();
  const status  = document.getElementById('atm-status').value;
  if (!name || !email) { showToast('Name and email are required.'); return; }

  const payload = { name, email, phone, subject, status };

  try {
    if (id) {
      const updated = await apiFetch(`/teachers/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      const idx = TEACHERS_DB.findIndex(t => t.id === id);
      if (idx !== -1) TEACHERS_DB[idx] = updated;
    } else {
      const created = await apiFetch('/teachers', { method: 'POST', body: JSON.stringify(payload) });
      TEACHERS_DB.push(created.teacher);
    }
    closeAdminTeacherModal();
    renderAdminTeachers();
    showToast(created.tempPassword ? `Teacher added. Temp password: ${created.tempPassword}` : 'Teacher added.');
  } catch (err) {
    showToast(err.message);
  }
}


function deleteCurrentTeacher() { const id = document.getElementById('atm-id').value; if (id) deleteTeacher(id); }

async function deleteTeacher(tid) {
  if (!confirm('Remove this teacher?')) return;
  try {
    await apiFetch(`/teachers/${tid}`, { method: 'DELETE' });
    const idx = TEACHERS_DB.findIndex(t => t.id === tid);
    if (idx !== -1) TEACHERS_DB.splice(idx, 1);
    closeAdminTeacherModal();
    renderAdminTeachers();
    showToast('Teacher removed.');
  } catch (err) {
    showToast(err.message);
  }
}

// ──────────────────────────────────────────────────
// ADMIN — ENTRY TEST MANAGEMENT
// ──────────────────────────────────────────────────
function renderAdminTests() {
  if (!document.getElementById('admin-tests-container')) return;
  renderTestTags();
}

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
        <h3 style="font-size:1rem;font-weight:600">${test.name} — Subjects</h3>
        <button onclick="closeEditTestSubjects()" style="background:none;border:none;font-size:1.25rem;cursor:pointer;color:var(--text-light)">&#215;</button>
      </div>
      <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem">
        <input type="text" class="form-control" id="edit-test-subject-inp" placeholder="Add subject..." style="flex:1">
        <button class="btn btn-outline btn-sm" onclick="addSubjectToEditTest()">Add</button>
      </div>
      <div id="edit-test-subjects-list" style="display:flex;flex-wrap:wrap;gap:6px;min-height:36px;padding:8px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg);margin-bottom:1rem"></div>
      <div style="display:flex;gap:0.65rem;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" onclick="closeEditTestSubjects()">Cancel</button>
        <button class="btn btn-primary btn-sm" onclick="saveEditTestSubjects()">Save</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
  renderEditTestSubjectTags();
  document.getElementById('edit-test-subject-inp').focus();
}

function addSubjectToEditTest() {
  const inp = document.getElementById('edit-test-subject-inp');
  if (!inp || !inp.value.trim()) return;
  const sub = inp.value.trim();
  if (!window._editTestSubjects.includes(sub)) {
    window._editTestSubjects.push(sub);
    renderEditTestSubjectTags();
  }
  inp.value = ''; inp.focus();
}
function removeEditTestSubject(sub) {
  window._editTestSubjects = window._editTestSubjects.filter(s => s !== sub);
  renderEditTestSubjectTags();
}
function renderEditTestSubjectTags() {
  const el = document.getElementById('edit-test-subjects-list');
  if (!el) return;
  el.innerHTML = window._editTestSubjects.map(s => `
    <span style="display:inline-flex;align-items:center;gap:4px;background:var(--blue-pale);color:var(--navy);font-size:0.72rem;padding:2px 8px;border-radius:20px;font-weight:500">
      ${s}
      <button onclick="removeEditTestSubject('${s}')" style="background:none;border:none;cursor:pointer;color:var(--text-light);font-size:0.8rem;line-height:1;padding:0">&#215;</button>
    </span>`).join('');
}

async function saveEditTestSubjects() {
  const test = ENTRY_TESTS.find(t => t.id === window._editingTestId);
  if (!test) { closeEditTestSubjects(); return; }

  try {
    const updated = await apiFetch(`/tests/${test.id}`, {
      method: 'PUT',
      body: JSON.stringify({ subjects: [...window._editTestSubjects] }),
    });
    const idx = ENTRY_TESTS.findIndex(t => t.id === test.id);
    if (idx !== -1) ENTRY_TESTS[idx] = updated;
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

/** Renders both the small tag-list summary and the full entry-tests table on the admin Tests page. */
function renderTestTags() {
  const el = document.getElementById('test-tag-list');
  if (!el) return;
  el.innerHTML = ENTRY_TESTS.map(t => `
    <div class="tag-item" id="tag-${t.id}">
      <span style="width:7px;height:7px;border-radius:50%;background:${t.color};flex-shrink:0"></span>
      ${t.name}
      <button onclick="removeTest('${t.id}')" title="Remove">&#215;</button>
    </div>`).join('');

  const tbody = document.getElementById('tests-tbody');
  if (tbody) tbody.innerHTML = ENTRY_TESTS.map((t, i) => `<tr>
    <td style="font-family:var(--font-mono)">${i + 1}</td>
    <td><strong>${t.name}</strong><div style="font-size:0.7rem;color:var(--text-light)">${t.desc}</div></td>
    <td>
      <div style="display:flex;flex-wrap:wrap;gap:3px">
        ${(t.subjects || []).map(s => `<span class="badge badge-blue" style="font-size:0.65rem">${s}</span>`).join('')}
        <button onclick="openEditTestSubjects('${t.id}')" style="background:none;border:1px dashed var(--border);border-radius:3px;font-size:0.65rem;padding:1px 6px;cursor:pointer;color:var(--text-light)">edit</button>
      </div>
    </td>
    <td><span class="badge" style="background:${t.color}22;color:${t.color}">${t.name}</span></td>
    <td><button class="btn btn-danger btn-sm" onclick="removeTest('${t.id}')">Remove</button></td>
  </tr>`).join('');
}


async function addTest() {
  const nameEl = document.getElementById('new-test-name');
  const descEl = document.getElementById('new-test-desc');
  if (!nameEl || !nameEl.value.trim()) { showToast('Enter a program name.'); return; }
  if (!window._newTestSubjects || !window._newTestSubjects.length) { showToast('Add at least one subject.'); return; }

  const colors = ['#1B5FAD', '#0E8A5F', '#C47C08', '#7c3aed', '#C0392B', '#0369A1'];
  const payload = {
    name: nameEl.value.trim().toUpperCase(),
    color: colors[ENTRY_TESTS.length % colors.length],
    desc: descEl?.value.trim() || 'Entry test preparation program',
    subjects: [...window._newTestSubjects],
  };

  try {
    const created = await apiFetch('/tests', { method: 'POST', body: JSON.stringify(payload) });
    ENTRY_TESTS.push(created);
    renderTestTags();
    nameEl.value = '';
    if (descEl) descEl.value = '';
    window._newTestSubjects = [];
    const sl = document.getElementById('new-test-subjects-list');
    if (sl) sl.innerHTML = '';
    showToast('Entry test "' + created.name + '" added.');
  } catch (err) {
    showToast(err.message);
  }
}



async function removeTest(id) {
  if (!confirm('Remove this entry test?')) return;
  try {
    await apiFetch(`/tests/${id}`, { method: 'DELETE' });
    ENTRY_TESTS = ENTRY_TESTS.filter(t => t.id !== id);
    renderTestTags();
    showToast('Test removed.');
  } catch (err) {
    showToast(err.message);
  }
}

// ──────────────────────────────────────────────────
// 21. LOGIN
// ──────────────────────────────────────────────────
function setupLogin() {
  const form = document.getElementById('login-form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('email').value.trim().toLowerCase();
    const pass  = document.getElementById('password').value;
    const errEl = document.getElementById('login-error');

    try {
      const data = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password: pass }),
      });
      saveSession(data.token, data.user);
      const redirects = { student: 'Student/dashboard.html', teacher: 'Teacher/dashboard.html', admin: 'Admin/index.html' };
      window.location.href = redirects[data.user.role] || 'index.html';
    } catch (err) {
      if (errEl) errEl.textContent = err.message || 'Invalid email or password.';
    }
  });
  const passInput = document.getElementById('password');
  if (passInput) passInput.addEventListener('keydown', e => { if (e.key === 'Enter') form.dispatchEvent(new Event('submit')); });
}

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

  const testId   = document.getElementById('abm-entry-test')?.value;
  const test     = ENTRY_TESTS.find(t => t.id === testId);
  const subjects = test?.subjects || [];

  if (!subjects.length) {
    slots.innerHTML = '<div style="padding:0.75rem;font-size:0.78rem;color:var(--text-light)">No subjects defined for this entry test. Add subjects in Entry Tests first.</div>';
    return;
  }

  slots.innerHTML = subjects.map((sub, i) => {
    const teachers = TEACHERS_DB.filter(t => t.status === 'active' && (t.subjects || []).includes(sub));
    const borderTop = i > 0 ? 'border-top:1px solid var(--border);' : '';
    return `
      <div style="display:grid;grid-template-columns:120px 1fr;align-items:center;gap:0.75rem;padding:0.6rem 0.85rem;${borderTop}background:var(--white)">
        <div style="font-size:0.82rem;font-weight:600;color:var(--text-dark)">${sub}</div>
        <select class="form-control" id="slot-${sub.replace(/\s+/g, '_')}" style="height:34px;font-size:0.82rem">
          <option value="">— Select teacher —</option>
          ${teachers.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
        </select>
      </div>`;
  }).join('');
}

// ──────────────────────────────────────────────────
// ADMIN SPA ROUTER
//    The Admin area is a single HTML shell (`page-content` div) that swaps
//    its contents based on `location.hash`. Each route below defines the
//    HTML to inject and a `render()` function to populate it with data.
// ──────────────────────────────────────────────────
const ADMIN_ROUTES = {
  dashboard: {
    title: 'Dashboard',
    html: () => `
      <div class="page-header"><h1>Overview</h1><p>Academy-wide summary and recent activity.</p></div>
      <div id="admin-overview" class="stats-row" style="margin-bottom:1.5rem"></div>
      <div class="grid-2" style="gap:1.25rem">
        <div class="manage-table-card">
          <div class="manage-table-head">
            <h3>Recent Students</h3>
            <a href="#students" class="btn btn-ghost btn-sm" onclick="navigateTo('#students')">View All</a>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Name</th><th>Roll No</th><th>Batch</th><th>Fee Status</th></tr></thead>
              <tbody id="admin-recent-students"></tbody>
            </table>
          </div>
        </div>
        <div class="manage-table-card">
          <div class="manage-table-head">
            <h3>Batch Summary</h3>
            <a href="#batches" class="btn btn-ghost btn-sm" onclick="navigateTo('#batches')">Manage</a>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Batch</th><th>Test</th><th>Students</th><th>Status</th></tr></thead>
              <tbody id="admin-batch-summary"></tbody>
            </table>
          </div>
        </div>
      </div>`,
    render: () => {
      const mk = (ic, letter, val, label) =>
        `<div class="stat-card">
          <div class="stat-icon ${ic}" style="font-family:var(--font-mono);font-weight:700">${letter}</div>
          <div class="stat-info"><div class="sv">${val}</div><div class="sl">${label}</div></div>
        </div>`;

      const overviewEl = document.getElementById('admin-overview');
      if (overviewEl) {
        overviewEl.innerHTML =
          mk('si-blue',  'S', STUDENTS_DB.length, 'Total Students') +
          mk('si-navy',  'T', TEACHERS_DB.length, 'Teachers') +
          mk('si-green', 'B', BATCHES.filter(b => b.status === 'active').length, 'Active Batches') +
          mk('si-blue',  'C', Object.keys(COURSES).length, 'Courses') +
          mk('si-red',   'F', STUDENTS_DB.filter(s => s.feeStatus !== 'Paid').length, 'Fee Pending') +
          mk('si-orange','G', STUDENTS_DB.flatMap(s => s.assignments.filter(a => a.submitted && !a.approved)).length, 'Pending Approvals');
      }

      const rsEl = document.getElementById('admin-recent-students');
      if (rsEl) {
        rsEl.innerHTML = !STUDENTS_DB.length
          ? '<tr><td colspan="4" style="text-align:center;color:var(--text-light);padding:1.5rem;font-size:0.82rem">No students enrolled yet.</td></tr>'
          : STUDENTS_DB.slice(0, 5).map(s => `
            <tr>
              <td>
                <div style="font-weight:600">${s.name}</div>
                <div style="font-size:0.7rem;color:var(--text-light);font-family:var(--font-mono)">${s.email}</div>
              </td>
              <td style="font-family:var(--font-mono);font-size:0.76rem">${s.rollNo}</td>
              <td>${s.batch}</td>
              <td><span class="badge ${s.feeStatus === 'Paid' ? 'badge-green' : s.feeStatus === 'Partially Paid' ? 'badge-orange' : 'badge-red'}">${s.feeStatus}</span></td>
            </tr>`).join('');
      }

      const bsEl = document.getElementById('admin-batch-summary');
      if (bsEl) {
        bsEl.innerHTML = !BATCHES.length
          ? '<tr><td colspan="4" style="text-align:center;color:var(--text-light);padding:1.5rem;font-size:0.82rem">No batches created yet.</td></tr>'
          : BATCHES.map(b => `
            <tr>
              <td><strong>${b.name}</strong></td>
              <td><span class="badge badge-blue" style="font-family:var(--font-mono)">${b.entryTest}</span></td>
              <td style="font-family:var(--font-mono)">${b.studentIds.length}</td>
              <td><span class="badge ${b.status === 'active' ? 'badge-green' : 'badge-orange'}">${b.status}</span></td>
            </tr>`).join('');
      }
    }
  },

  students: {
    title: 'Students',
    topbarAction: () => `<button class="btn btn-primary btn-sm" onclick="openAdminStudentModal(null)">Add Student</button>`,
    html: () => `
      <div class="page-header"><h1>Student Management</h1><p>Enroll, edit, and manage all students across batches.</p></div>
      <div class="card" style="margin-bottom:1.25rem">
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:flex-end">
          <div style="flex:1;min-width:200px">
            <label style="display:block;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-mid);margin-bottom:0.3rem">Search</label>
            <input type="text" class="form-control" id="admin-student-search" placeholder="Name, roll no, email..." oninput="renderAdminStudents()" style="height:36px">
          </div>
          <div style="min-width:160px">
            <label style="display:block;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-mid);margin-bottom:0.3rem">Batch</label>
            <select class="form-control" id="admin-batch-filter" onchange="renderAdminStudents()" style="height:36px">
              <option value="all">All Batches</option>
              ${BATCHES.map(b => `<option value="${b.name}">${b.name}</option>`).join('')}
            </select>
          </div>
          <div style="min-width:160px">
            <label style="display:block;font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-mid);margin-bottom:0.3rem">Fee Status</label>
            <select class="form-control" id="admin-fee-filter" onchange="renderAdminStudents()" style="height:36px">
              <option value="all">All Statuses</option>
              <option value="Paid">Paid</option>
              <option value="Partially Paid">Partially Paid</option>
              <option value="Unpaid">Unpaid</option>
            </select>
          </div>
        </div>
      </div>
      <div class="manage-table-card">
        <div class="manage-table-head"><h3>All Students <span id="admin-student-count" style="font-family:var(--font-mono);font-weight:400;color:var(--text-light);font-size:0.72rem"></span></h3></div>
        <div class="table-wrap"><table><thead><tr><th>Student</th><th>Roll No</th><th>Batch</th><th>Entry Test</th><th>Attendance</th><th>Fee Status</th><th>Actions</th></tr></thead><tbody id="admin-students-tbody"></tbody></table></div>
      </div>
      <div class="modal-overlay" id="admin-student-modal" style="display:none">
        <div class="modal-box">
          <div class="modal-header"><h3 id="asm-modal-title">Add Student</h3><button class="modal-close" onclick="closeAdminStudentModal()">&#215;</button></div>
          <input type="hidden" id="asm-id">
          <div class="grid-2">
            <div class="form-group"><label>Full Name</label><input type="text" class="form-control" id="asm-name"></div>
            <div class="form-group"><label>Roll Number</label><input type="text" class="form-control" id="asm-roll"></div>
            <div class="form-group"><label>Email</label><input type="email" class="form-control" id="asm-email"></div>
            <div class="form-group"><label>Phone</label><input type="text" class="form-control" id="asm-phone"></div>
            <div class="form-group"><label>City</label><input type="text" class="form-control" id="asm-city"></div>
            <div class="form-group"><label>Entry Test</label><select class="form-control" id="asm-entry-test">${ENTRY_TESTS.map(t => `<option value="${t.name}">${t.name}</option>`).join('')}</select></div>
            <div class="form-group"><label>Batch</label><select class="form-control" id="asm-batch">${BATCHES.map(b => `<option value="${b.name}">${b.name}</option>`).join('')}</select></div>
            <div class="form-group"><label>Fee Status</label><select class="form-control" id="asm-fee-status"><option value="Unpaid">Unpaid</option><option value="Partially Paid">Partially Paid</option><option value="Paid">Paid</option></select></div>
            <div class="form-group"><label>Total Fee (Rs.)</label><input type="number" class="form-control" id="asm-total-fee"></div>
            <div class="form-group"><label>Amount Paid (Rs.)</label><input type="number" class="form-control" id="asm-paid-amount"></div>
            <div class="form-group"><label>Attendance %</label><input type="number" class="form-control" id="asm-attendance" min="0" max="100"></div>
          </div>
          <div style="display:flex;gap:0.65rem;justify-content:flex-end;margin-top:0.5rem">
            <button class="btn btn-ghost btn-sm" onclick="closeAdminStudentModal()">Cancel</button>
            <button class="btn btn-danger btn-sm" id="asm-delete-btn" onclick="deleteCurrentStudent()" style="display:none">Delete</button>
            <button class="btn btn-primary btn-sm" onclick="saveAdminStudent()">Save</button>
          </div>
        </div>
      </div>`,
    render: renderAdminStudents
  },

  teachers: {
    title: 'Teachers',
    topbarAction: () => `<button class="btn btn-primary btn-sm" onclick="openAdminTeacherModal(null)">Add Teacher</button>`,
    html: () => `
      <div class="page-header"><h1>Teacher Management</h1><p>Manage teacher accounts and course assignments.</p></div>
      <div class="stats-row" id="teacher-stats-row" style="margin-bottom:1.25rem"></div>
      <div class="manage-table-card">
        <div class="manage-table-head"><h3>All Teachers</h3><input type="text" class="form-control" id="teacher-search" placeholder="Search..." oninput="renderAdminTeachers()" style="height:32px;width:200px"></div>
        <div class="table-wrap"><table><thead><tr><th>Teacher</th><th>Subject</th><th>Phone</th><th>Courses</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead><tbody id="admin-teachers-tbody"></tbody></table></div>
      </div>
      <div class="modal-overlay" id="admin-teacher-modal" style="display:none">
        <div class="modal-box">
          <div class="modal-header"><h3 id="atm-modal-title">Add Teacher</h3><button class="modal-close" onclick="closeAdminTeacherModal()">&#215;</button></div>
          <input type="hidden" id="atm-id">
          <div class="grid-2">
            <div class="form-group"><label>Full Name</label><input type="text" class="form-control" id="atm-name"></div>
            <div class="form-group"><label>Email</label><input type="email" class="form-control" id="atm-email"></div>
            <div class="form-group"><label>Phone</label><input type="text" class="form-control" id="atm-phone"></div>
            <div class="form-group"><label>Subject</label><input type="text" class="form-control" id="atm-subject"></div>
            <div class="form-group"><label>Status</label><select class="form-control" id="atm-status"><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
          </div>
          <div style="display:flex;gap:0.65rem;justify-content:flex-end;margin-top:0.5rem">
            <button class="btn btn-ghost btn-sm" onclick="closeAdminTeacherModal()">Cancel</button>
            <button class="btn btn-danger btn-sm" id="atm-delete-btn" onclick="deleteCurrentTeacher()" style="display:none">Delete</button>
            <button class="btn btn-primary btn-sm" onclick="saveAdminTeacher()">Save</button>
          </div>
        </div>
      </div>`,
    render: renderAdminTeachers
  },

  batches: {
    title: 'Batches',
    topbarAction: () => `<button class="btn btn-primary btn-sm" onclick="openAdminBatchModal(null)">Create Batch</button>`,
    html: () => `
      <div class="page-header"><h1>Batch Management</h1><p>Each batch maps one teacher per subject based on the entry test curriculum.</p></div>
      <div class="stats-row" id="batch-stats-row" style="margin-bottom:1.25rem"></div>
      <div id="admin-batches-grid" class="grid-auto"></div>
      <div class="modal-overlay" id="admin-batch-modal" style="display:none">
        <div class="modal-box" style="max-width:560px">
          <div class="modal-header">
            <h3 id="abm-modal-title">Create Batch</h3>
            <button class="modal-close" onclick="closeAdminBatchModal()">&#215;</button>
          </div>
          <input type="hidden" id="abm-id">
          <div class="grid-2">
            <div class="form-group" style="grid-column:1/-1">
              <label>Batch Name</label>
              <input type="text" class="form-control" id="abm-name" placeholder="MDCAT Alpha 2025">
            </div>
            <div class="form-group">
              <label>Entry Test</label>
              <select class="form-control" id="abm-entry-test" onchange="renderBatchTeacherSlots()" style="height:36px">
                ${ENTRY_TESTS.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label>Start Date</label>
              <input type="date" class="form-control" id="abm-start">
            </div>
            <div class="form-group">
              <label>Status</label>
              <select class="form-control" id="abm-status">
                <option value="upcoming">Upcoming</option>
                <option value="active">Active</option>
                <option value="completed">Completed</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label style="font-size:0.72rem;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--text-mid)">
              Subject Teachers
              <span style="font-weight:400;color:var(--text-light);text-transform:none;letter-spacing:0"> — one teacher per subject</span>
            </label>
            <div id="abm-teacher-slots" style="border:1px solid var(--border);border-radius:var(--radius);overflow:hidden"></div>
          </div>

          <div class="form-group">
            <label>Assign Students</label>
            <div id="abm-student-list" style="max-height:150px;overflow-y:auto;border:1px solid var(--border);border-radius:var(--radius);padding:0.5rem">
              ${STUDENTS_DB.map(s => `
                <div style="display:flex;align-items:center;gap:0.5rem;padding:0.35rem 0.5rem;border-radius:4px">
                  <input type="checkbox" id="scb-${s.id}" value="${s.id}">
                  <label for="scb-${s.id}" style="cursor:pointer;font-size:0.82rem;flex:1">
                    <strong>${s.name}</strong>
                    <span style="color:var(--text-light);font-family:var(--font-mono);font-size:0.7rem;margin-left:6px">${s.rollNo}</span>
                  </label>
                </div>`).join('')}
            </div>
          </div>

          <div style="display:flex;gap:0.65rem;justify-content:flex-end;margin-top:0.5rem">
            <button class="btn btn-ghost btn-sm" onclick="closeAdminBatchModal()">Cancel</button>
            <button class="btn btn-danger btn-sm" id="abm-delete-btn" onclick="deleteCurrentBatch()" style="display:none">Delete Batch</button>
            <button class="btn btn-primary btn-sm" onclick="saveAdminBatch()">Save Batch</button>
          </div>
        </div>
      </div>`,
    render: renderAdminBatches
  },

  tests: {
    title: 'Entry Tests',
    html: () => `
      <div class="page-header"><h1>Entry Test Management</h1><p>Configure entry test programs and their subjects.</p></div>
      <div class="card" style="margin-bottom:1.5rem">
        <div class="card-title">Active Programs</div>
        <div class="tag-list" id="test-tag-list"></div>
      </div>
      <div class="grid-2" style="gap:1.25rem;align-items:start">
        <div class="card">
          <div class="card-title">Add New Entry Test</div>
          <div class="form-group"><label>Program Name</label><input type="text" class="form-control" id="new-test-name" placeholder="e.g. GAT, SAT..."></div>
          <div class="form-group"><label>Description</label><textarea class="form-control" id="new-test-desc" rows="2"></textarea></div>
          <div class="form-group">
            <label>Subjects Taught</label>
            <div style="display:flex;gap:0.5rem;margin-bottom:0.4rem">
              <input type="text" class="form-control" id="new-test-subject-inp" placeholder="e.g. Biology" style="flex:1">
              <button class="btn btn-outline btn-sm" onclick="addSubjectToNewTest()">Add</button>
            </div>
            <div id="new-test-subjects-list" style="display:flex;flex-wrap:wrap;gap:5px;min-height:28px;padding:4px;border:1px solid var(--border);border-radius:var(--radius);background:var(--bg)"></div>
          </div>
          <button class="btn btn-primary btn-full" onclick="addTest()">Add Entry Test</button>
        </div>
        <div class="manage-table-card">
          <div class="manage-table-head"><h3>All Programs</h3></div>
          <div class="table-wrap"><table><thead><tr><th>#</th><th>Name</th><th>Subjects</th><th>Tag</th><th>Action</th></tr></thead><tbody id="tests-tbody"></tbody></table></div>
        </div>
      </div>`,
    render: () => {
      renderTestTags();
      // Reset the "new test" subject builder each time this page is opened.
      window._newTestSubjects = [];
      const subSel = document.getElementById('new-test-subject-inp');
      if (subSel) {
        subSel.innerHTML = '<option value="">— Choose subject —</option>' +
          SUBJECTS_DB.map(s => `<option value="${s.name}">${s.name}</option>`).join('');
      }
      const sl = document.getElementById('new-test-subjects-list');
      if (sl) sl.innerHTML = '';
    }
  },
};

// ── Batch CRUD (one teacher per subject, via `subjectTeachers`) ────────────

/** Renders the admin Batches stat row + card grid. */
function renderAdminBatches() {
  const statsEl = document.getElementById('batch-stats-row');
  if (statsEl) {
    const active   = BATCHES.filter(b => b.status === 'active').length;
    const upcoming = BATCHES.filter(b => b.status === 'upcoming').length;
    const totalS   = [...new Set(BATCHES.flatMap(b => b.studentIds))].length;
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-icon si-blue" style="font-family:var(--font-mono);font-weight:700">B</div><div class="stat-info"><div class="sv">${BATCHES.length}</div><div class="sl">Total Batches</div></div></div>
      <div class="stat-card"><div class="stat-icon si-green" style="font-family:var(--font-mono);font-weight:700">A</div><div class="stat-info"><div class="sv">${active}</div><div class="sl">Active</div></div></div>
      <div class="stat-card"><div class="stat-icon si-orange" style="font-family:var(--font-mono);font-weight:700">U</div><div class="stat-info"><div class="sv">${upcoming}</div><div class="sl">Upcoming</div></div></div>
      <div class="stat-card"><div class="stat-icon si-navy" style="font-family:var(--font-mono);font-weight:700">S</div><div class="stat-info"><div class="sv">${totalS}</div><div class="sl">Enrolled Students</div></div></div>`;
  }

  const grid = document.getElementById('admin-batches-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!BATCHES.length) {
    grid.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-light);font-size:0.85rem;border:1px dashed var(--border);border-radius:var(--radius-lg)">No batches yet.</div>';
    return;
  }

  BATCHES.forEach(b => {
    // Support both the old single `teacherId` field and the current `teacherIds` array,
    // in case some batches were created before multi-teacher batches existed.
    const teacherIds = b.teacherIds || (b.teacherId ? [b.teacherId] : []);
    const teachers   = TEACHERS_DB.filter(t => teacherIds.includes(t.id));
    const students   = STUDENTS_DB.filter(s => b.studentIds.includes(s.id));
    const test       = ENTRY_TESTS.find(t => t.name === b.entryTest);
    const testColor  = test?.color || 'var(--blue)';

    grid.innerHTML += `
      <div class="card" style="border-top:3px solid ${testColor}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:0.85rem">
          <div>
            <div style="font-size:0.95rem;font-weight:600;color:var(--text-dark);margin-bottom:3px">${b.name}</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap">
              <span class="badge" style="background:${testColor}22;color:${testColor}">${b.entryTest}</span>
              <span class="badge ${b.status === 'active' ? 'badge-green' : 'badge-orange'}">${b.status}</span>
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="openAdminBatchModal('${b.id}')">Edit</button>
        </div>
        <div style="margin-bottom:0.85rem">
          <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-light);margin-bottom:0.35rem">Teachers</div>
          ${teachers.length ? teachers.map(t =>
            `<div style="font-size:0.8rem;display:flex;align-items:center;gap:6px;margin-bottom:3px">
              <span style="font-weight:500">${t.name}</span>
              <span style="color:var(--text-light);font-size:0.72rem">· ${t.subject}</span>
            </div>`).join('') : '<div style="font-size:0.78rem;color:var(--text-light)">No teachers assigned</div>'}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:1rem">
          <div style="font-size:0.78rem;color:var(--text-mid)">Start Date</div>
          <div style="font-size:0.78rem;font-family:var(--font-mono)">${b.startDate}</div>
          <div style="font-size:0.78rem;color:var(--text-mid)">Students</div>
          <div style="font-size:0.78rem;font-family:var(--font-mono);font-weight:600">${students.length}</div>
        </div>
        ${students.length ? `
        <div style="border-top:1px solid var(--border);padding-top:0.75rem">
          <div style="font-size:0.65rem;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-light);margin-bottom:0.4rem">Enrolled</div>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            ${students.slice(0, 4).map(s => `<span class="badge badge-blue" style="font-size:0.65rem">${s.name.split(' ')[0]}</span>`).join('')}
            ${students.length > 4 ? `<span class="badge badge-navy">+${students.length - 4}</span>` : ''}
          </div>
        </div>` : `<div style="border-top:1px solid var(--border);padding-top:0.75rem;font-size:0.78rem;color:var(--text-light)">No students enrolled yet.</div>`}
      </div>`;
  });
}

/** Opens the admin Add/Edit Batch modal, restoring saved subject-teacher assignments and student checkboxes if editing. */
function openAdminBatchModal(bid) {
  const modal = document.getElementById('admin-batch-modal');
  if (!modal) return;

  const titleEl = document.getElementById('abm-modal-title');
  const delBtn  = document.getElementById('abm-delete-btn');
  let currentSubjectTeachers = {}; // e.g. { Biology: 'T001', Physics: 'T002' }
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
    // on each student's record — this just keeps STUDENTS_DB in sync so
    // the students table doesn't need a full re-fetch).
    STUDENTS_DB.forEach(s => { if (studentIds.includes(s.id)) s.batch = name; });

    closeAdminBatchModal();
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
    await apiFetch(`/batches/${id}`, { method: 'DELETE' });
    const idx = BATCHES.findIndex(b => b.id === id);
    if (idx !== -1) BATCHES.splice(idx, 1);
    closeAdminBatchModal();
    renderAdminBatches();
    showToast('Batch deleted.');
  } catch (err) {
    showToast(err.message);
  }
}


// ── SPA router (renders synchronously after inserting HTML, so there's no flash of empty content) ──

function navigateTo(hash) {
  const routeKey = (hash || '').replace('#', '') || 'dashboard';
  const route    = ADMIN_ROUTES[routeKey];
  if (!route) { navigateTo('#dashboard'); return; }

  const content = document.getElementById('page-content');
  if (!content) return;

  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = route.title;

  // Swap out the topbar's page-specific action button (e.g. "Add Student").
  const existingBtn = document.getElementById('topbar-action-btn');
  if (existingBtn) existingBtn.remove();
  if (route.topbarAction) {
    const topbarRight = document.querySelector('.topbar-right');
    if (topbarRight) {
      const wrapper = document.createElement('div');
      wrapper.id = 'topbar-action-btn';
      wrapper.innerHTML = route.topbarAction();
      topbarRight.prepend(wrapper);
    }
  }

  content.innerHTML = route.html();     // inject HTML immediately (no fade = no flash)
  if (route.render) route.render();     // then populate it with live data

  document.querySelectorAll('.nav-item').forEach(link => {
    link.classList.remove('active');
    if (link.getAttribute('href') === '#' + routeKey) link.classList.add('active');
  });

  content.scrollTop = 0;
}

function initAdminSPA() {
  if (!document.getElementById('page-content')) return;
  navigateTo(location.hash || '#dashboard');
  window.addEventListener('hashchange', () => navigateTo(location.hash));
}

// Temp working list while building a new entry test in the "Add Entry Test" form.
window._newTestSubjects = [];

function addSubjectToNewTest() {
  const inp = document.getElementById('new-test-subject-inp');
  if (!inp || !inp.value.trim()) return;
  const sub = inp.value.trim();
  if (!window._newTestSubjects.includes(sub)) {
    window._newTestSubjects.push(sub);
    renderNewTestSubjectTags();
  }
  inp.value = '';
  inp.focus();
}
function removeNewTestSubject(sub) {
  window._newTestSubjects = window._newTestSubjects.filter(s => s !== sub);
  renderNewTestSubjectTags();
}
function renderNewTestSubjectTags() {
  const el = document.getElementById('new-test-subjects-list');
  if (!el) return;
  el.innerHTML = window._newTestSubjects.map(s => `
    <span style="display:inline-flex;align-items:center;gap:4px;background:var(--blue-pale);color:var(--navy);font-size:0.72rem;padding:2px 8px;border-radius:20px;font-weight:500">
      ${s}
      <button onclick="removeNewTestSubject('${s}')" style="background:none;border:none;cursor:pointer;color:var(--text-light);font-size:0.8rem;line-height:1;padding:0">&#215;</button>
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
  return parseInt(localStorage.getItem(`attempts_${studentId}_${courseId}`) || '0');
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
async function generateStudyNotes(course, weakTopics) {
  const data = await apiFetch('/ai/study-notes', {
    method: 'POST',
    body: JSON.stringify({ course: { subject: course.subject, title: course.title }, weakTopics }),
  });
  return data.notes;
}

async function generateQuizQuestions(course, weakTopics, numQuestions = 5) {
  const data = await apiFetch('/ai/generate-quiz', {
    method: 'POST',
    body: JSON.stringify({ course: { subject: course.subject, title: course.title }, weakTopics, numQuestions }),
  });
  return data.questions;
}

// /** Asks Claude for a fresh set of MCQ questions targeting the student's weak topics. Returns a parsed array of { q, options, ans, topicTitle }. */
// async function generateQuizQuestions(course, weakTopics, numQuestions = 5) {
//   const topicList = weakTopics.map(t => t.title).join(', ');
//   const systemPrompt = `You are a quiz generator for ${course.subject} (${course.title}).
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
        background:var(--border);color:var(--text-light)">${t.title}</span>`;
    }
    const isWeak = attempted.pct < 70;
    return `<span style="font-size:0.72rem;padding:3px 9px;border-radius:20px;
      background:${isWeak ? '#fecaca' : '#bbf7d0'};
      color:${isWeak ? '#991b1b' : '#166534'}">
      ${t.title} · ${attempted.pct}%
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
          <div style="font-size:1rem;font-weight:600;color:var(--text-dark)">${course.title}</div>
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
            ${weakTopics.map(t => `${t.title} (${t.pct}%)`).join(' · ')}
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
                              margin-bottom:0.3rem;font-size:0.85rem">${line.slice(3)}</div>`;
        }
        if (line.startsWith('• ') || line.startsWith('- ')) {
          return `<div style="display:flex;gap:7px;margin-bottom:4px">
                    <span style="color:var(--blue);flex-shrink:0;margin-top:1px">•</span>
                    <span style="font-size:0.8rem;line-height:1.55">${line.slice(2)}</span>
                  </div>`;
        }
        if (line.trim()) {
          return `<div style="font-size:0.8rem;line-height:1.55;margin-bottom:3px">${line}</div>`;
        }
        return '';
      })
      .join('');

    body.innerHTML = html || '<span style="color:var(--text-light)">Notes generated — no content returned.</span>';
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

    const questions = await generateQuizQuestions(course, topicsForQuiz, 5);
    const attemptNum = incrementAttempt(student.id, courseId);

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
        ${qi + 1}. ${q.q}
        ${q.topicTitle ? `<span style="display:block;font-size:0.68rem;color:var(--text-light);
          font-weight:400;margin-top:2px">${q.topicTitle}</span>` : ''}
      </p>
      ${q.options.map((opt, oi) => `
        <div class="quiz-opt"
          data-qi="${qi}" data-oi="${oi}" data-ans="${q.ans}"
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
          <span>${opt}</span>
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
            ${course.subject} — Personalized Questions
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
  const entry = await apiFetch(`/students/${student.id}/quiz-scores/ai-retry`, {
    method: 'POST',
    body: JSON.stringify({ subject: COURSES[courseId].subject, courseId, score: correct, total, attemptNum }),
  });
  student.quizScores.push(entry);

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

/** Legacy entry point (still referenced by some "Re-attempt Quizzes" buttons) — just opens the main study panel. */
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
 * submission — there's no real backend/file storage — it just updates the
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
  if (!assign) { showToast('Assignment record not found.'); return; }

  const formData = new FormData();
  if (hasText) formData.append('text', textEl.value.trim());
  if (hasFile) formData.append('file', fileInp.files[0]);

  try {
    const updated = await apiFetch(`/students/${student.id}/assignments/${assign.id}/submit`, {
      method: 'PATCH',
      body: formData,
    });
    Object.assign(assign, updated); // update the cached CURRENT_STUDENT in place

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