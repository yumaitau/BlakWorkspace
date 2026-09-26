'use strict';

const { readBody } = require('./request-body');

const JOBS = { backup: 'Backing up the workspace', check: 'Checking that a backup can be read back', restore: 'Restoring the workspace' };
const DONE = {
  backup: 'Backup started. Apps pause for a few minutes while it copies data.',
  check: 'Backup check started. Apps keep running.',
  restore: 'Restore started. Apps are unavailable until it finishes, then everyone signs in again.',
  added: 'Place added. The next backup will copy to it.',
  removed: 'Place removed. Copies already there are left alone.',
  tested: 'That place works. Blak Workspace could write to it.',
};
const KINDS = { folder: 'Drive plugged into the server', smb: 'Windows or NAS share (SMB)', nfs: 'NFS share', s3: 'S3-compatible storage' };
const PLACE_FIELDS = ['kind', 'name', 'keep', 'path', 'share', 'username', 'password', 'export', 'subdir', 'endpoint', 'region', 'bucket', 'prefix', 'access_key', 'secret_key'];

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Whole-workspace restore is a Blak ID admin decision, not a Drive admin one.
function canManage(user) {
  return Array.isArray(user && user.apps) && user.apps.includes('idp');
}

function createClient(url, token, fetchImpl = fetch) {
  const base = url.replace(/\/$/, '');
  async function call(method, pathname, body, timeout = 15000) {
    let response;
    try {
      response = await fetchImpl(base + pathname, {
        method,
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw Object.assign(new Error('The backup service is not answering.'), { status: 503 });
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || 'The backup service is not answering.'), { status: response.status });
    return data;
  }
  // Mounting a share or listing a bucket can take a while.
  const slow = 120000;
  return {
    status: () => call('GET', '/status'),
    start: (action, body = {}) => call('POST', `/jobs/${action}`, body),
    addPlace: (place) => call('POST', '/places', place),
    removePlace: (id) => call('POST', `/places/${encodeURIComponent(id)}/remove`, {}),
    testPlace: (id) => call('POST', `/places/${encodeURIComponent(id)}/test`, {}, slow),
    placeBackups: async (id) => (await call('GET', `/places/${encodeURIComponent(id)}/backups`, undefined, slow)).backups || [],
    key: async () => (await call('POST', '/key', {})).key,
  };
}

function when(seconds) {
  if (!seconds) return 'never';
  const iso = new Date(seconds * 1000).toISOString();
  return `<time datetime="${iso}">${iso.slice(0, 16).replace('T', ' ')} UTC</time>`;
}

function archiveTime(name) {
  const m = /^workspace-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.tar\.gpg$/.exec(name || '');
  return m ? Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5], m[6]) / 1000 : 0;
}

