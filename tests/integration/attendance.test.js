const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
const Student = require('../../models/Student');
const Teacher = require('../../models/Teacher');
const Course = require('../../models/Course');
const Notification = require('../../models/Notification');
const { startTestDb, stopTestDb, clearTestDb, makeToken } = require('../test_helper');

let adminUser, adminToken, student1User, student2User;
let student1, student2, course;

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

  student1User = await User.create({ name: 'Student 1', email: 's1@test.com', role: 'student', password: 'hash' });
  student2User = await User.create({ name: 'Student 2', email: 's2@test.com', role: 'student', password: 'hash' });

  student1 = await Student.create({
    id: 'S001',
    name: 'Student One',
    email: 's1@test.com',
    rollNo: 'R001',
    phone: '03001111111',
    gender: 'Male',
    totalFee: 50000,
    paidAmount: 20000,
    feeStatus: 'Partial',
    enrolledCourseIds: [105],
  });

  student2 = await Student.create({
    id: 'S002',
    name: 'Student Two',
    email: 's2@test.com',
    rollNo: 'R002',
    phone: '03002222222',
    gender: 'Female',
    totalFee: 50000,
    paidAmount: 20000,
    feeStatus: 'Partial',
    enrolledCourseIds: [105],
  });

  course = await Course.create({
    id: 105,
    title: 'MDCAT Chemistry',
    subject: 'Chemistry',
    batchId: 'B001',
    teacher: 'T001',
    weeks: [],
  });
});

test('Attendance API - POST /api/attendance parses JSON and notifies newly absent students', async () => {
  const res = await request(app)
    .post('/api/attendance')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      courseId: 105,
      date: '2026-05-10',
      entries: [
        { studentId: 'S001', present: true },
        { studentId: 'S002', present: false }, // marked absent
      ],
    });

  assert.equal(res.status, 201, `Failed to save attendance: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.message, 'Attendance saved.');

  // Check notification to Student 2 (absent)
  const notif = await Notification.findOne({ userId: String(student2User._id), type: 'change' });
  assert.ok(notif, 'Absent student should receive notification');
  assert.equal(notif.title, 'Marked absent');
  assert.ok(notif.body.includes('MDCAT Chemistry on 2026-05-10'));

  // Student 1 (present) should NOT receive an absent notification
  const s1Notif = await Notification.findOne({ userId: String(student1User._id), title: 'Marked absent' });
  assert.equal(s1Notif, null);
});
