'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const MAX_SCAN_BYTES = 64 * 1024 * 1024;

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isAdmin(user) {
  const apps = Array.isArray(user && user.apps) ? user.apps : [];
  const driveRole = user && user.roles && user.roles.drive;
  return apps.includes('idp') || (apps.includes('drive') && driveRole === 'admin');
}

function insideRoot(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function judgeReply(reply) {
  const line = String(reply || '').replace(/\0/g, '').trim().split(/\r?\n/).pop() || '';
  if (/ OK$/.test(line)) return { clean: true, signature: '' };
  const found = line.match(/: (.+) FOUND$/);
  if (found) return { clean: false, signature: found[1] };
  const error = new Error('The file checker did not finish');
  error.status = 503;
  throw error;
}

function scanStream(socket, stream, size) {
  return new Promise((resolve, reject) => {
    let reply = '';
    const fail = (error) => {
      socket.destroy();
      reject(error);
    };
    socket.on('data', (chunk) => { reply += chunk.toString('utf8'); });
    socket.on('error', fail);
    socket.on('end', () => {
      try { resolve(judgeReply(reply)); } catch (error) { reject(error); }
    });
    socket.write('zINSTREAM\0');
    const send = () => {
      const chunk = stream.read(64 * 1024);
      if (chunk) {
        const header = Buffer.alloc(4);
        header.writeUInt32BE(chunk.length, 0);
        socket.write(Buffer.concat([header, chunk]));
        return;
      }
      if (size === 0 || stream.readableEnded || stream.closed) {
        socket.write(Buffer.alloc(4));
        socket.end();
      }
    };
    stream.on('readable', send);
    stream.on('end', send);
    stream.on('error', fail);
    send();
  });
}

function clamdCommand(host, port, command) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let reply = '';
    socket.on('data', (chunk) => { reply += chunk.toString('utf8'); });
    socket.on('error', reject);
    socket.on('end', () => resolve(reply.replace(/\0/g, '').trim()));
    socket.end(`z${command}\0`);
  });
}

function connectScan(host, port, filePath, fileSize) {
  const socket = net.connect({ host, port });
  const stream = fs.createReadStream(filePath);
  return scanStream(socket, stream, fileSize).finally(() => stream.destroy());
}

function listFiles(root, fileSystem = fs) {
  const found = [];
  const walk = (dir) => {
    for (const name of fileSystem.readdirSync(dir)) {
      if (name.startsWith('.') || name.endsWith('.held.txt')) continue;
      const full = path.join(dir, name);
      const stat = fileSystem.lstatSync(full);
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!stat.isFile()) continue;
      found.push({ path: full, name, size: stat.size, mtimeMs: stat.mtimeMs });
    }
  };
  if (fileSystem.existsSync(root)) walk(root);
  return found;
}

function openStore(dir, fileSystem = fs) {
  const heldDir = path.join(dir, 'held');
  fileSystem.mkdirSync(heldDir, { recursive: true });
  return {
    dir,
    heldDir,
    fileSystem,
    read(id) {
      const metaPath = path.join(heldDir, id, 'meta.json');
      if (!fileSystem.existsSync(metaPath)) return null;
      return JSON.parse(fileSystem.readFileSync(metaPath, 'utf8'));
    },
    write(meta) {
      const folder = path.join(heldDir, meta.id);
      fileSystem.mkdirSync(folder, { recursive: true });
      const target = path.join(folder, 'meta.json');
      fileSystem.writeFileSync(target + '.tmp', JSON.stringify(meta), { mode: 0o600 });
      fileSystem.renameSync(target + '.tmp', target);
    },
    list() {
      return fileSystem.readdirSync(heldDir)
        .map((id) => this.read(id))
        .filter((meta) => meta && meta.state === 'held')
        .sort((a, b) => String(b.heldAt).localeCompare(String(a.heldAt)));
    },
  };
}

function moveFile(fileSystem, from, to) {
  fileSystem.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fileSystem.renameSync(from, to);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    fileSystem.copyFileSync(from, to);
    fileSystem.unlinkSync(from);
  }
}

function noteBody(name) {
  return [
    `We held back "${name}" because it looked unsafe.`,
    '',
    'The file is not deleted. Other people cannot open it from Blak Drive right now.',
    '',
    'To put it back, a workspace admin opens Blak Home, chooses Held files, and presses Put it back.',
    'If you are not an admin, ask one and tell them this file name.',
    '',
  ].join('\n');
}

function holdFile(store, file, signature, root, now = new Date()) {
  const ownerId = path.relative(root, file.path).split(path.sep)[0];
  const id = crypto.randomBytes(8).toString('hex');
  const folder = path.join(store.heldDir, id);
  store.fileSystem.mkdirSync(folder, { recursive: true });
  moveFile(store.fileSystem, file.path, path.join(folder, 'file'));
  const notePath = file.path + '.held.txt';
  store.fileSystem.writeFileSync(notePath, noteBody(file.name), { mode: 0o644 });
  const meta = {
    id,
    name: file.name,
    ownerId,
    path: file.path,
    notePath,
    signature,
    heldAt: now.toISOString(),
    state: 'held',
  };
  store.write(meta);
  return meta;
}

function visibleHeld(records, user) {
  if (isAdmin(user)) return records;
  return records.filter((record) => record.ownerId && record.ownerId === user.sub);
}

