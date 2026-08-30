# Mind Route LMS — Technical Reference (v2, real backend)

This replaces the original mock-data `TECHNICAL_REFERENCE.md`. That version
described a pure-frontend prototype (`localStorage` as the database). This
one describes the actual system as it stands now: a real Express + MongoDB
backend, a JWT-authenticated multi-page frontend, and everything that's
been added on top of the original feature set.

**Read the Status Summary first** — it tells you exactly what's confirmed
working, what's built but never retested, and what's still broken. Don't
assume something works just because it's described in detail below.

---

## 0. Status Summary

Legend: ✅ built and confirmed working via manual testing · 🔧 code was
written and given to you, but never confirmed applied/retested since ·
❌ not started / known broken.

| Area | Status | Notes |
|---|---|---|
| MongoDB Atlas connection | ✅ | Non-SRV connection string, `mindroute` db |
| Seeding (`seed.js`) | ✅ | Creates 1 admin, 1 teacher, 1 student |
| Login — all 3 roles | ✅ | JWT-based, tested end to end |
| File upload (assignments) | ✅ | multer, served from `/uploads` |
| Assignment submit → grade → approve loop | ✅ | Full loop tested |
| Schedule CRUD | ✅ | Fixed `_id` vs `id` bug |
| Notifications | ✅ | Fixed `_id`, `/read-all` endpoint, `time`→`createdAt` |
| Grade threshold apply + recompute | ✅ | Was completely broken (wrong file), now fixed |
| Threshold ordering validation | 🔧 | Code given, not retested |
| AI Study Assistant (notes + quiz) | ✅ | Confirmed working with real Anthropic key |
| Admin: Students page | 🔧 | Inline duplicate script **just deleted** — needs retest |
| Admin: Batches page | 🔧 | Inline duplicate script **just deleted** — needs retest |
| Admin: Teachers page | ❌ | Same inline-script bug suspected, **not yet confirmed/fixed** — file not yet reviewed |
| Admin: Entry Tests page | ❌ | Same inline-script bug suspected, **not yet confirmed/fixed** — file not yet reviewed |
| Admin: Dashboard page | ❌ | Same inline-script bug suspected, **not yet confirmed/fixed** — file not yet reviewed |
| Admin: Courses page | ❌ **NOT DONE** | `courses.html` just created; `renderAdminCourses` / `openAdminCourseModal` / `saveAdminCourse` / `deleteAdminCourse` functions given in chat but not confirmed added to `app.js`; router check not confirmed added; nothing tested |
| Subject model + `/api/subjects` route | 🔧 | Code given, not confirmed created on disk |
| Teacher `subject` → `subjects` (array) | 🔧 | Model change given, requires re-seed, not confirmed applied |
| Batch→Course auto-enrollment | 🔧 | Code given for `routes/batches.js`, not confirmed applied |
| Teacher-subject filtering in batch modal | 🔧 | One-line fix given, not confirmed applied |
| Resume-last-topic (student) | 🔧 | Model + route + frontend given, not confirmed applied |
| Admin-creates-admin endpoint | 🔧 | Route given, no UI — must call via Postman/reqbin |
| Password field on Add Student/Teacher | 🔧 | HTML + JS given, not confirmed applied |
| Entry Test deletion — blocks if batch in use | 🔧 | Given, not confirmed applied |
| Subject deletion cascade cleanup | 🔧 | Given, not confirmed applied |
| Full SPA rewrite / real perf overhaul | ❌ | Explicitly deferred — out of scope for now |
| Student ↔ Teacher messaging | ❌ (by design) | Still a UI mock, no backend, never planned to get one yet |

**Immediate next steps, in order:**
1. Paste `teachers.html`, `tests.html`, `dashboard.html` so the inline-script-shadowing bug can be found and fixed on those three pages too (same as was just done for `students.html`/`batches.html`).
2. Finish wiring Courses: confirm the 4 course functions exist in `app.js`, confirm the router check was added, test creating a course end-to-end.
3. Re-run `node seed.js` after applying the `Subject`/`Teacher.subjects` model changes — old seeded data won't match the new shape until you do.
4. Retest everything in `TESTING_GUIDE.md` from the top, since the inline-script bug means large parts of Admin were silently never actually exercising the real backend code before now.

