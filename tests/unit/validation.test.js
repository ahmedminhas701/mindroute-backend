const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../../utils/validate');

test('Validation - normalizeText', () => {
  assert.equal(V.normalizeText('  Hello World  ').value, 'Hello World');
  assert.equal(V.normalizeText(null, { required: false }).value, '');
  assert.equal(V.normalizeText(null, { required: true }).ok, false);
  assert.equal(V.normalizeText('<script>alert(1)</script>').ok, false);
});

test('Validation - normalizeDate', () => {
  assert.equal(V.normalizeDate('2026-05-15').ok, true);
  assert.equal(V.normalizeDate('2026-05-15').value, '2026-05-15');
  assert.equal(V.normalizeDate('invalid-date').ok, false);
});

test('Validation - normalizeEnum', () => {
  const allowed = ['admin', 'teacher', 'student'];
  assert.equal(V.normalizeEnum('teacher', { values: allowed }).value, 'teacher');
  assert.equal(V.normalizeEnum('superadmin', { values: allowed }).ok, false);
  assert.equal(V.normalizeEnum(null, { values: allowed, default: 'student' }).value, 'student');
});

test('Validation - toInt', () => {
  assert.equal(V.toInt('42').value, 42);
  assert.equal(V.toInt(42).value, 42);
  assert.equal(V.toInt('invalid').ok, false);
  assert.equal(V.toInt('10', { min: 20 }).ok, false);
  assert.equal(V.toInt('50', { max: 30 }).ok, false);
});

test('Validation - escapeHtml & esc', () => {
  assert.equal(V.escapeHtml('<div class="box">O\'Reilly & Sons</div>'), '&lt;div class=&quot;box&quot;&gt;O&#39;Reilly &amp; Sons&lt;/div&gt;');
  assert.equal(V.esc('<b>Test</b>'), '&lt;b&gt;Test&lt;/b&gt;');
  assert.equal(V.escapeHtml(null), '');
  assert.equal(V.escapeHtml(undefined), '');
});

test('Validation - isSafeKey', () => {
  assert.equal(V.isSafeKey('title'), true);
  assert.equal(V.isSafeKey('description'), true);
  assert.equal(V.isSafeKey('__proto__'), false);
  assert.equal(V.isSafeKey('constructor'), false);
  assert.equal(V.isSafeKey('prototype'), false);
});

test('Validation - crossCheckStudent', () => {
  const errors1 = V.crossCheckStudent({ totalFee: 10000, paidAmount: 15000 });
  assert.ok(errors1.paidAmount, 'Paid amount cannot exceed total fee');

  const errors2 = V.crossCheckStudent({ totalFee: 10000, paidAmount: 5000, feeStatus: 'Paid' });
  assert.ok(errors2.feeStatus, 'Paid status invalid when paidAmount < totalFee');

  const errors3 = V.crossCheckStudent({ totalFee: 10000, paidAmount: 5000, feeStatus: 'Pending' });
  assert.ok(errors3.feeStatus, 'Pending status invalid when paidAmount > 0');

  const errors4 = V.crossCheckStudent({ phone: '03001234567', guardianPhone: '03001234567' });
  assert.ok(errors4.guardianPhone, 'Guardian phone cannot equal student phone');
});
