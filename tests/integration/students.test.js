const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
const Student = require('../../models/Student');
const Notification = require('../../models/Notification');
const { startTestDb, stopTestDb, clearTestDb, makeToken } = require('../test_helper');

let adminUser, adminToken, studentUser, studentRecord;

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

  studentUser = await User.create({ name: 'Student', email: 'student@test.com', role: 'student', password: 'hash' });

  studentRecord = await Student.create({
    id: 'S001',
    name: 'Student One',
    email: 'student@test.com',
    rollNo: 'R001',
    phone: '03001234567',
    gender: 'Male',
    totalFee: 50000,
    paidAmount: 20000,
    feeStatus: 'Partial',
  });
});

test('Students API - PUT /api/students/:id announces payment recorded', async () => {
  const res = await request(app)
    .put(`/api/students/${studentRecord.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      paidAmount: 30000,
      feeStatus: 'Partial',
    });

  assert.equal(res.status, 200);

  // Check notification to student
  const notif = await Notification.findOne({ userId: String(studentUser._id), type: 'fee' });
  assert.ok(notif, 'Student should receive fee notification');
  assert.equal(notif.title, 'Payment recorded');
  assert.ok(notif.body.includes('Rs. 10,000 received'));
  assert.ok(notif.body.includes('Remaining balance: Rs. 20,000'));
});

test('Students API - PUT /api/students/:id announces fee details updated on fee change without payment', async () => {
  const res = await request(app)
    .put(`/api/students/${studentRecord.id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      totalFee: 60000,
    });

  assert.equal(res.status, 200);

  // Check notification to student
  const notif = await Notification.findOne({ userId: String(studentUser._id), type: 'fee' });
  assert.ok(notif, 'Student should receive fee details updated notification');
  assert.equal(notif.title, 'Fee details updated');
});
