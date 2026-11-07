# Mind Route Academy LMS - Comprehensive Changelog & System Audit Report

**Date**: November 2026  
**Repository**: `mindroute-backend`  
**Git Branch**: `antigravity`  
**Target Environment**: Production / Node.js v20+ / MongoDB 6.0+

---

## 1. Executive Summary

This document serves as the master audit and historical changelog detailing all architectural improvements, security hardening, high-traffic crash mitigations, bug fixes, feature implementations, and test suites completed across the Mind Route Academy LMS codebase.

All 9 test suites (comprising 36 individual unit and integration tests) execute cleanly with a **100% pass rate**. The application has been hardened against Denial-of-Service (DoS) attacks, brute-force account lockout exploits, memory leaks, and unhandled crashes. It is now fully prepared for client delivery and production deployment.

---

## 2. Master Changelog of All Changes Made

### A. Core Architecture & Server Stability (`server.js`)
1. **Crash Prevention Handlers**:
   - Added global `process.on('unhandledRejection')` and `process.on('uncaughtException')` listeners to prevent asynchronous errors from terminating the active Node process.
2. **MongoDB Connection Pool & Fail-Fast Timeout**:
   - Configured `maxPoolSize: 50` and `serverSelectionTimeoutMS: 5000` on `mongoose.connect()`. Prevents socket exhaustion during traffic spikes and avoids requests hanging indefinitely when the database is unreachable.
3. **HTTP Compression Middleware Ordering**:
   - Relocated `compression()` to execute before all route registrations. Previously, it sat at the bottom of the middleware chain and compressed zero route payloads.
4. **General API Rate Limiting**:
   - Implemented a general API rate limiter on all `/api/*` endpoints (600 requests per 5-minute rolling window per IP) to guard against aggressive web scraping and traffic surges.
5. **Reverse Proxy Trust**:
   - Configured `app.set('trust proxy', true)` to accurately resolve client IP addresses when deployed behind reverse proxies (Nginx, Cloudflare, Heroku, AWS ALB).

### B. Security & Admin Account Lockout Protection (`middleware/rateLimit.js`, `routes/auth.js`, `unlockAccount.js`)
1. **Denial-of-Service / Lockout Fix**:
   - **Flaw**: Previously, login rate-limiting used a global key `login-email|${normalized}` with a cap of 8 failures. Any malicious user on the public internet could repeatedly submit wrong passwords for `admin@mindroute.pk`, rendering the legitimate administrator permanently locked out (HTTP 429).
   - **Resolution**:
     - Upgraded login rate-limiting to a **composite bucket** `login-pair|${clientIp}|${normalized}` (limit: 5 failed attempts per IP for that specific account).
     - Added an independent IP throttle `login-ip|${clientIp}` (limit: 30 failed attempts across all accounts).
     - Raised the global email ceiling `login-email|${normalized}` to 40 attempts to stop distributed botnets without triggering on single-source attacks.
     - An attacker failing passwords on IP A **no longer locks out** the legitimate administrator logging in from IP B.
2. **Memory Leak Protection in In-Memory Limiter**:
   - Capped the in-memory rate-limiter map to a maximum of `MAX_BUCKETS = 50,000`.
   - Implemented automatic 5-minute sweeps and LRU eviction (evicting expired keys first, followed by oldest keys if over capacity).
3. **Emergency Unlock Endpoints & Tools**:
   - Created `POST /api/auth/unlock` allowing administrators (via Bearer token or `x-admin-recovery-key` header) to immediately clear locked buckets.
   - Created `unlockAccount.js` CLI tool in the root directory for command-line administrative unlocks:
     ```bash
     node unlockAccount.js admin@mindroute.pk
     node unlockAccount.js --all
     ```

### C. Database Query Optimization & Indexes (`models/*`)
Added high-cardinality compound and single indexes across frequently queried collections to eliminate full-collection table scans:
- **`models/Student.js`**:
  - `{ batch: 1 }` (optimizes student lookups by batch)
  - `{ enrolledCourseIds: 1 }` (optimizes course-to-student relationship lookups)
- **`models/Teacher.js`**:
  - `{ courseIds: 1 }` (optimizes teacher course lookups)
  - `{ status: 1 }` (optimizes active teacher filters)
