// Minimal in-memory token-bucket style limiter for Socket.IO events.
// express-rate-limit only guards HTTP routes; this app has no relevant HTTP
// routes to protect, so socket events (create-room, join-room, OTP guesses)
// are throttled by hand here instead.

const buckets = new Map(); // key: `${action}:${identity}` -> { count, resetAt }

function checkLimit(identity, action, { max, windowMs }) {
  const key = `${action}:${identity}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= max) {
    return false;
  }

  bucket.count += 1;
  return true;
}

// Periodically drop expired buckets so this Map doesn't grow forever.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

module.exports = { checkLimit };
