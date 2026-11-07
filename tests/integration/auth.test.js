const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const app = require('../../server');
const User = require('../../models/User');
const Teacher = require('../../models/Teacher');
const { clearAllBuckets } = require('../../middleware/rateLimit');
const { startTestDb, stopTestDb, clearTestDb, makeToken } = require('../test_helper');

test.before(async () => {
  await startTestDb();
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearTestDb();
  clearAllBuckets();

  const passwordHash = await bcrypt.hash('secret123', 10);
  await User.create({
    name: 'Test Student',
    email: 'student@example.com',
    password: passwordHash,
    role: 'student',
  });

  await User.create({
    name: 'Admin User',
    email: 'admin@example.com',
    password: passwordHash,
    role: 'admin',
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

test('Auth API - Attacker on IP A failing passwords does NOT lock out legitimate user on IP B', async () => {
  // Attacker fails 5 times on IP 10.0.0.1
  for (let i = 0; i < 5; i++) {
    await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '10.0.0.1')
      .send({ email: 'admin@example.com', password: 'wrong' });
  }

  // Attacker is now locked out from IP 10.0.0.1
  const attackerRes = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.0.0.1')
    .send({ email: 'admin@example.com', password: 'wrong' });
  assert.equal(attackerRes.status, 429, 'Attacker should be rate-limited');

  // Legitimate admin on IP 10.0.0.2 logs in with correct password: must SUCCEED!
  const adminRes = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '10.0.0.2')
    .send({ email: 'admin@example.com', password: 'secret123' });

  assert.equal(adminRes.status, 200, 'Legitimate admin on different IP must not be locked out by attacker');
  assert.ok(adminRes.body.token);
});

test('Auth API - POST /api/auth/unlock clears lockout buckets for admin', async () => {
  // Lock out an IP
  for (let i = 0; i < 5; i++) {
    await request(app)
      .post('/api/auth/login')
      .set('X-Forwarded-For', '192.168.1.50')
      .send({ email: 'admin@example.com', password: 'wrong' });
  }

  const lockedRes = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '192.168.1.50')
    .send({ email: 'admin@example.com', password: 'wrong' });
  assert.equal(lockedRes.status, 429);

  // Admin unlocks the account using JWT or emergency key
  const adminUser = await User.findOne({ email: 'admin@example.com' });
  const adminToken = makeToken(adminUser);

  const unlockRes = await request(app)
    .post('/api/auth/unlock')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ email: 'admin@example.com' });

  assert.equal(unlockRes.status, 200);

  // Now IP 192.168.1.50 can log in with correct password
  const freshLogin = await request(app)
    .post('/api/auth/login')
    .set('X-Forwarded-For', '192.168.1.50')
    .send({ email: 'admin@example.com', password: 'secret123' });

  assert.equal(freshLogin.status, 200);
});