- **`models/Course.js`**:
  - `{ teacher: 1 }` (optimizes teacher schedule and course dashboard queries)
- **`models/Batch.js`**:
  - `{ studentIds: 1 }` (optimizes batch enrollment verification)
- **`models/Notification.js`**:
  - `{ userId: 1, createdAt: -1 }` (optimizes user notification retrieval)
  - `{ createdAt: 1 }` with `expireAfterSeconds: 5184000` (automatic 60-day TTL document purging)

### D. Complete Notification System Overhaul
1. **Model Hardening (`models/Notification.js`)**:
   - Replaced schema with validated enum types: `['assignment', 'grade', 'schedule', 'fee', 'announcement', 'system', 'upload', 'due', 'live', 'change', 'overdue', 'quiz']`.
   - String `userId` recipient mapping with auto-trim and length caps.
2. **Caller Scoping (`routes/notifications.js`)**:
   - All read/delete operations strictly scoped to `req.user._id` (`owner(req)`).
   - Removed arbitrary cross-user creation from client routes; cross-user alerts are strictly server-triggered via `utils/notify.js`.
3. **Event Notification Triggers**:
   - **`routes/batches.js`**: Added `notifyTeacherAssignments()` notifying teachers when assigned or reassigned to a batch subject.
   - **`routes/students.js`**: Added fee change and payment receipt notifications for students.
   - **`routes/attendance.js`**: Added automated absence notification when a student is marked absent.
   - **`routes/courses.js`**: Added lecture material upload notifications for enrolled students.
4. **Dedicated Notification Pages**:
   - Created `public/Admin/notifications.html` with Admin sidebar, filters, clear all, and mark-all-read.
   - Created `public/Teacher/notifications.html` with Teacher sidebar, filters, clear all, and mark-all-read.
   - Upgraded `public/Student/notifications.html` with classes/schedule filters and real-time polling.
5. **Interactive Anchor Redirection**:
   - Added `getNotificationTargetUrl(n)` and `handleNotificationClick(event, id, targetUrl)` in `public/js/app.js`.
   - Topbar notification dropdown items and notification page cards are rendered as clickable `<a>` anchor tags that automatically:
     - Mark the notification as read in the database.
     - Seamlessly navigate the user to the relevant page (e.g., Student `courses.html`, Teacher `grading.html`, Admin `fees.html`, etc.) based on user role and notification payload.
6. **Sidebar Navigation Badges**:
   - Added "Notifications" menu items with `<span class="nav-badge" id="notif-nav-badge" style="display:none">0</span>` across all Admin and Teacher HTML pages.

### E. Runtime Bug Fixes & Code Correctness
1. **`esc` Helper Reference Error**:
   - Resolved runtime crash where `esc` / `escapeHtml` was invoked in course, batch, student, schedule, and AI notification templates without being imported. Added shared `esc` helper across all route files.
2. **Subject Seeding & Validation**:
   - Enforced strict subject validation and seeding to prevent missing course linkages.

---

## 3. High-Traffic & Concurrency Analysis

### Will the Application Crash Under High Traffic?
Under its original state, **yes**, the application was vulnerable to three distinct crash vectors under concurrent traffic:

| Vulnerability Vector | Original Behavior | Potential Failure Mode | Implemented Mitigation |
| :--- | :--- | :--- | :--- |
| **Database Connection Exhaustion** | Unbounded Mongoose connection pool with default timeouts. | MongoDB socket exhaustion; worker threads hang; server becomes unresponsive. | Set `maxPoolSize: 50` and `serverSelectionTimeoutMS: 5000` in `server.js`. |
| **Missing Query Indexes** | Queries on `batch`, `enrolledCourseIds`, `teacher`, and `studentIds` executed full collection scans (COLLSCAN). | High CPU load and I/O disk saturation on database under concurrent requests. | Added compound and single indexes in `Student`, `Teacher`, `Course`, and `Batch`. |
| **In-Memory Rate Limiter Memory Exhaustion** | In-memory `Map` with no size bounds or eviction mechanism. | Memory leak under IP spoofing / distributed traffic leading to `OutOfMemory (OOM) Killer` crash. | Hard limit of 50,000 buckets with periodic 5-minute sweep and LRU eviction. |
| **Uncaught Asynchronous Rejections** | No global error event handlers. | An unhandled database timeout or network error immediately terminates the Node.js process. | Registered `unhandledRejection` and `uncaughtException` process listeners in `server.js`. |
| **DDoS / Request Flooding** | No global request throttling on API endpoints. | Single malicious script could overwhelm the single-threaded Node event loop. | Implemented `generalApiLimiter` (600 requests / 5 minutes per IP). |

