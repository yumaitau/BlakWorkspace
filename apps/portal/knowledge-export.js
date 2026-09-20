'use strict';
// Read-only, owner-bound export credentials. These are never portal login sessions.
const fs = require('node:fs');
const crypto = require('node:crypto');
const fail = status => { throw Object.assign(new Error('Knowledge export unavailable'), { status }); };
function exportOwner(header, file) {
  if (!file || !header?.startsWith('Bearer ')) fail(401);
  const digest = crypto.createHash('sha256').update(header.slice(7)).digest();
  const accounts = JSON.parse(fs.readFileSync(file, 'utf8'));
  const account = accounts.find(item => {
    const expected = Buffer.from(item.sha256, 'hex');
    return expected.length === digest.length && crypto.timingSafeEqual(expected, digest);
  });
  if (!account?.owner) fail(401);
  return account.owner;
}
const FLOW_PARAMS = new Set(['path', 'content', 'prefix', 'title', 'body']);
const pick = (value, keys) => Object.fromEntries(Object.entries(value || {}).filter(([key]) => keys.has(key)));
function documents(source, owner, drawStore, flowStore) {
  if (source === 'draw') return drawStore.list(owner).map(item => {
    const board = drawStore.read(owner, item.id);
    return { id: board.id, name: board.name, revision: String(board.revision),
      content: { name: board.name, source: 'https://portal.workspace.example.com/draw',
        elements: board.scene.elements.filter(e => !e.isDeleted).map(({ id, type, text, originalText, x, y, width, height, startBinding, endBinding }) => ({ id, type, text, originalText, x, y, width, height, startBinding, endBinding })) } };
  });
  if (source === 'flow') return Object.values(flowStore.flows).filter(f => f.owner === owner).map(flow => ({
    id: flow.id, name: flow.name, revision: '',
    content: { name: flow.name, enabled: flow.enabled, source: 'https://portal.workspace.example.com/flow/' + flow.id,
      starter: flow.starter, steps: flow.steps.map(({ id, connector, action, params }) => ({ id, connector, action, params: pick(params, FLOW_PARAMS) })),
      runs: flowStore.runs.filter(r => r.flowId === flow.id).map(({ id, status, startedAt, finishedAt }) => ({ id, status, startedAt, finishedAt })) },
  }));
  fail(404);
}
module.exports = { exportOwner, documents };
