const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
const Teacher = require('../../models/Teacher');
const Student = require('../../models/Student');
const Batch = require('../../models/Batch');
const EntryTest = require('../../models/EntryTest');
const Subject = require('../../models/Subject');
const Notification = require('../../models/Notification');
const { startTestDb, stopTestDb, clearTestDb, makeToken } = require('../test_helper');

let adminUser, adminToken, teacher1User, teacher1Token, teacher2User;
let teacher1, teacher2, student1, entryTest;

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

  teacher1User = await User.create({ name: 'Teacher 1', email: 'teacher1@test.com', role: 'teacher', password: 'hash' });
  teacher2User = await User.create({ name: 'Teacher 2', email: 'teacher2@test.com', role: 'teacher', password: 'hash' });

  await Subject.create({ name: 'Biology' });
  await Subject.create({ name: 'Physics' });

  teacher1 = await Teacher.create({
    id: 'T001',
    name: 'Teacher One',
    email: 'teacher1@test.com',
    phone: '03001111111',
    subjects: ['Biology', 'Physics'],
    status: 'active',
  });

  teacher2 = await Teacher.create({
    id: 'T002',
    name: 'Teacher Two',
    email: 'teacher2@test.com',
    phone: '03002222222',
    subjects: ['Biology', 'Physics'],
    status: 'active',
  });

  student1 = await Student.create({
    id: 'S001',
    name: 'Student One',
    email: 'student1@test.com',
    rollNo: 'R001',
    phone: '03003333333',
    gender: 'Male',
    totalFee: 50000,
    paidAmount: 20000,
    feeStatus: 'Partial',
  });

  entryTest = await EntryTest.create({
    id: 'ET001',
    name: 'MDCAT',
    subjects: ['Biology', 'Physics'],
  });
});

test('Batches API - POST /api/batches notifies teacher of subject assignment', async () => {
  const res = await request(app)
    .post('/api/batches')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: 'Batch Delta',
      entryTestId: 'ET001',
      startDate: '2026-07-01',
      status: 'active',
      studentIds: ['S001'],
      subjectTeachers: { Biology: 'T001' },
    });

  assert.equal(res.status, 201);

  // Check notification to Teacher 1
  const notif = await Notification.findOne({ userId: String(teacher1User._id), type: 'change' });
  assert.ok(notif, 'Teacher 1 should receive subject assigned notification');
  assert.equal(notif.title, 'Subject assigned');
  assert.ok(notif.body.includes('assigned to teach Biology in Batch Delta'));
});

test('Batches API - PUT /api/batches/:id notifies on teacher reassignment', async () => {
  const batch = await Batch.create({
    id: 'B002',
    name: 'Batch Epsilon',
    entryTestId: 'ET001',
    entryTest: 'MDCAT',
    startDate: '2026-07-01',
    status: 'active',
    studentIds: ['S001'],
    subjectTeachers: { Biology: 'T001' },
  });

  // Update batch: assign Biology to Teacher 2 instead
  const res = await request(app)
    .put(`/api/batches/${batch.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      name: 'Batch Epsilon',
      entryTestId: 'ET001',
      startDate: '2026-07-01',
      status: 'active',
      studentIds: ['S001'],
      subjectTeachers: { Biology: 'T002' },
    });

  assert.equal(res.status, 200);

  // Teacher 1 should be unassigned
  const t1Notif = await Notification.findOne({ userId: String(teacher1User._id), title: 'Subject unassigned' });
  assert.ok(t1Notif, 'Teacher 1 should receive Subject unassigned notification');

  // Teacher 2 should be assigned
  const t2Notif = await Notification.findOne({ userId: String(teacher2User._id), title: 'Subject assigned' });
  assert.ok(t2Notif, 'Teacher 2 should receive Subject assigned notification');
});
