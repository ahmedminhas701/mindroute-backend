const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
const Inquiry = require('../../models/Inquiry');
const { startTestDb, stopTestDb, clearTestDb, makeToken } = require('../test_helper');

let adminUser, adminToken, studentUser, studentToken;

test.before(async () => {
  await startTestDb();
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearTestDb();

  adminUser = await User.create({
    name: 'Admin User',
    email: 'admin@mindroute.com',
    password: 'Password123!',
    role: 'admin',
  });

  studentUser = await User.create({
    name: 'Student One',
    email: 'student@mindroute.com',
    password: 'Password123!',
    role: 'student',
  });

  adminToken = makeToken(adminUser);
  studentToken = makeToken(studentUser);
});

test('Integration - POST /api/inquiries allows prospective students to submit inquiries', async () => {
  const res = await request(app)
    .post('/api/inquiries')
    .send({
      name: 'Ali Raza',
      email: 'ali.raza@example.com',
      phone: '0300-1234567',
      subject: 'MDCAT Batch Details',
      message: 'I would like to inquire about fee structure and class timings for the upcoming session.',
    });

  assert.equal(res.status, 201);
  assert.ok(res.body.id);
  assert.ok(res.body.message.includes('received'));

  const inDb = await Inquiry.findById(res.body.id);
  assert.ok(inDb);
  assert.equal(inDb.email, 'ali.raza@example.com');
  assert.equal(inDb.status, 'unread');
});

test('Integration - POST /api/inquiries rejects invalid input', async () => {
  const res = await request(app)
    .post('/api/inquiries')
    .send({
      name: '',
      email: 'not-an-email',
      phone: '123',
      message: '',
    });

  assert.equal(res.status, 400);
  assert.ok(res.body.message);
});

test('Integration - Admin can list, filter, update, and delete inquiries', async () => {
  const inq = await Inquiry.create({
    name: 'Sara Khan',
    email: 'sara@example.com',
    phone: '0321-9876543',
    subject: 'ECAT Prep',
    message: 'Need help enrolling in ECAT crash course session.',
    status: 'unread',
  });

  // Public/student cannot list inquiries
  const unauthRes = await request(app).get('/api/inquiries');
  assert.equal(unauthRes.status, 401);

  const studentRes = await request(app)
    .get('/api/inquiries')
    .set('Authorization', `Bearer ${studentToken}`);
  assert.equal(studentRes.status, 403);

  // Admin can list inquiries
  const adminRes = await request(app)
    .get('/api/inquiries')
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(adminRes.status, 200);
  assert.equal(adminRes.body.inquiries.length, 1);
  assert.equal(adminRes.body.inquiries[0].name, 'Sara Khan');
  assert.equal(adminRes.body.unreadCount, 1);

  // Admin can mark as read/replied
  const patchRes = await request(app)
    .patch(`/api/inquiries/${inq._id}`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      status: 'replied',
      replyNote: 'Spoke with candidate via WhatsApp and provided brochure.',
    });
  assert.equal(patchRes.status, 200);
  assert.equal(patchRes.body.status, 'replied');
  assert.equal(patchRes.body.replyNote, 'Spoke with candidate via WhatsApp and provided brochure.');

  // Admin can delete inquiry
  const delRes = await request(app)
    .delete(`/api/inquiries/${inq._id}`)
    .set('Authorization', `Bearer ${adminToken}`);
  assert.equal(delRes.status, 200);

  const checkDb = await Inquiry.findById(inq._id);
  assert.equal(checkDb, null);
});
