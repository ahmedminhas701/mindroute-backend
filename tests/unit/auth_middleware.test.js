const test = require('node:test');
const assert = require('node:assert/strict');
const { protect, restrictTo } = require('../../middleware/auth');
const User = require('../../models/User');
const Teacher = require('../../models/Teacher');
const { startTestDb, stopTestDb, clearTestDb, makeToken } = require('../test_helper');

test.before(async () => {
  await startTestDb();
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearTestDb();
});

test('Auth Middleware - protect rejects missing or invalid header', async () => {
  let statusCode = null;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; },
  };

  // Missing Authorization header
  await protect({ headers: {} }, res, () => {});
  assert.equal(statusCode, 401);
  assert.equal(responseData.message, 'Not authenticated.');

  // Malformed token
  await protect({ headers: { authorization: 'Bearer invalid.token.here' } }, res, () => {});
  assert.equal(statusCode, 401);
  assert.equal(responseData.message, 'Invalid or expired token.');
});

test('Auth Middleware - protect loads active user and attaches to req.user', async () => {
  const user = await User.create({
    name: 'Admin User',
    email: 'admin@example.com',
    password: 'hashedpassword',
    role: 'admin',
  });

  const token = makeToken(user);
  let nextCalled = false;
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = {};

  await protect(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(String(req.user._id), String(user._id));
  assert.equal(req.user.email, 'admin@example.com');
  assert.equal(req.user.role, 'admin');
});

test('Auth Middleware - protect blocks inactive teacher', async () => {
  const user = await User.create({
    name: 'Inactive Teacher',
    email: 'teacher@example.com',
    password: 'hashedpassword',
    role: 'teacher',
  });
  await Teacher.create({
    id: 'T001',
    name: 'Inactive Teacher',
    email: 'teacher@example.com',
    phone: '03001234567',
    subjects: ['Physics'],
    status: 'inactive',
  });

  const token = makeToken(user);
  let statusCode = null;
  let responseData = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(data) { responseData = data; return this; },
  };
  const req = { headers: { authorization: `Bearer ${token}` } };

  await protect(req, res, () => {});
  assert.equal(statusCode, 403);
  assert.equal(responseData.message, 'This account is inactive.');
});

test('Auth Middleware - restrictTo allows authorized role, blocks unauthorized', () => {
  const adminReq = { user: { role: 'admin' } };
  const studentReq = { user: { role: 'student' } };

  let statusCode = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json() { return this; },
  };

  let nextCalled = false;
  restrictTo('admin')(adminReq, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);

  nextCalled = false;
  restrictTo('admin')(studentReq, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
});