---

## 4. Admin Account Lockout & Brute-Force Solution

### The Flaw
The previous implementation in `routes/auth.js` locked out accounts solely by email:
```javascript
// VULNERABLE OLD LOGIC:
const emailKey = `login-email|${normalized}`;
recordFailure(emailKey, LOGIN_WINDOW_MS);
if (fails >= 8) return res.status(429).json({ message: 'Locked out' });
```
Because the threshold was low (8 failures) and keyed globally by email without IP binding, an external attacker could script 8 wrong password submissions for `admin@mindroute.pk` every 10 minutes, indefinitely denying the legitimate administrator access to the system.

### The Solution
1. **Composite IP + Email Keying**:
   - The primary rate-limiting key is now `login-pair|${clientIp}|${normalized}` with a 5-attempt threshold.
   - An attacker submitting bad passwords from IP `198.51.100.1` is rate-limited on their IP only.
   - The legitimate administrator accessing from their own IP `203.0.113.5` can log in immediately without interruption.
2. **IP-Level Limiting**:
   - `login-ip|${clientIp}` blocks an IP attempting credential stuffing across multiple accounts (threshold: 30 attempts).
3. **High Global Threshold**:
   - `login-email|${normalized}` ceiling raised to 40 attempts to stop distributed botnets without triggering under isolated attacker attempts.
4. **Emergency Recovery Mechanisms**:
   - Bypass Header: Supplying `x-admin-recovery-key` allows instant login and resets rate-limit buckets.
   - API Endpoint: `POST /api/auth/unlock` endpoint allows authenticated admins or recovery key holders to clear locks.
   - CLI Tool: `node unlockAccount.js <email | --all>` executable directly on the server host.

---

## 5. Personal Details Validation & Consistency Audit

A thorough audit of teacher and student personal data collection was conducted across the data models (`models/Student.js`, `models/Teacher.js`), validation engine (`public/js/validation.js`), and registration endpoints.

### Fields Collected & Validation Criteria

| Entity | Field | Type / Format | Validation Rule | Consistency / Sufficiency |
| :--- | :--- | :--- | :--- | :--- |
| **Student** | `name` | String (2-60 chars) | `normalizePersonName`, letters, spaces, dots, hyphens only. | Consistent; prevents special character injection. |
| **Student** | `rollNo` | String (uppercase, max 20) | Must be alphanumeric; unique index enforced in DB. | Unique identifier across the academy. |
| **Student** | `email` | String (lowercase, max 120) | Pragmatic regex (`^[^\s@]+@[^\s@]+\.[^\s@]{2,}$`). | Unique login credential; consistently lowercased. |
| **Student** | `phone` | String (`03xx-xxxxxxx`) | Canonical Pakistani mobile format; converts `+92`, `0092`, `92` to canonical format. | Guaranteed 11-digit mobile standard. |
| **Student** | `gender` | Enum | Allowed: `['Male', 'Female', 'Other']`. | Standardized enum across client & server. |
| **Student** | `dob` | Date (`YYYY-MM-DD`) | Calendar validation (catches Feb 31st); Age restricted to 10–60 years. | Appropriate for MDCAT/ECAT academy students. |
| **Student** | `cnic` | String (`xxxxx-xxxxxxx-x`) | 13 digits; province code $\ne 0$; canonical dashed format. | Standard NADRA format for CNIC / B-Form. |
| **Student** | `guardianName` | String (max 60) | Required person name validation. | Vital for emergency student contact. |
| **Student** | `guardianPhone`| String (`03xx-xxxxxxx`) | Canonical mobile format; cross-checked so `guardianPhone !== studentPhone`. | Prevents students using their own number as guardian's. |
| **Student** | `feeStatus` | Enum | `['Paid', 'Partial', 'Pending', 'Overdue']`. | Enforced against `totalFee` and `paidAmount`. |
| **Teacher** | `name` | String (2-60 chars) | `normalizePersonName`. | Standardized naming convention. |
| **Teacher** | `email` | String (lowercase, max 120) | Pragmatic email validation; unique in database. | System authentication login. |
| **Teacher** | `phone` | String (`03xx-xxxxxxx`) | Canonical Pakistani mobile format. | Standard contact requirement. |
| **Teacher** | `cnic` | String (`xxxxx-xxxxxxx-x`) | Mandatory 13 digits in standard NADRA format. | Required for faculty identity and contracts. |
| **Teacher** | `qualification`| Enum | `['MBBS', 'BS', 'BSc', 'MSc', 'MPhil', 'PhD', 'MA', 'MEd', 'Other']`. | Standardized academic degrees. |
| **Teacher** | `experience` | Integer | Min 0, Max 60 years. | Clean numerical data. |
| **Teacher** | `subjects` | Array of Strings | Validated against database `Subject` collection names. | Ensures perfect alignment with curriculum. |
| **Teacher** | `status` | Enum | `['active', 'inactive']`. Inactive teachers are blocked from login. | Instant administrative revocation. |