function releaseFile(store, id, root) {
  const meta = store.read(id);
  if (!meta || meta.state !== 'held') {
    const error = new Error('That held file is no longer here');
    error.status = 404;
    throw error;
  }
  if (!insideRoot(root, meta.path)) {
    const error = new Error('This file cannot be put back automatically');
    error.status = 400;
    throw error;
  }
  if (store.fileSystem.existsSync(meta.path)) {
    const error = new Error('A file with this name is already in Blak Drive. Rename that file, then put this one back.');
    error.status = 409;
    throw error;
  }
  moveFile(store.fileSystem, path.join(store.heldDir, id, 'file'), meta.path);
  if (meta.notePath && store.fileSystem.existsSync(meta.notePath)) store.fileSystem.unlinkSync(meta.notePath);
  meta.state = 'returned';
  meta.returnedAt = new Date().toISOString();
  store.write(meta);
  return meta;
}

function deleteHeld(store, id) {
  const meta = store.read(id);
  if (!meta || meta.state !== 'held') {
    const error = new Error('That held file is no longer here');
    error.status = 404;
    throw error;
  }
  const folder = path.join(store.heldDir, id);
  store.fileSystem.rmSync(folder, { recursive: true, force: true });
  if (meta.notePath && store.fileSystem.existsSync(meta.notePath)) store.fileSystem.unlinkSync(meta.notePath);
  meta.state = 'deleted';
  store.fileSystem.mkdirSync(folder, { recursive: true });
  store.write(meta);
  return meta;
}

function homeFragment(records) {
  const count = records.length;
  if (!count) return '';
  const noun = count === 1 ? 'file was' : 'files were';
  return `<section class=holdnote role=status data-testid="held-banner"><b>${count} ${noun} held back</b><p>A file check moved ${count === 1 ? 'it' : 'them'} out of Blak Drive because ${count === 1 ? 'it looked' : 'they looked'} unsafe. ${count === 1 ? 'It is' : 'They are'} not deleted. <a href="/held-files">See held files</a> to put ${count === 1 ? 'it' : 'them'} back or ask an admin.</p></section>`;
}

function pageHtml(user, records, message) {
  const admin = isAdmin(user);
  const mine = visibleHeld(records, user);
  const items = mine.map((record) => {
    const when = esc(record.heldAt.slice(0, 16).replace('T', ' '));
    const actions = admin
      ? `<div class=actions><form method=post action="/held-files/${esc(record.id)}/release"><button class=btn type=submit data-testid="release-file">Put it back</button></form><form method=post action="/held-files/${esc(record.id)}/delete" onsubmit="return confirm('Delete this file for good? This cannot be undone.')"><button class=btn-sec type=submit>Delete it for good</button></form></div><details><summary>Technical detail</summary><p>The checker reported: ${esc(record.signature)}</p></details>`
      : `<p>To get this file back, ask a workspace admin to open <strong>Held files</strong> and press <strong>Put it back</strong>. Tell them the file name: <strong>${esc(record.name)}</strong>.</p>`;
    return `<article class=holdcard data-testid="held-file"><h2>${esc(record.name)}</h2><p>We held this file back because it looked unsafe. It was in Blak Drive. People cannot open it from there right now. The file is not deleted.</p><p>Held ${when} UTC.</p>${actions}</article>`;
  }).join('');
  const empty = `<div class=empty data-testid="held-empty"><p><b>No files are held back.</b></p><p>Blak Workspace checks files in the background. If a file looks unsafe, we move it here so other people cannot open it. Nothing is deleted unless an admin chooses Delete it for good.</p><p>If you cannot find a file in Blak Drive, look on this page or ask a workspace admin.</p></div>`;
  return `<div class=greet>Held files</div>
<p class=gsub>Files moved here looked unsafe. They are not deleted. An admin can put a file back when they trust it.</p>
${message ? `<p class=holdnote role=alert>${esc(message)}</p>` : ''}
${items || empty}`;
}

function createLoop({ root, store, scanFile, intervalMs = 300000, version = async () => 'local' }) {
  const seen = new Map();
  let running = false;
  let timer = null;
  let lastError = '';
  async function pass() {
    if (running) return;
    running = true;
    try {
      const current = await version();
      for (const file of listFiles(root, store.fileSystem)) {
        if (file.size > MAX_SCAN_BYTES) continue;
        const already = store.list().some((record) => record.path === file.path);
        if (already) continue;
        const key = `${file.mtimeMs}:${file.size}:${current}`;
        if (seen.get(file.path) === key) continue;
        const result = await scanFile(file.path, file.size);
        seen.set(file.path, key);
        if (!result.clean) holdFile(store, file, result.signature, root);
      }
      lastError = '';
    } catch (error) {
      lastError = error.message || 'The file checker did not finish';
    } finally {
      running = false;
    }
  }
  function schedule() {
    const wait = lastError ? Math.min(intervalMs, 15000) : intervalMs;
    timer = setTimeout(() => { pass().finally(schedule); }, wait);
    if (timer.unref) timer.unref();
  }
  return {
    pass,
    lastError: () => lastError,
    start() { pass().finally(schedule); },
    stop() { if (timer) clearTimeout(timer); },
  };
}

function createRemote(url, token, fetchImpl = fetch) {
  const base = url.replace(/\/$/, '');
  async function call(method, pathname) {
    const response = await fetchImpl(base + pathname, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.message || 'Held files could not be updated');
      error.status = response.status;
      throw error;
    }
    return body;
  }
  return {
    async list() { return (await call('GET', '/held')).held || []; },
    release(id) { return call('POST', `/held/${encodeURIComponent(id)}/release`); },
    remove(id) { return call('POST', `/held/${encodeURIComponent(id)}/delete`); },
  };
}

module.exports = {
  MAX_SCAN_BYTES,
  isAdmin,
  judgeReply,
  scanStream,
  clamdCommand,
  connectScan,
  listFiles,
  openStore,
  holdFile,
  visibleHeld,
  releaseFile,
  deleteHeld,
  homeFragment,
  pageHtml,
  noteBody,
  createLoop,
  createRemote,
};
