// ── Dependency-free rate limiter ─────────────────────────────────────────
//
// Deliberately NOT express-rate-limit: this project has no npm access in the
// build environment it was last worked on, and pulling a dependency for ~40
// lines of logic isn't worth it. If you later add express-rate-limit, this
// module can be swapped out without touching any route file.
//
// Fixed-window counter held in process memory. That means:
//   - it resets when the server restarts (acceptable - a brute-force run that
//     survives a restart is not the threat model here)
//   - it does NOT work across multiple server instances. If you ever run more
//     than one node process behind a load balancer, move this to Redis or the
//     database, otherwise the effective limit is (limit x instances).
//
// Buckets are keyed by IP *and* by a caller-supplied key (for login we add the
// submitted email). Keying on IP alone lets one attacker on a shared NAT lock
// out everyone behind it; keying on email alone lets a distributed attacker
// walk around the limit. Tracking both means either signal trips the brake.

const buckets = new Map();

// Housekeeping: without this, a long-running server accumulates one Map entry
// per unique IP/email forever, which is a slow memory leak. unref() so this
// timer never holds the process open.
const SWEEP_MS = 5 * 60 * 1000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, SWEEP_MS);
if (typeof sweeper.unref === 'function') sweeper.unref();

function hit(key, limit, windowMs) {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    exceeded: bucket.count > limit,
    retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/**
 * rateLimit({ windowMs, max, keyFn })
 *
 * keyFn(req) may return a string or an array of strings. Every returned key is
 * counted independently and the request is blocked if ANY of them is over the
 * limit.
 */
function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, keyFn = null, message = 'Too many requests. Please try again later.' } = {}) {
  return function rateLimitMiddleware(req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    let keys = keyFn ? keyFn(req) : ip;
    if (!Array.isArray(keys)) keys = [keys];
    keys = keys.filter(Boolean).map(k => `${req.baseUrl}${req.path}|${k}`);
    if (!keys.length) keys = [`${req.baseUrl}${req.path}|${ip}`];

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

/**
 * Call after a *successful* login so a legitimate user who fat-fingered their
 * password a few times isn't still carrying those strikes.
 */
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
  if (!b) { b = { count: 0, resetAt: Date.now() + windowMs }; buckets.set(key, b); }
  b.count += 1;
}

function clearKey(key) { buckets.delete(key); }

module.exports = { rateLimit, resetRateLimit, secondsUntilAllowed, recordFailure, clearKey };