function size(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

function restoreForm(backup, place) {
  return `<details class=restore><summary>Restore…</summary>
<p>Everything in the workspace goes back to how it was at ${when(backup.created)}. Anything saved after that is lost. Apps are unavailable while it runs, and everyone signs in again afterwards.</p>
<p>Blak ID accounts, app roles, passwords and keys also go back to that time. The data from just before the restore stays on the server, so it can still be undone by hand.</p>
<form method=post action="/backups/restore"><input type=hidden name=archive value="${esc(backup.name)}">${place ? `<input type=hidden name=place value="${esc(place)}">` : ''}
<label>Type RESTORE to confirm <input name=confirm required autocomplete=off pattern="RESTORE" data-testid="restore-confirm"></label>
<button class=btn type=submit data-testid="restore-start">Restore the workspace</button></form></details>`;
}

function backupRows(backups, place) {
  if (!backups.length) return '<div class=empty><p><b>No backups here yet.</b></p></div>';
  return `<ul class=backuplist>${backups.slice().reverse().map((b, i) => `<li class=holdcard data-testid="backup-row"><h2>${when(b.created)}${i === 0 ? ' <span class=pill>Latest</span>' : ''}</h2><p>${size(b.size)} · encrypted</p>${restoreForm(b, place)}</li>`).join('')}</ul>`;
}

function placeCard(place, shown) {
  const last = place.last;
  const result = !last ? 'No copy yet. The next backup copies here.'
    : last.ok ? `Last copy ${when(last.at)}.`
      : `The last copy failed ${when(last.at)}: ${esc(last.error)}`;
  const where = place.path || place.share || place.export || (place.endpoint ? `${place.endpoint}/${place.bucket}${place.prefix ? '/' + place.prefix : ''}` : '');
  return `<article class=holdcard id="place-${esc(place.id)}" data-testid="backup-place"><h2>${esc(place.name)}</h2>
<p>${esc(KINDS[place.kind] || place.kind)} · ${esc(where)} · keeps ${esc(place.keep)} backups</p>
<p ${last && !last.ok ? 'role=alert' : ''}>${result}</p>
<div class=actions><a class=btn-sec href="/backups?place=${esc(place.id)}#place-${esc(place.id)}">Show backups here</a>
<form method=post action="/backups/places/${esc(place.id)}/test"><button class=btn-sec type=submit>Test it</button></form>
<form method=post action="/backups/places/${esc(place.id)}/remove" onsubmit="return confirm('Stop copying backups to this place? Copies already there are kept.')"><button class=btn-sec type=submit>Remove</button></form></div>
${shown ? `<h3 class=sec>Backups in ${esc(place.name)}</h3>${shown.error ? `<p class=holdnote role=alert>${esc(shown.error)}</p>` : backupRows(shown.backups, place.id)}` : ''}</article>`;
}

const ADD_PLACE = `<details class=holdcard><summary><b>Add a place to keep copies</b></summary>
<p>Each backup is already encrypted before it leaves this server. A copy somewhere else means the workspace can come back even if this server's disk fails.</p>
<form method=post action="/backups/places" class=placeform>
<label>Kind of place <select name=kind id=placekind>${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label>
<label>Name <input name=name required maxlength=60 placeholder="Office NAS"></label>
<label>Keep this many backups <input name=keep type=number min=1 max=90 value=7></label>
<fieldset data-kind=folder><label>Folder on the drive <input name=path placeholder="/media/usb/blak-backups"></label><p>The drive must be mounted under /media or /mnt. If it is unplugged, the copy is skipped.</p></fieldset>
<fieldset data-kind=smb><label>Share <input name=share placeholder="//nas.local/backups"></label><label>Username <input name=username autocomplete=off></label><label>Password <input name=password type=password autocomplete=new-password></label><label>Folder inside the share (optional) <input name=subdir placeholder="blak"></label></fieldset>
<fieldset data-kind=nfs><label>Export <input name=export placeholder="nas.local:/volume1/backups"></label><label>Folder inside the export (optional) <input name=subdir placeholder="blak"></label></fieldset>
<fieldset data-kind=s3><label>Endpoint <input name=endpoint placeholder="https://ACCOUNT.r2.cloudflarestorage.com"></label><label>Region <input name=region placeholder="auto"></label><label>Bucket <input name=bucket></label><label>Folder in the bucket (optional) <input name=prefix placeholder="blak"></label><label>Access key ID <input name=access_key autocomplete=off></label><label>Secret access key <input name=secret_key type=password autocomplete=new-password></label></fieldset>
<button class=btn type=submit>Add place</button></form></details>
<script>(()=>{const kind=document.getElementById('placekind');if(!kind)return;const sync=()=>document.querySelectorAll('.placeform fieldset').forEach(f=>{const on=f.dataset.kind===kind.value;f.hidden=!on;f.disabled=!on;});kind.addEventListener('change',sync);sync();})();</script>`;

const LIVE_SCRIPT = `<script>(()=>{const note=document.getElementById('backup-live');if(!note)return;let signedOut=0;
const tick=async()=>{try{const r=await fetch('/api/backups',{cache:'no-store'});
if(r.status===401){if(++signedOut>36){location='/login';return;}note.textContent='Waiting for Blak ID to come back…';}
else if(!r.ok){throw Error('away');}
else{const j=await r.json();if(!j.running){location='/backups';return;}signedOut=0;note.textContent=j.label+(j.running.step?': '+j.running.step:'')+'…';}}
catch{note.textContent='The workspace is paused while this runs. This page comes back by itself.';}
setTimeout(tick,5000);};setTimeout(tick,5000);})();</script>`;

const LOCAL_TIME = `<script>document.querySelectorAll('time[datetime]').forEach(t=>{t.textContent=new Date(t.dateTime).toLocaleString('en-AU',{dateStyle:'medium',timeStyle:'short'});});</script>`;

function pageHtml(state, { message = '', notice = '', place = null, key = '' } = {}) {
  const head = `<div class=greet>Backups</div>
<p class=gsub>Blak Workspace saves an encrypted copy of every app's data each night. You can bring the whole workspace back to one of these copies.</p>
${message ? `<p class=holdnote role=alert>${esc(message)}</p>` : ''}${notice ? `<p class=holdnote role=status>${esc(notice)}</p>` : ''}`;
  if (!state) {
    return `${head}<div class=empty><p><b>Backups are not available right now.</b></p><p>The backup service on the server is not answering. Try again in a minute.</p>
<details><summary>Technical detail</summary><p>Run <code>scripts/deploy/backup/install.sh</code> on the server, then set <code>BACKUP_AGENT_URL</code> and <code>BACKUP_AGENT_TOKEN</code> on the portal. See docs/runbooks/backup-restore.md.</p></details></div>`;
  }
  const latest = state.backups[state.backups.length - 1];
  const running = state.running
    ? `<p class=holdnote role=status id=backup-live data-testid="backup-running">${esc(JOBS[state.running.action] || 'Working')}${state.running.step ? ': ' + esc(state.running.step) : ''}…</p>`
    : '';
  const failed = (state.failed || []).map((f) => `<p class=holdnote role=alert><b>${esc({ backup: 'The last backup did not finish.', check: 'The last backup check failed.', restore: 'The last restore did not finish. The workspace was put back how it was before.' }[f.action])}</b> ${when(f.at)}. Try again, or ask whoever runs the server to look at the backup logs.</p>`).join('');
  const check = state.lastCheck
    ? `Last check ${when(state.lastCheck.completed_at)}: ${esc(state.lastCheck.files_verified)} files and ${esc(Object.keys(state.lastCheck.database_checks || {}).length)} databases read back correctly.`
    : 'No backup has been checked yet.';
  const restored = state.lastRestore ? `<p>Last restore ${when(state.lastRestore.completed_at)}, from the backup taken ${when(archiveTime(state.lastRestore.archive))}.</p>` : '';
  const busy = state.running ? ' disabled' : '';
  const summary = `<section class=holdcard data-testid="backup-summary"><h2>${latest ? `Latest backup ${when(latest.created)}` : 'No backups yet'}</h2>
<p>Next backup ${when(state.next && state.next.backup)}. Apps pause for a few minutes while it copies data.</p><p>${check}</p>${restored}
<div class=actions><form method=post action="/backups/run"><input type=hidden name=action value=backup><button class=btn type=submit data-testid="backup-now"${busy}>Back up now</button></form>
<form method=post action="/backups/run"><input type=hidden name=action value=check><button class=btn-sec type=submit${busy}>Check the latest backup</button></form></div></section>`;
  const shownPlace = place && state.places.find((p) => p.id === place.id);
  const places = state.places.map((p) => placeCard(p, shownPlace && p.id === shownPlace.id ? place : null)).join('');
  const recovery = key
    ? `<section class=holdcard data-testid="recovery-key"><h2>Recovery key</h2><p>Save this key somewhere outside Blak Workspace, such as a password manager or a sealed envelope. Without it, no copy can be opened, including copies kept somewhere else. Do not share it.</p><p><code style="user-select:all;word-break:break-all">${esc(key)}</code></p></section>`
    : `<section class=holdcard><h2>Recovery key</h2><p>Every backup is locked with a recovery key that lives on this server. If the server is lost, you need the key to open a copy kept somewhere else.</p>
<form method=post action="/backups/key"><button class=btn-sec type=submit${state.keyPresent ? '' : ' disabled'}>Show recovery key</button></form></section>`;
  return `${head}${running}${failed}${summary}
<h3 class=sec>Backups on this server</h3>${backupRows(state.backups, null)}
<h3 class=sec>Other places that keep a copy</h3>${places || '<p>Backups only live on this server right now. Add a drive, a share or cloud storage so a copy survives if the server fails.</p>'}
${state.places.length < 5 ? ADD_PLACE : ''}
${recovery}
${state.running ? LIVE_SCRIPT : ''}${LOCAL_TIME}`;
}

function createRoutes({ agent, shell }) {
  function send(res, status, user, body) {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    res.end(shell(user, 'backups', 'Backups', body));
  }
  async function render(res, user, status, options) {
    const state = agent ? await agent.status().catch(() => null) : null;
    send(res, status, user, pageHtml(state, options));
  }
  async function form(req) {
    return Object.fromEntries(new URLSearchParams((await readBody(req)).toString('utf8')));
  }
  async function act(req, res, user, work) {
    try {
      const done = await work();
      res.writeHead(303, { location: `/backups?done=${done}` });
      res.end();
    } catch (error) {
      await render(res, user, error.status && error.status < 500 ? error.status : 502, { message: error.message });
    }
  }
  return async function handle(req, res, url, user) {
    const api = url.pathname === '/api/backups';
    if (!api && url.pathname !== '/backups' && !url.pathname.startsWith('/backups/')) return false;
    if (!user) {
      if (api) { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":"unauthenticated"}'); } else { res.writeHead(302, { location: '/login' }); res.end(); }
      return true;
    }
    if (!canManage(user)) {
      if (api) { res.writeHead(403, { 'content-type': 'application/json' }); res.end('{"error":"Workspace admin required"}'); return true; }
      send(res, 403, user, '<div class=greet>Backups</div><p class=holdnote role=alert>Only a Blak ID admin can see and restore backups. Ask a workspace admin.</p>');
      return true;
    }
    if (api) {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return true; }
      try {
        const state = await agent.status();
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ running: state.running, label: state.running ? JOBS[state.running.action] : '', failed: state.failed }));
      } catch {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end('{"error":"Backup service unavailable"}');
      }
      return true;
    }
    if (url.pathname === '/backups' || url.pathname === '/backups/') {
      if (req.method !== 'GET') { res.writeHead(405); res.end(); return true; }
      const options = { notice: DONE[url.searchParams.get('done')] || '' };
      const placeId = url.searchParams.get('place');
      if (agent && placeId && /^[a-f0-9]{8}$/.test(placeId)) {
        options.place = await agent.placeBackups(placeId).then((backups) => ({ id: placeId, backups }), (error) => ({ id: placeId, error: error.message, backups: [] }));
      }
      await render(res, user, 200, options);
      return true;
    }
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
    if (!agent) { await render(res, user, 503, { message: 'The backup service is not set up on this server.' }); return true; }
    if (url.pathname === '/backups/run') {
      await act(req, res, user, async () => {
        const { action } = await form(req);
        if (action !== 'backup' && action !== 'check') throw Object.assign(new Error('Unknown action'), { status: 400 });
        await agent.start(action);
        return action;
      });
      return true;
    }
    if (url.pathname === '/backups/restore') {
      await act(req, res, user, async () => {
        const fields = await form(req);
        if (fields.confirm !== 'RESTORE') throw Object.assign(new Error('Type RESTORE in capitals to confirm the restore.'), { status: 400 });
        await agent.start('restore', { archive: fields.archive, place: fields.place || null });
        return 'restore';
      });
      return true;
    }
    if (url.pathname === '/backups/places') {
      await act(req, res, user, async () => {
        const fields = await form(req);
        await agent.addPlace(Object.fromEntries(PLACE_FIELDS.filter((k) => fields[k] !== undefined).map((k) => [k, fields[k]])));
        return 'added';
      });
      return true;
    }
    const placeAction = url.pathname.match(/^\/backups\/places\/([a-f0-9]{8})\/(test|remove)$/);
    if (placeAction) {
      await act(req, res, user, async () => {
        if (placeAction[2] === 'test') { await agent.testPlace(placeAction[1]); return 'tested'; }
        await agent.removePlace(placeAction[1]);
        return 'removed';
      });
      return true;
    }
    if (url.pathname === '/backups/key') {
      try {
        const key = await agent.key();
        await render(res, user, 200, { key });
      } catch (error) {
        await render(res, user, error.status && error.status < 500 ? error.status : 502, { message: error.message });
      }
      return true;
    }
    res.writeHead(404); res.end();
    return true;
  };
}

module.exports = { canManage, createClient, pageHtml, createRoutes };
