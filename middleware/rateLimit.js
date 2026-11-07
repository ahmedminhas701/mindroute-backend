// ── Dependency-free rate limiter with DoS & Memory Protection ───────────────
//
// Fixed-window counter held in process memory with LRU eviction and memory bounds.
// Supports:
//   - General route rate limiting
//   - Login failure-only limiting with composite (IP + Email) keys to prevent
//     Denial-of-Service / Account Lockout attacks.
//   - Emergency account/IP unlocking

const MAX_BUCKETS = 50000; // Hard memory cap to prevent memory exhaustion under high DoS traffic
const buckets = new Map();

// Housekeeping: sweep expired buckets every 5 minutes
const SWEEP_MS = 5 * 60 * 1000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

function setBucket(key, bucket) {
  if (buckets.size >= MAX_BUCKETS) {
    // Evict expired first
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(k);
    }
    // If still over cap, delete the first 500 oldest entries
    if (buckets.size >= MAX_BUCKETS) {
      let count = 0;
      for (const k of buckets.keys()) {
        buckets.delete(k);
        if (++count >= 500) break;
      }
    }
  }
  buckets.set(key, bucket);
}

function hit(key, limit, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    setBucket(key, bucket);
  }
  bucket.count += 1;
  return {
    exceeded: bucket.count > limit,
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/**
 * rateLimit({ windowMs, max, keyFn, message })
 */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 100, keyFn = null, message = 'Too many requests. Please try again later.' } = {}) {
  return function rateLimitMiddleware(req, res, next) {
    const ip = (req.headers && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : '') || req.ip || req.connection?.remoteAddress || 'unknown';
    let keys = keyFn ? keyFn(req) : ip;
    if (!Array.isArray(keys)) keys = [keys];
    keys = keys.filter(Boolean).map(k => `${req.baseUrl || ''}${req.path || ''}|${k}`);
    if (!keys.length) keys = [`${req.baseUrl || ''}${req.path || ''}|${ip}`];

    let worst = 0;
    let blocked = false;
    for (const key of keys) {
      const result = hit(key, max, windowMs);
      if (result.exceeded) blocked = true;
      if (result.retryAfterSec > worst) worst = result.retryAfterSec;
    }

    if (blocked) {
      res.set('Retry-After', String(worst));
      return res.status(429).json({ message });
    }
    next();
  };
}

function resetRateLimit(pathKey, ...identifiers) {
  identifiers.filter(Boolean).forEach(id => buckets.delete(`${pathKey}|${id}`));
}

// ── Failure-only limiter (used by login) ──────────────────────────────────
function activeBucket(key) {
  const b = buckets.get(key);
  if (!b) return null;
  if (b.resetAt <= Date.now()) { buckets.delete(key); return null; }
  return b;
}

/** Seconds to wait if ANY [key, max] pair is at its limit, else 0. */
function secondsUntilAllowed(checks) {
  let wait = 0;
  for (const [key, max] of checks) {
    const b = activeBucket(key);
    if (b && b.count >= max) wait = Math.max(wait, Math.ceil((b.resetAt - Date.now()) / 1000));
  }
  return wait;
}

function recordFailure(key, windowMs) {
  let b = activeBucket(key);
  if (!b) {
    b = { count: 0, resetAt: Date.now() + windowMs };
    setBucket(key, b);
  }
  b.count += 1;
}

function clearKey(key) { buckets.delete(key); }

function unlockAccount(email) {
  if (!email) return 0;
  const needle = String(email).toLowerCase().trim();
  let cleared = 0;
  for (const k of buckets.keys()) {
    if (k.includes(needle)) {
      buckets.delete(k);
      cleared++;
    }
  }
  return cleared;
}

function clearAllBuckets() {
  const count = buckets.size;
  buckets.clear();
  return count;
}

module.exports = {
  rateLimit,
  resetRateLimit,
  secondsUntilAllowed,
  recordFailure,
  clearKey,
  unlockAccount,
  clearAllBuckets,
};