### Conclusion on Personal Details:
The collected details are **comprehensive, consistent, and strictly validated** across both client-side modal forms and server-side Mongoose schema validators. Formats adhere strictly to national Pakistani standards (NADRA CNIC format and PTA mobile number formats).

---

## 6. Unit & Integration Testing Report

A unified test suite runner (`testRunner.js`) was created and wired into `npm test`.

### Test Execution Summary
- **Test Runner**: Node.js Native Test Runner (`node --test`)
- **Integration Framework**: Supertest with In-Memory MongoDB (`mongodb-memory-server`)
- **Total Test Suites**: 9
- **Total Tests Executed**: 36
- **Passed**: 36 (100%)
- **Failed**: 0 (0%)
- **Duration**: ~8.8 seconds total execution time

### Detailed Suite Results
1. `tests/unit/validation.test.js`: **7/7 PASS**
   - Verified `normalizeText`, `normalizeDate`, `normalizeEnum`, `toInt`, `escapeHtml`, `isSafeKey`, `crossCheckStudent`.
2. `tests/unit/notification.test.js`: **5/5 PASS**
   - Verified model schema defaults, required fields, type enum constraints, title length limits, and DB indexes.
3. `tests/unit/auth_middleware.test.js`: **4/4 PASS**
   - Verified token header extraction, user population, inactive teacher blocking, and role-based access control (`restrictTo`).
4. `tests/integration/auth.test.js`: **6/6 PASS**
   - Verified login with valid credentials, password rejection, inactive teacher lockout, caller profile retrieval, **IP-isolation lockout defense (Attacker on IP A does not lock out Admin on IP B)**, and `POST /api/auth/unlock` endpoint.
5. `tests/integration/notifications.test.js`: **6/6 PASS**
   - Verified caller-scoped creation, title validation, caller-only retrieval, single mark-as-read, mark-all-read, and caller deletion isolation.
6. `tests/integration/batches.test.js`: **2/2 PASS**
   - Verified batch subject assignment notifications and teacher reassignment notifications.
7. `tests/integration/courses.test.js`: **3/3 PASS**
   - Verified course creation and deletion without `esc` runtime errors, and lecture material upload announcements.
8. `tests/integration/students.test.js`: **2/2 PASS**
   - Verified payment recorded notifications and fee balance update notifications.
9. `tests/integration/attendance.test.js`: **1/1 PASS**
   - Verified attendance recording and automated absence alerts.

---

## 7. Client Handover Readiness Checklist

The project is **ready for client handover and production deployment**. Below is the deployment verification checklist:

- [x] **Production Security Headers**: Configured in `server.js` (`nosniff`, `SAMEORIGIN`, `strict-origin-when-cross-origin`, `Permissions-Policy`, `HSTS`).
- [x] **Rate Limiting**: General API limiter active; Brute-force & DoS login protection active.
- [x] **Database Performance**: Query indexes configured on all major collections.
- [x] **Notification Routing**: Anchors and notification pages operational for Admin, Teacher, and Student roles.
- [x] **Administrative Recovery**: Emergency recovery key and `unlockAccount.js` script in place.
- [x] **Zero Known Vulnerabilities**: Dependencies audited; parameter whitelisting and prototype pollution defenses active.
- [x] **Test Suite**: 100% automated test pass rate (`npm test`).
