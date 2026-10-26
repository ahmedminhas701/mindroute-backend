const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
const Teacher = require('../../models/Teacher');
const Student = require('../../models/Student');
const Batch = require('../../models/Batch');
const Course = require('../../models/Course');
const EntryTest = require('../../models/EntryTest');
const Subject = require('../../models/Subject');
const Notification = require('../../models/Notification');
const { startTestDb, stopTestDb, clearTestDb, makeToken } = require('../test_helper');

let adminUser, adminToken, teacherUser, teacherToken, studentUser, studentToken;
let testEntryTest, testBatch, testTeacher, testStudent;

test.before(async () => {
  await startTestDb();
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearTestDb();

  adminUser = await User.create({ name: 'Admin', email: 'admin@test.com', role: 'admin', password: 'hash' });
  adminToken = makeToken(adminUser);

  teacherUser = await User.create({ name: 'Teacher', email: 'teacher@test.com', role: 'teacher', password: 'hash' });
  teacherToken = makeToken(teacherUser);

  studentUser = await User.create({ name: 'Student', email: 'student@test.com', role: 'student', password: 'hash' });
  studentToken = makeToken(studentUser);

  await Subject.create({ name: 'Biology' });
  await Subject.create({ name: 'Physics' });
  await Subject.create({ name: 'Chemistry' });

  testTeacher = await Teacher.create({
    id: 'T001',
    name: 'Teacher One',
    email: 'teacher@test.com',
    phone: '03001234567',
    subjects: ['Biology', 'Physics'],
    status: 'active',
    courseIds: [],
  });

  testStudent = await Student.create({
    id: 'S001',
    name: 'Student One',
    email: 'student@test.com',
    rollNo: 'R001',
    phone: '03007654321',
    gender: 'Male',
    totalFee: 50000,
    paidAmount: 20000,
    feeStatus: 'Partial',
    enrolledCourseIds: [],
  });

  testEntryTest = await EntryTest.create({
    id: 'ET001',
    name: 'MDCAT',
    subjects: ['Biology', 'Physics', 'Chemistry'],
  });

  testBatch = await Batch.create({
    id: 'B001',
    name: 'MDCAT Alpha 2026',
    entryTestId: 'ET001',
    entryTest: 'MDCAT',
    startDate: '2026-06-01',
    status: 'active',
    studentIds: ['S001'],
    subjectTeachers: { Biology: 'T001' },
  });
});

test('Courses API - POST /api/courses creates course and sends notifications without esc error', async () => {
  const res = await request(app)
    .post('/api/courses')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      batchId: 'B001',
      subject: 'Biology',
      title: 'MDCAT Biology Intensive',
      icon: 'B',
      color: '#1B5FAD',
      description: 'Comprehensive MDCAT Biology course',
    });

  // Verify response
  assert.equal(res.status, 201, `Expected 201 but got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.title, 'MDCAT Biology Intensive');
  assert.equal(res.body.subject, 'Biology');
  assert.equal(res.body.teacher, 'T001');

  // Verify student was enrolled
  const updatedStudent = await Student.findOne({ id: 'S001' });
  assert.ok(updatedStudent.enrolledCourseIds.includes(res.body.id));

  // Verify notifications were created for student and teacher
  const studentNotif = await Notification.findOne({ userId: String(studentUser._id), type: 'change' });
  assert.ok(studentNotif, 'Student should receive "New course available" notification');
  assert.ok(studentNotif.title.includes('New course available'));

  const teacherNotif = await Notification.findOne({ userId: String(teacherUser._id), type: 'change' });
  assert.ok(teacherNotif, 'Teacher should receive "New course assigned" notification');
  assert.ok(teacherNotif.title.includes('New course assigned'));
});

test('Courses API - DELETE /api/courses/:id deletes course cleanly without esc error', async () => {
  // First create a course
  const course = await Course.create({
    id: 101,
    title: 'MDCAT Physics',
    subject: 'Physics',
    batchId: 'B001',
    teacher: 'T001',
    weeks: [],
  });
  await Student.updateOne({ id: 'S001' }, { $push: { enrolledCourseIds: 101 } });
  await Teacher.updateOne({ id: 'T001' }, { $push: { courseIds: 101 } });

  // Delete course with force=true
  const res = await request(app)
    .delete('/api/courses/101?force=true')
    .set('Authorization', `Bearer ${adminToken}`);

  assert.equal(res.status, 200, `Expected 200 but got ${res.status}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.message, 'Course removed.');

  // Verify course is gone from database
  const exists = await Course.findOne({ id: 101 });
  assert.equal(exists, null);

  // Verify student was unenrolled
  const s = await Student.findOne({ id: 'S001' });
  assert.ok(!s.enrolledCourseIds.includes(101));

  // Verify teacher was unenrolled
  const t = await Teacher.findOne({ id: 'T001' });
  assert.ok(!t.courseIds.includes(101));
});

test('Courses API - PUT content URL announces upload to course students', async () => {
  const course = await Course.create({
    id: 102,
    title: 'MDCAT Biology',
    subject: 'Biology',
    batchId: 'B001',
    teacher: 'T001',
    weeks: [
      {
        num: 1,
        title: 'Cell Biology',
        topics: [
          {
            id: 'top1',
            title: 'Cell Structure',
            contents: [
              { type: 'notes', label: 'Cell Notes PDF', url: '' },
            ],
          },
        ],
      },
    ],
  });
  await Student.updateOne({ id: 'S001' }, { $push: { enrolledCourseIds: 102 } });

  // Update content URL
  const res = await request(app)
    .put('/api/courses/102/weeks/0/topics/0/contents/0')
    .set('Authorization', `Bearer ${teacherToken}`)
    .send({
      field: 'url',
      value: 'https://example.com/cell-notes.pdf',
    });

  assert.equal(res.status, 200);

  // Check upload notification to student
  const uploadNotif = await Notification.findOne({ userId: String(studentUser._id), type: 'upload' });
  assert.ok(uploadNotif, 'Student should receive upload notification');
  assert.ok(uploadNotif.title.includes('New material'));
  assert.ok(uploadNotif.body.includes('Cell Notes PDF'));
});
