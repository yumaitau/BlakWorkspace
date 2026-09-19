'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LIVE_CONNECTORS = ['drive', 'sites'];
const STARTER_TYPES = ['event', 'schedule'];
const DRIVE_ACTIONS = ['write_file', 'read_file', 'list_files'];
const SITES_ACTIONS = ['create_page', 'list_pages'];

class FlowError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FlowError';
  }
}

class DriveAdapter {
  constructor(files) {
    this.files = files || {};
  }
  execute(action, params, context) {
    const payload = payloadOf(context);
    if (action === 'write_file') {
      const filePath = String((params && params.path) || payload.path || '');
      if (!filePath) return { ok: false, connector: 'drive', action, error: 'path required' };
      const content = params && params.content != null ? String(params.content) : String(payload.content || '');
      this.files[filePath] = content;
      return { ok: true, connector: 'drive', action, path: filePath, bytes: Buffer.byteLength(content) };
    }
    if (action === 'read_file') {
      const filePath = String((params && params.path) || payload.path || '');
      if (!(filePath in this.files)) return { ok: false, connector: 'drive', action, error: 'not found', path: filePath };
      return { ok: true, connector: 'drive', action, path: filePath, content: this.files[filePath] };
    }
    if (action === 'list_files') {
      const prefix = String((params && params.prefix) || '');
      const files = Object.keys(this.files).filter((p) => p.startsWith(prefix)).sort();
      return { ok: true, connector: 'drive', action, files };
    }
    return { ok: false, connector: 'drive', action, error: `unknown action ${action}` };
  }
}

class SitesAdapter {
  constructor(pages) {
    this.pages = pages || [];
  }
  execute(action, params, context) {
    const payload = payloadOf(context);
    if (action === 'create_page') {
      const title = String((params && params.title) || payload.path || 'Untitled');
      const body = params && params.body != null ? String(params.body) : String(payload.content || '');
      const page = { id: String(this.pages.length + 1), title, body };
      this.pages.push(page);
      return { ok: true, connector: 'sites', action, pageId: page.id, title };
    }
    if (action === 'list_pages') {
      return { ok: true, connector: 'sites', action, pages: this.pages.slice() };
    }
    return { ok: false, connector: 'sites', action, error: `unknown action ${action}` };
  }
}

function defaultConnectors() {
  return { drive: new DriveAdapter(), sites: new SitesAdapter() };
}

function createStore() {
  return { flows: {}, runs: [] };
}

function loadStore(filePath) {
  if (!filePath) return createStore();
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return { flows: parsed.flows || {}, runs: parsed.runs || [] };
  } catch {
    return createStore();
  }
}

function saveStore(store, filePath) {
  if (!filePath) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(store, null, 2));
}

function createFlow(store, { owner, name, starter, steps }) {
  owner = String(owner || '').trim();
  name = String(name || '').trim();
  if (!owner) throw new FlowError('owner required');
  if (!name) throw new FlowError('name required');
  const starterObj = validateStarter(starter);
  const stepObjs = validateSteps(steps);
  const now = nowIso();
  const flow = {
    id: crypto.randomBytes(8).toString('hex'),
    owner,
    name,
    starter: starterObj,
    steps: stepObjs,
    enabled: false,
    createdAt: now,
    updatedAt: now,
  };
  store.flows[flow.id] = flow;
  return flow;
}

function setEnabled(store, flowId, enabled) {
  const flow = getFlow(store, flowId);
  flow.enabled = Boolean(enabled);
  flow.updatedAt = nowIso();
  return flow;
}

function getFlow(store, flowId) {
  const flow = store.flows[flowId];
  if (!flow) throw new FlowError(`unknown flow ${flowId}`);
  return flow;
}

