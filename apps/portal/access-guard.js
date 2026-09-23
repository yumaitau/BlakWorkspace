'use strict';
// Request guards for People & access writes: CSRF, same-origin, rate limits
// and an append-only audit journal beside the portal's other persisted state.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createCsrf(secret) {
  const key = crypto.createHash('sha256').update('blak-access-csrf:' + secret).digest();
  const token = sessionId => crypto.createHmac('sha256', key).update(String(sessionId)).digest('base64url');
  return {
    token,
    valid(sessionId, value) {
      if (!sessionId || typeof value !== 'string') return false;
      const expected = Buffer.from(token(sessionId));
      const given = Buffer.from(value);
      return given.length === expected.length && crypto.timingSafeEqual(given, expected);
    },
  };
}

// A browser POST must come from the portal itself. Origin is preferred;
// Referer is the fallback for clients that omit Origin on same-origin posts.
function sameOrigin(req, origin) {
  if (req.headers.origin) return req.headers.origin === origin;
  try { return new URL(req.headers.referer).origin === origin; } catch { return false; }
}

function createLimiter(limit, windowMs, now = Date.now) {
  const hits = new Map();
  return function allow(key) {
    const at = now();
    const recent = (hits.get(key) || []).filter(time => at - time < windowMs);
    if (recent.length >= limit) { hits.set(key, recent); return false; }
    recent.push(at);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [name, times] of hits) if (!times.some(time => at - time < windowMs)) hits.delete(name);
    return true;
  };
}

function createAudit(file) {
  return {
    file,
    record(entry) {
      const line = JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n';
      if (!file) { process.stdout.write('blak-access-audit ' + line); return; }
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.appendFileSync(file, line, { mode: 0o600 });
      } catch { process.stdout.write('blak-access-audit ' + line); } // Never lose the record: fall back to the pod log.
    },
    recent(limit = 100) {
      if (!file || !fs.existsSync(file)) return [];
      // Read only the tail: the journal is append-only and can grow.
      const size = fs.statSync(file).size, length = Math.min(size, 256 * 1024);
      const buffer = Buffer.alloc(length);
      const handle = fs.openSync(file, 'r');
      try { fs.readSync(handle, buffer, 0, length, size - length); } finally { fs.closeSync(handle); }
      const lines = buffer.toString('utf8').split('\n').slice(size > length ? 1 : 0).filter(Boolean).slice(-limit);
      return lines.map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean).reverse();
    },
  };
}

module.exports = { createCsrf, sameOrigin, createLimiter, createAudit };
