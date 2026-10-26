const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../server');
const User = require('../../models/User');
const Notification = require('../../models/Notification');
const { startTestDb, stopTestDb, clearTestDb, makeToken } = require('../test_helper');

let user1, user2, token1, token2;

test.before(async () => {
  await startTestDb();
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearTestDb();

  user1 = await User.create({
    name: 'User One',
    email: 'user1@example.com',
    password: 'password123',
    role: 'student',
  });

  user2 = await User.create({
    name: 'User Two',
    email: 'user2@example.com',
    password: 'password123',
    role: 'teacher',
  });

  token1 = makeToken(user1);
  token2 = makeToken(user2);
});

test('Integration - POST /api/notifications creates notification for caller only', async () => {
  const res = await request(app)
    .post('/api/notifications')
    .set('Authorization', `Bearer ${token1}`)
    .send({
      title: 'Practice Test Due',
      body: 'Complete chapter 1 test before Friday',
      type: 'due',
      userId: String(user2._id), // attempting to create for user2
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.title, 'Practice Test Due');
  assert.equal(res.body.type, 'due');
  assert.equal(res.body.read, false);

  // In database, it must belong to user1 (the caller), NOT user2
  const inDb = await Notification.findById(res.body._id);
  assert.equal(inDb.userId, String(user1._id));
});

test('Integration - POST /api/notifications validates title is required', async () => {
  const res = await request(app)
    .post('/api/notifications')
    .set('Authorization', `Bearer ${token1}`)
    .send({ body: 'Missing title' });

  assert.equal(res.status, 400);
  assert.equal(res.body.message, 'A title is required.');
});

test('Integration - GET /api/notifications returns caller own notifications only', async () => {
  await Notification.create({
    userId: String(user1._id),
    title: 'Notif for user 1',
    type: 'assignment',
    read: false,
  });
  await Notification.create({
    userId: String(user2._id),
    title: 'Notif for user 2',
    type: 'grade',
    read: false,
  });

  const res1 = await request(app)
    .get('/api/notifications')
    .set('Authorization', `Bearer ${token1}`);

  assert.equal(res1.status, 200);
  assert.equal(res1.body.length, 1);
  assert.equal(res1.body[0].title, 'Notif for user 1');
  assert.equal(typeof res1.body[0].read, 'boolean');

  const res2 = await request(app)
    .get('/api/notifications')
    .set('Authorization', `Bearer ${token2}`);

  assert.equal(res2.status, 200);
  assert.equal(res2.body.length, 1);
  assert.equal(res2.body[0].title, 'Notif for user 2');
});

test('Integration - PATCH /api/notifications/:id/read marks single notification as read', async () => {
  const n = await Notification.create({
    userId: String(user1._id),
    title: 'Mark Me Read',
    read: false,
  });

  // Attempt with invalid ObjectId
  const badRes = await request(app)
    .patch('/api/notifications/invalid-id/read')
    .set('Authorization', `Bearer ${token1}`);
  assert.equal(badRes.status, 400);

  // Attempt with user2 (cannot mark user1's notification)
  const wrongUserRes = await request(app)
    .patch(`/api/notifications/${n._id}/read`)
    .set('Authorization', `Bearer ${token2}`);
  assert.equal(wrongUserRes.status, 404);

  // Correct user
  const goodRes = await request(app)
    .patch(`/api/notifications/${n._id}/read`)
    .set('Authorization', `Bearer ${token1}`);
  assert.equal(goodRes.status, 200);
  assert.equal(goodRes.body.message, 'Marked as read.');

  const updated = await Notification.findById(n._id);
  assert.equal(updated.read, true);
});

test('Integration - PATCH /api/notifications/read-all marks all caller notifications read', async () => {
  await Notification.create({ userId: String(user1._id), title: 'Item 1', read: false });
  await Notification.create({ userId: String(user1._id), title: 'Item 2', read: false });
  await Notification.create({ userId: String(user2._id), title: 'User 2 Item', read: false });

  const res = await request(app)
    .patch('/api/notifications/read-all')
    .set('Authorization', `Bearer ${token1}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.updated, 2);

  const u1Notifs = await Notification.find({ userId: String(user1._id) });
  assert.ok(u1Notifs.every(n => n.read === true));

  const u2Notifs = await Notification.find({ userId: String(user2._id) });
  assert.equal(u2Notifs[0].read, false);
});

test('Integration - DELETE /api/notifications/:id and DELETE /api/notifications', async () => {
  const n1 = await Notification.create({ userId: String(user1._id), title: 'Item 1' });
  const n2 = await Notification.create({ userId: String(user1._id), title: 'Item 2' });
  const n3 = await Notification.create({ userId: String(user2._id), title: 'User 2 Item' });

  // Delete single
  const delSingle = await request(app)
    .delete(`/api/notifications/${n1._id}`)
    .set('Authorization', `Bearer ${token1}`);
  assert.equal(delSingle.status, 200);
  assert.equal(delSingle.body.message, 'Deleted.');

  // Clear all for user 1
  const delAll = await request(app)
    .delete('/api/notifications')
    .set('Authorization', `Bearer ${token1}`);
  assert.equal(delAll.status, 200);
  assert.equal(delAll.body.deleted, 1);

  // User 2 notification is untouched
  const u2Exists = await Notification.findById(n3._id);
  assert.ok(u2Exists);
});
