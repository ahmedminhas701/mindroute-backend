const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../server');
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

  const passwordHash = await bcrypt.hash('secret123', 10);
  await User.create({
    name: 'Test Student',
    email: 'student@example.com',
    password: passwordHash,
    role: 'student',
  });

  await User.create({
    name: 'Inactive Teacher',
    email: 'inactive@example.com',
    password: passwordHash,
    role: 'teacher',
  });
  await Teacher.create({
    id: 'T999',
    name: 'Inactive Teacher',
    email: 'inactive@example.com',
    phone: '03001234567',
    subjects: ['Physics'],
    status: 'inactive',
  });
});

test('Auth API - POST /api/auth/login succeeds with valid credentials', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'student@example.com',
      password: 'secret123',
    });

  assert.equal(res.status, 200);
  assert.ok(res.body.token, 'Should return a JWT token');
  assert.equal(res.body.user.email, 'student@example.com');
  assert.equal(res.body.user.role, 'student');
});

test('Auth API - POST /api/auth/login rejects wrong password', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'student@example.com',
      password: 'wrong_password',
    });

  assert.equal(res.status, 401);
  assert.equal(res.body.message, 'Invalid email or password.');
});

test('Auth API - POST /api/auth/login blocks inactive teacher account', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({
      email: 'inactive@example.com',
      password: 'secret123',
    });

  assert.equal(res.status, 403);
  assert.equal(res.body.message, 'This account is inactive. Please contact your administrator.');
});

test('Auth API - GET /api/auth/me returns caller profile', async () => {
  const user = await User.findOne({ email: 'student@example.com' });
  const token = makeToken(user);

  const res = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.email, 'student@example.com');
  assert.equal(res.body.role, 'student');
});