---

## 1. Stack & architecture

- **Backend**: Node.js + Express + MongoDB (Atlas) via Mongoose. JWT auth (`jsonwebtoken` + `bcryptjs`). File uploads via `multer`, served statically from `/uploads`.
- **Frontend**: plain HTML/CSS/JS, **multi-page** (not a SPA) — every role (Student/Teacher/Admin) has its own set of real `.html` files, each loading a shared `js/app.js`. There is no client-side router; navigating between pages is a real browser page load.
- **One shared `app.js`** holds all data-fetching (`apiFetch`, `loadAppData`), session handling, and every page's render/save/delete functions. Each HTML page's `DOMContentLoaded` router in `app.js` detects which page it's on by checking for specific element IDs, then calls the matching render function(s).
- **AI feature**: server-side only. `routes/ai.js` holds the Anthropic API key (`process.env.ANTHROPIC_API_KEY`) and proxies two endpoints (`/ai/study-notes`, `/ai/generate-quiz`) — the frontend never talks to Anthropic directly.

### ⚠️ Known frontend gotcha — inline script shadowing

Several Admin pages were originally built with their own **inline `<script>` block** (loaded *after* `js/app.js`) that redeclares the same function names as the real backend-integrated versions in `app.js` (`renderAdminStudents`, `saveAdminStudent`, `openAdminBatchModal`, etc.). In plain non-module JavaScript, a later function declaration with the same name **completely replaces** the earlier one in global scope — it doesn't merge or layer. This meant those pages were silently running old, pre-backend, `localStorage`-based logic (some of it calling functions like `saveStudentsDB()` that don't even exist anymore) instead of the real, working code.

**Fixed so far**: `students.html`, `batches.html` — their inline blocks were deleted, and the setup logic they used to do (populating dropdowns, building checkbox lists) was moved into the real `app.js` functions instead.

**Not yet checked**: `teachers.html`, `tests.html`, `dashboard.html`. Assume they have the same problem until confirmed otherwise — paste them in before trusting anything on those pages.

---

## 2. Folder structure (actual, current)

```
mindroute-backend/
├── .env
├── server.js
├── seed.js
├── package.json
│
├── middleware/
│   ├── auth.js            (protect, restrictTo)
│   └── upload.js          (multer config)
│
├── models/
│   ├── User.js
│   ├── Student.js
│   ├── Teacher.js
│   ├── Batch.js
│   ├── Course.js
│   ├── EntryTest.js
│   ├── GradeThreshold.js
│   ├── TeacherSchedule.js
│   ├── Notification.js
│   └── Subject.js          🔧 new — confirm this file actually exists on disk
│
├── routes/
│   ├── auth.js
│   ├── students.js
│   ├── teachers.js
│   ├── batches.js
│   ├── courses.js
│   ├── tests.js
│   ├── thresholds.js
│   ├── schedule.js
│   ├── notifications.js
│   ├── ai.js
│   └── subjects.js         🔧 new — confirm this file actually exists on disk
│
├── utils/
│   └── createUserAccount.js
│
├── uploads/                (created automatically, holds submitted files)
│
└── public/                 ← THE FRONTEND LIVES HERE, not a separate repo
    ├── login.html
    ├── css/
    ├── js/
    │   └── app.js          ← the one shared frontend script
    ├── images/
    ├── Assets/
    ├── Student/
    │   ├── dashboard.html, courses.html, course-detail.html,
    │   │   schedule.html, attendance.html, fees.html, performance.html
    ├── Teacher/
    │   ├── dashboard.html, courses.html, students.html,
    │   │   grading.html, schedule.html
    └── Admin/
        ├── dashboard.html, students.html, teachers.html,
        │   batches.html, tests.html, courses.html (new)
```

