'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function createSessionStore(file, secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const sessions = new Map();
  if (file && fs.existsSync(file)) {
    const raw = fs.readFileSync(file);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const data = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString());
    for (const [id, session] of data) if (session.exp > Date.now()) sessions.set(id, session);
  }
  function persist() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify([...sessions])), cipher.final()]);
    fs.writeFileSync(file + '.tmp', Buffer.concat([iv, cipher.getAuthTag(), encrypted]), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  }
  return {
    create(session) {
      for (const [id, value] of sessions) if (value.exp <= Date.now()) sessions.delete(id);
      const id = crypto.randomBytes(32).toString('base64url');
      sessions.set(id, session); persist(); return id;
    },
    get(id) { const value = sessions.get(id); return value?.exp > Date.now() ? value : null; },
    update(id, values) { if (!sessions.has(id)) return false; Object.assign(sessions.get(id), values); persist(); return true; },
    revoke(id) { sessions.delete(id); persist(); },
    revokeIdentity({ sid, sub }) {
      for (const [id, value] of sessions) {
        if (sid ? value.oidcSid === sid : value.sub === sub) sessions.delete(id);
      }
      persist();
    },
  };
}
module.exports = { createSessionStore };
