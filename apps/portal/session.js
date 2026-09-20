'use strict';
const crypto = require('node:crypto');
const COOKIE = 'blak_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LOGIN_TTL_MS = 10 * 60 * 1000;
if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) throw new Error('SESSION_SECRET is required in production');
const secret = process.env.SESSION_SECRET || 'dev-only-change-me';

function sign(value) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`;
}
function readCookie(req, name) {
  return (req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) || '';
}
function verifySession(req) {
  const parts = readCookie(req, COOKIE).split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!/^[A-Za-z0-9_-]{43}$/.test(signature) || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!session || typeof session.sub !== 'string' || !session.sub.trim() || !Number.isFinite(session.exp) || session.exp <= Date.now()) return null;
    return session;
  } catch { return null; }
}
function loginCookie(state, redirectUri) {
  return `blak_login=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${state ? LOGIN_TTL_MS / 1000 : 0}${redirectUri.startsWith('https:') ? '; Secure' : ''}`;
}
module.exports = { COOKIE, SESSION_TTL_MS, LOGIN_TTL_MS, sign, verifySession, readCookie, loginCookie };