**Important**: Admin is a set of real separate HTML files, exactly like Student/Teacher — **not** a single-page shell with hash routing. (An earlier round of advice in this project's history incorrectly assumed a hash-based `#page-content` SPA shell for Admin — that was wrong for this actual codebase and was corrected. If you see old references to `ADMIN_ROUTES` / `navigateTo()` / `initAdminSPA()` in `app.js`, that code is dead/unused — safe to ignore, safe to delete later, but not currently doing anything since no Admin page has `id="page-content"`.)

---

## 3. Environment variables (`.env`)

```dotenv
MONGO_URI=mongodb://<user>:<password>@<host1>:27017,<host2>:27017,<host3>:27017/mindroute?ssl=true&replicaSet=<name>&authSource=admin&retryWrites=true&w=majority&appName=Cluster0
JWT_SECRET=<long random hex string>
ANTHROPIC_API_KEY=<real key, starts sk-ant-...>
PORT=3000
```

- **Use the non-SRV (`mongodb://...`) form**, not `mongodb+srv://` — this project hit a Windows-specific DNS issue where SRV record lookups get silently blocked by some network/resolver configs even though normal DNS works fine. The standard form with explicit shard hostnames avoids that entirely.
- **`MONGO_URI` must be a single unbroken line**, no stray line breaks, no duplicated `MONGO_URI=` prefix, no quotes around the value.
- **Rotate the Atlas password immediately if it's ever been pasted into a chat, Slack, ticket, etc.** — treat any password that's been shared in plaintext as compromised, no exceptions.

---

## 4. Data models (current shapes)

### User
```js
{
  email: { type: String, unique: true, required: true },
  role: { type: String, enum: ['student', 'teacher', 'admin'], required: true },
  name: String,
  password: { type: String, required: true, select: false }, // bcrypt hash, never plaintext
}
```
One collection for all three roles. Password is bcrypt-hashed via `utils/createUserAccount.js` (student/teacher creation) or inline in `routes/auth.js` (admin creation). `select: false` means `User.find()` never returns it unless you explicitly `.select('+password')`.

### Student
```js
{
  id: String,          // 'S001' style, unique
  name, rollNo, batch, entryTest: String,
  email: { type: String, unique: true },
  phone, city, joinDate: String,
  enrolledCourseIds: [Number],
  attendance: Number,
  feeStatus, totalFee, paidAmount, nextDue,
  attendanceDetail: [{ subject, total, attended, missed }],
  quizScores: [{ id, topic, subject, topicId, score, total, date, feedback, isAIRetry, courseId, attemptNum }],
  assignments: [{ id, topicId, title, course, courseId, dueDate, submitted, submittedOn,
                  marks, totalMarks, grade, feedback, approved, manualGrade,
                  answerText, fileUrl, fileName }],
  fees: [{ label, amount, dueDate, status }],
  topicProgress: { type: Map, of: Boolean, default: {} },   // checkbox "done" state
  lastTopic: { type: Map, of: String, default: {} },        // 🔧 courseId -> topicId, resume feature
}
```

### Teacher
```js
{
  id: String,          // 'T001' style
  name: String,
  email: { type: String, unique: true },
  phone: String,
  subjects: [String],  // 🔧 CHANGED from singular `subject: String` — a teacher can teach multiple
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  courseIds: [Number],
  joinDate: String,
}
```
**Breaking change**: was `subject: String`, now `subjects: [String]`. Requires re-seeding old data and updating every place in `app.js` that reads `.subject` (singular) to read `.subjects` (array) instead.

### Batch
```js
{
  id: String,           // 'B001' style
  name: String,
  entryTest: String,     // display name, e.g. 'MDCAT'
  entryTestId: String,   // -> EntryTest.id
  startDate, status: String,
  studentIds: [String],
  subjectTeachers: { type: Map, of: String, default: {} }, // subject name -> teacher.id
}
```
`subjectTeachers` is a Mongoose Map on the way in/out of the DB, but every route converts it to/from a plain object for the frontend (`Object.fromEntries`/`new Map(Object.entries(...))`), since `app.js` treats it as a plain object throughout.

### Course
```js
{
  id: { type: Number, unique: true },
  title, subject, icon, color, colorLight, teacher, description: String,
  weeks: [{ num, title, uploadedDate, topics: [{ id, num, title, dueDate, contents: [Mixed] }] }],
}
```
`contents` is `Mixed` type — no schema enforcement on individual content items (video/notes/quiz/assign/link), matches the loose shape `app.js` builds them in.

### EntryTest
```js
{ id: String, name, color, desc: String, subjects: [String] }
```

### GradeThreshold
Singleton document (always exactly one). `thresholds: [{ min: Number, grade: String }]`, default matches the standard A+ through F scale.

### TeacherSchedule
```js
{ teacherId: String (optional), day, time, subject, course, type: 'physical'|'online', room, duration: Number }
```
No custom `id` field — identified purely by Mongo's `_id`. **Frontend must use `existing._id`, never `existing.id`, when editing/deleting a schedule row** — this was a recurring bug.

### Notification
```js
{ userId: { type: String, required: true, index: true }, type, read: Boolean, title, body: String }
// timestamps: true  →  gives createdAt/updatedAt automatically
```
No `time` field — the frontend computes a relative time string (`timeAgo()`) from `createdAt`. Scoped per-user via `userId`.

### Subject 🔧 (new, confirm it exists)
```js
{ name: { type: String, required: true, unique: true }, isCore: { type: Boolean, default: false } }
```
The missing piece that actually relates Teachers ↔ EntryTests ↔ Batches. `isCore: true` subjects (seeded ones like Biology, Physics, etc.) can't be deleted by admin.

---

## 5. How the core relationships actually work

This was a source of a lot of confusion — here's the real shape:

- **Subject** is the atomic unit. A fixed, admin-managed list (e.g. Biology, Chemistry, Physics...). Core ones are protected from deletion.
- **Teacher.subjects** — an array of Subject names. A teacher can teach several.
- **EntryTest.subjects** — an array of Subject names, defining what a program (MDCAT, ECAT, etc.) requires. Admin picks these from the real Subject list via dropdown (not free text — free text was the cause of a duplicate-subject bug where re-adding a subject with different capitalization silently failed).
- **Batch** — belongs to one `EntryTest` (via `entryTestId`). Its `subjectTeachers` map assigns **one teacher per subject**, but only teachers whose `subjects` array actually includes that subject should be selectable (frontend filter: `TEACHERS_DB.filter(t => t.subjects.includes(sub))`).
- **Teacher ↔ Batch is naturally many-to-many already** — no extra join table needed. The same teacher's `id` can appear in the `subjectTeachers` map of many different Batch documents simultaneously. "One teacher, multiple batches" was never actually blocked by the schema — it just needed the subject-filtering fix so the *right* teachers show up as options.
- **Student ↔ Batch** — a student's `batch` field is just a display string (the batch name), synced whenever `saveAdminBatch()`/the batch routes run. The real enrollment link is `Student.enrolledCourseIds`.
- **Batch → Course auto-enrollment** 🔧 — when students are added to a batch, the backend looks up the batch's EntryTest, finds all Courses whose `subject` matches one of that EntryTest's required subjects, and adds those course ids to each student's `enrolledCourseIds`. This is what actually gets a course to "start" for a student — without a matching Course document (same `subject` string, case-sensitive), nothing auto-enrolls, since there's nothing to enroll into.

**The chain, start to finish**: Subject exists → EntryTest requires that Subject → Course exists with that Subject → Batch ties to that EntryTest, assigns a Teacher (who must teach that Subject) → Student joins that Batch → student auto-enrolls in the matching Course(s) → Teacher edits that Course's curriculum → Student sees real content.

---

## 6. API route reference

All routes are mounted under `/api/`, all except `/auth/login` require a valid `Authorization: Bearer <token>` header (enforced by `middleware/auth.js`'s `protect`).

| Route file | Base path | Notes |
|---|---|---|
| `auth.js` | `/api/auth` | `login`, `me`, `logout`, 🔧`create-admin` (admin-only, no UI yet) |
| `students.js` | `/api/students` | Full CRUD + progress + assignment submit/grade/approve + quiz-scores |
| `teachers.js` | `/api/teachers` | Full CRUD + `/courses`, `/students`, `/pending-grading` |
| `batches.js` | `/api/batches` | Full CRUD; 🔧 course auto-enrollment on student assignment |
| `courses.js` | `/api/courses` | Full CRUD + nested week/topic/content routes |
| `tests.js` | `/api/tests` | Full CRUD; 🔧 blocks deletion if a batch still references it |
| `thresholds.js` | `/api/thresholds` | Singleton GET/PUT + bulk grade recompute; 🔧 ordering validation |
| `schedule.js` | `/api/schedule` | Full CRUD, identified by `_id` |
| `notifications.js` | `/api/notifications` | List, unread-count, create, mark-read, read-all, delete |
| `ai.js` | `/api/ai` | `study-notes`, `generate-quiz` — student-only, server holds the Anthropic key |
| `subjects.js` 🔧 | `/api/subjects` | List, add, delete-with-cascade-cleanup |

---

## 7. Frontend architecture notes

- **`API_BASE`** in `app.js` points at `http://localhost:3000/api` — update this if deploying anywhere else.
- **`apiFetch(path, options)`** — the one function every backend call goes through. Auto-attaches the JWT, auto-sets `Content-Type: application/json` unless the body is `FormData` (file uploads). A 401 auto-redirects to login **except** on `/auth/login` itself (fixed — otherwise a wrong-password attempt would flash-redirect before the error message could render).
- **`loadAppData()`** — runs once per page load (inside the `DOMContentLoaded` handler, before any render function). Fetches courses, entry tests, schedule, thresholds, notifications, batches, teachers, 🔧 subjects, and (role-dependent) the current student/teacher record or the full student list. This is also the biggest lever for the "site feels slow" complaint — every navigation is a full page reload that re-fetches all of this, even on pages that don't need most of it. A real fix here means either lazy-loading per-page, caching with a short TTL, or eventually a proper SPA rewrite — none of which have been done yet.
- **`getActiveStudent()` / `getActiveTeacher()`** — just return the already-loaded `CURRENT_STUDENT` / `CURRENT_TEACHER` globals, populated once by `loadAppData()`.
- **Session**: JWT + user object stored in `localStorage` (`mr_token`, `mr_user`), not `sessionStorage` — survives tab close, cleared explicitly on logout or a 401.
- **`setupSidebar()`** highlights the current nav link by comparing `location.pathname`'s filename against each link's `href` — this is why Admin nav links must be real `.html` file paths (`students.html`), not hash fragments; hash-style `href`s are explicitly skipped by this logic (`if (href.startsWith('#')) return;`).

---

## 8. Security notes

- Passwords: bcrypt-hashed, `select: false` on the schema, never logged or returned by any route.
- File uploads: type-filtered (`.pdf .doc .docx .jpg .jpeg .png` only), 10MB cap, stored on local disk under `uploads/` (swap for S3/Cloudinary before any real deployment — local disk storage won't survive a redeploy on most hosting platforms).
- **No admin self-registration** — the only way to create an admin is an existing admin calling `POST /api/auth/create-admin` directly (no UI button exists for this yet, by design, to avoid an easy privilege-escalation surface).
- Anthropic API key lives server-side only, in `.env`, never sent to the browser.
- Referential integrity is partial — deleting a Teacher doesn't yet clean up `Batch.subjectTeachers` entries pointing at them; deleting a Student doesn't clean up `Batch.studentIds`. EntryTest deletion is now blocked if a Batch still uses it (safer than a silent cascade). Full cleanup across every relationship isn't done yet.

---

## 9. Known non-functional gaps (by design, not bugs)

- **Messaging** (student ↔ teacher chat) is still a pure frontend mock — canned auto-replies, nothing persisted, no backend route. Never scoped to get one in this phase.
- **Performance**: acknowledged as slow due to the multi-page-reload architecture; a proper fix is a larger project (SPA conversion or aggressive per-page data lazy-loading), intentionally not attempted as a quick patch.
- **Cascading deletes**: partial, see Security notes above.

---

## 10. Where to go from here

Use `TESTING_GUIDE.md` (separate file) for the full manual test walkthrough, section by section, with exact click-by-click steps and sample data. Given how much has changed since it was written, **re-run the whole thing from Section 1 once the remaining Admin pages are fixed** — don't trust results from before the inline-script bug was found.