function listFlows(store, owner) {
  let flows = Object.values(store.flows);
  if (owner != null) flows = flows.filter((f) => f.owner === owner);
  return flows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

function matchStarter(starter, event) {
  if (!event) return false;
  if (starter.type === 'schedule') {
    return event.type === 'schedule' && (!starter.name || event.name === starter.name || event.name === 'manual');
  }
  if (starter.type === 'event') {
    return event.type === 'event' && event.name === starter.name;
  }
  return false;
}

function trigger(store, flowId, event, connectors) {
  const flow = getFlow(store, flowId);
  if (!flow.enabled) throw new FlowError('flow is disabled');
  if (!matchStarter(flow.starter, event)) throw new FlowError('starter did not match event');
  const conns = connectors || defaultConnectors();
  const context = { payload: payloadOf({ payload: event && event.payload }), event, last: null };
  const stepRecords = [];
  let status = 'ok';
  for (const step of flow.steps) {
    const adapter = conns[step.connector];
    let outcome;
    if (!adapter || typeof adapter.execute !== 'function') {
      outcome = { ok: false, error: `missing connector ${step.connector}` };
    } else {
      outcome = adapter.execute(step.action, step.params || {}, context);
    }
    stepRecords.push({ id: step.id, connector: step.connector, action: step.action, outcome });
    context.last = outcome;
    if (!outcome.ok) {
      status = 'error';
      break;
    }
  }
  const run = {
    id: crypto.randomBytes(8).toString('hex'),
    flowId: flow.id,
    flowName: flow.name,
    owner: flow.owner,
    event: { type: event && event.type, name: event && event.name, payload: event && event.payload },
    status,
    steps: stepRecords,
    startedAt: nowIso(),
  };
  store.runs.push(run);
  return run;
}

function listRuns(store, flowId) {
  let runs = store.runs.slice();
  if (flowId != null) runs = runs.filter((r) => r.flowId === flowId);
  return runs.slice().reverse();
}

function payloadOf(context) {
  const raw = context && context.payload;
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

function validateStarter(starter) {
  if (!starter || typeof starter !== 'object') throw new FlowError('starter required');
  const kind = String(starter.type || '');
  if (!STARTER_TYPES.includes(kind)) throw new FlowError('starter type must be event or schedule');
  let name = String(starter.name || '').trim();
  if (kind === 'event' && !name) throw new FlowError('event starter needs a name');
  if (kind === 'schedule' && !name) name = 'manual';
  return { type: kind, name };
}

function validateSteps(steps) {
  if (!Array.isArray(steps) || steps.length < 2) throw new FlowError('flow needs at least two ordered steps');
  const cleaned = [];
  const connectors = new Set();
  steps.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new FlowError(`step ${index} invalid`);
    const connector = String(raw.connector || '').trim();
    const action = String(raw.action || '').trim();
    if (!LIVE_CONNECTORS.includes(connector)) throw new FlowError(`step ${index}: connector must be drive or sites`);
    if (connector === 'drive' && !DRIVE_ACTIONS.includes(action)) throw new FlowError(`step ${index}: unknown drive action`);
    if (connector === 'sites' && !SITES_ACTIONS.includes(action)) throw new FlowError(`step ${index}: unknown sites action`);
    connectors.add(connector);
    cleaned.push({
      id: String(raw.id || `s${index + 1}`),
      connector,
      action,
      params: raw.params && typeof raw.params === 'object' ? { ...raw.params } : {},
    });
  });
  if (!connectors.has('drive')) throw new FlowError('flow must include a Drive step');
  if (!connectors.has('sites')) throw new FlowError('flow must include a second live connector (Sites)');
  return cleaned;
}

function nowIso() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function demoRun() {
  const store = createStore();
  const connectors = defaultConnectors();
  const flow = createFlow(store, {
    owner: 'ada',
    name: 'File to Sites',
    starter: { type: 'event', name: 'drive.file_created' },
    steps: [
      { connector: 'drive', action: 'write_file', params: { path: '/flows/brief.txt' } },
      { connector: 'sites', action: 'create_page', params: { title: 'Brief from Drive' } },
    ],
  });
  setEnabled(store, flow.id, true);
  const run = trigger(store, flow.id, {
    type: 'event',
    name: 'drive.file_created',
    payload: { path: '/inbox/brief.txt', content: 'hello from trigger' },
  }, connectors);
  return { flow, run, driveFiles: connectors.drive.files, sitePages: connectors.sites.pages };
}

module.exports = {
  DriveAdapter,
  FlowError,
  SitesAdapter,
  createFlow,
  createStore,
  defaultConnectors,
  getFlow,
  listFlows,
  listRuns,
  loadStore,
  matchStarter,
  saveStore,
  setEnabled,
  trigger,
  demoRun,
};

if (require.main === module) {
  process.stdout.write(JSON.stringify(demoRun()));
}
