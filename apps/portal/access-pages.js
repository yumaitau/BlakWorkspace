'use strict';
// People & access: explainer, My access, and the workspace-admin area.
// Every admin request re-checks Blak ID live; every write is reviewed, guarded,
// verified against Blak ID and audited before success is reported.
const { ROLES, ROLE_LABEL, TIMING, APP_ACCESS, GROUP_TYPES, roleSets, setName } = require('./access-catalog');
const model = require('./access-model');
const { sameOrigin } = require('./access-guard');

const ACTIONS = new Map([['person-role', "Change a person's role"], ['team-role', "Change a team group's role"], ['team-join', 'Add a person to a group'], ['team-leave', 'Remove a person from a group'], ['team-create', 'Create a team group']]);
const PAGE_LIMIT_MESSAGE = 'Too many requests. Wait a minute and try again.';

function createAccess({ blakId, csrf, audit, origin, shell, esc, readBody, writeLimit, readLimit, sets = roleSets() }) {
  const badge = type => `<span class=badge data-type="${esc(type)}">${esc(GROUP_TYPES[type].label)}</span>`;
  const roleBadge = role => role ? `<span class=rolechip data-role="${esc(role)}">${esc(ROLE_LABEL[role])}</span>` : '<span class=rolechip data-role="none">No access</span>';
  const isAdminClaim = user => Array.isArray(user.apps) && user.apps.includes('idp');
  const hidden = (name, value) => `<input type=hidden name="${esc(name)}" value="${esc(value)}">`;
  const csrfField = user => hidden('csrf', csrf.token(user.sessionId));
  const roleOptions = (selected, none) => (none ? `<option value=""${selected ? '' : ' selected'}>${esc(none)}</option>` : '') + ROLES.map(role => `<option value="${role}"${role === selected ? ' selected' : ''}>${ROLE_LABEL[role]}</option>`).join('');
  const setOptions = selected => sets.map(set => `<option value="${esc(set.id)}"${set.id === selected ? ' selected' : ''}>${esc(setName(set))}</option>`).join('');

  function tabs(user, active) {
    const items = [['/access', 'How access works', 'how'], ['/access/me', 'My access', 'me']];
    if (isAdminClaim(user)) items.push(['/access/admin/apps', 'Apps', 'apps'], ['/access/admin/groups', 'Groups', 'groups'], ['/access/admin/people', 'People', 'people'], ['/access/admin/changes', 'Recent changes', 'changes']);
    return `<nav class=flowtabs aria-label="People and access">${items.map(([href, label, id]) => `<a href="${href}"${id === active ? ' aria-current="page" data-active="true"' : ''}>${label}</a>`).join('')}</nav>`;
  }
  function frame(user, active, title, body) {
    return shell(user, 'access', title, `<div class=access><div class=greet>People &amp; access</div>${tabs(user, active)}<h1 class=acc-h1>${esc(title)}</h1>${body}</div>`);
  }
  function send(res, status, html) {
    res.writeHead(status, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  }
  function roleCards(set) {
    const info = APP_ACCESS[set.id];
    return `<div class=rolegrid>${ROLES.map(role => {
      const item = info?.roles[role];
      return `<section class=rolecard aria-labelledby="role-${esc(set.id)}-${role}"><h3 id="role-${esc(set.id)}-${role}">${roleBadge(role)}</h3>
<p class=can-h>Can</p><ul class=can>${(item?.can || []).map(line => `<li>${esc(line)}</li>`).join('')}</ul>
<p class=cant-h>Can't</p><ul class=cant>${(item?.cannot || []).map(line => `<li>${esc(line)}</li>`).join('')}</ul></section>`;
    }).join('')}</div>`;
  }
  const timingFor = set => TIMING[APP_ACCESS[set.id]?.timing || 'native'];
  const ask = '<div class=notice><b>Need something else?</b> Ask your workspace administrator. Tell them which app you need and what you need to do in it, for example “edit files in Blak Drive”.</div>';

  function diagram() {
    return `<figure class=accessflow aria-labelledby=flowcap>
<ol>
<li><b>People</b><span>Ada, Sam, Jo</span></li>
<li><b>Groups</b><span>Team groups, such as Rangers. Optional.</span></li>
<li><b>App roles</b><span>Reader, Writer or Admin in one app, e.g. blak-drive-writer</span></li>
<li><b>Apps</b><span>Blak Drive, Blak Chat, Blak Knowledge…</span></li>
</ol>
<figcaption id=flowcap>A person gets an app role directly, or by being in a team group that has the role. Blak ID sends the role to the app.</figcaption></figure>`;
  }

  function explainerPage(user) {
    const byTiming = key => sets.filter(set => (APP_ACCESS[set.id]?.timing || 'native') === key).map(setName).join(', ');
    const timingRows = Object.keys(TIMING).filter(byTiming).map(key => `<li><b>${esc(byTiming(key))}.</b> ${esc(TIMING[key])}</li>`).join('');
    const apps = sets.map(set => `<details class=appexplain><summary><b>${esc(setName(set))}</b> <span>${esc(APP_ACCESS[set.id]?.purpose || '')}</span></summary>${APP_ACCESS[set.id]?.note ? `<p>${esc(APP_ACCESS[set.id].note)}</p>` : ''}${roleCards(set)}</details>`).join('');
    return frame(user, 'how', 'How access works', `<p class=gsub>Blak ID decides who can open each app and what they can do there. Access always follows the same path.</p>
${diagram()}
<p class=gsub>If you know Microsoft Entra ID: people are users, team groups are groups, and app roles are the enterprise app role assignments.</p>
<h2 class=acc-h2>The rules</h2>
<dl class=rules>
<dt>The highest role wins</dt><dd>If you are a Reader directly and a Writer through a team group, you are a Writer. Roles in one app never change another app.</dd>
<dt>No role means no access</dt><dd>Without a Reader, Writer or Admin role, the app is hidden and its sign-in is refused.</dd>
<dt>App admin is not Blak ID admin</dt><dd>An Admin in one app manages that app only. They cannot change people, groups or roles in Blak ID, and they are not admin anywhere else.</dd>
<dt>Workspace administrators</dt><dd>Members of the Blak ID administrators group can use Blak ID and manage everyone's access here. When app roles were introduced, existing administrators were made Admin in every app. A new administrator gets app roles the same way as anyone else.</dd>
<dt>Team groups pass their role to every member</dt><dd>Give a team group a role once and every member has it, including people who join later. Leaving the team removes it, unless they have the role another way.</dd>
<dt>Private items stay private</dt><dd>A role never opens someone else's private files, drawings, flows, notes or vault items, even for an Admin.</dd>
<dt>Retired groups do nothing</dt><dd>Old groups named “Blak … users” no longer grant anything. They are marked retired.</dd>
</dl>
<h2 class=acc-h2>How long changes take</h2><ul class=timing>${timingRows}</ul>
<h2 class=acc-h2>What each role can do</h2>${apps}
${ask}`);
  }

  // Loads the directory once per request. Callers must handle BlakIdError.
  async function directory() {
    return model.indexGroups(await blakId.groups(), sets);
  }

  function viaText(grant) {
    return grant.via === 'direct' ? 'Given to you directly' : `Through the team group ${esc(grant.group)}`;
  }

  async function myAccessPage(user) {
    let access = null, problem = '';
    if (blakId?.configured) {
      try {
        const [index, me] = await Promise.all([directory(), blakId.userByIdentity(user.identity)]);
        if (me) access = model.resolveAccess(me, index);
      } catch { problem = 'Blak ID could not be reached, so the groups behind each role are not shown.'; }
    } else problem = 'Group details are not available on this workspace yet.';
    const claimRoles = user.roles || {};
    const rows = sets.map(set => {
      const found = access?.apps.find(item => item.set.id === set.id);
      const role = access ? found?.role || null : set.apps.map(app => claimRoles[app]).find(Boolean) || null;
      const info = role ? APP_ACCESS[set.id]?.roles[role] : null;
      const via = found ? `<ul class=via>${found.grants.map(grant => `<li>${viaText(grant)} (${ROLE_LABEL[grant.role]})${grant.role === role && found.grants.length > 1 ? ' <b>wins</b>' : ''}</li>`).join('')}</ul>` : role ? '<span class=muted>Not available</span>' : '';
      return { role, html: `<tr><th scope=row>${esc(setName(set))}</th><td>${roleBadge(role)}</td><td>${info ? `<ul class=can>${info.can.map(line => `<li>${esc(line)}</li>`).join('')}</ul>` : '<span class=muted>You cannot open this app.</span>'}</td><td>${via}</td></tr>` };
    });
    const have = rows.filter(row => row.role), none = rows.filter(row => !row.role);
    const table = list => `<div class=tablewrap><table class=flowtable><thead><tr><th scope=col>App</th><th scope=col>Your role</th><th scope=col>What you can do</th><th scope=col>How you got it</th></tr></thead><tbody>${list.map(row => row.html).join('')}</tbody></table></div>`;
    return frame(user, 'me', 'My access', `${isAdminClaim(user) ? '<p class=notice><b>You are a workspace administrator.</b> You can use Blak ID and manage everyone\'s access from the Apps, Groups and People tabs.</p>' : ''}
${problem ? `<p class=notice role=status>${esc(problem)}</p>` : ''}
<p class=gsub>Your role in each app, what it lets you do, and where it comes from. The highest role wins.</p>
${have.length ? table(have) : '<div class=empty><p><b>You have no app roles yet.</b></p></div>'}
${none.length ? `<h2 class=acc-h2>Apps you cannot open</h2>${table(none)}` : ''}
${ask}`);
  }

  function assignForm(user, fields, button, extra = '') {
    return `<form method=post action="/access/admin/review" class=inlineform>${csrfField(user)}${Object.entries(fields).map(([name, value]) => hidden(name, value)).join('')}${extra}<button class=btn-sec type=submit>${esc(button)}</button></form>`;
  }
  function roleChangeForm(user, fields, current, label, none = 'No role (remove)') {
    const id = 'r' + Object.values(fields).join('-').replace(/[^a-zA-Z0-9-]/g, '');
    return assignForm(user, fields, 'Review change', `<label for="${esc(id)}" class=sr>${esc(label)}</label><select id="${esc(id)}" name=role>${roleOptions(current, none)}</select>`);
  }

  async function appsPage(user) {
    const index = await directory();
    const rows = sets.map(set => {
      const counts = ROLES.map(role => {
        const group = index.byName.get(set.groups[role]);
        const teams = group ? index.children(group.pk).length : 0;
        return `${ROLE_LABEL[role]}: ${group ? (group.users || []).length : 0} ${teams ? `+ ${teams} team${teams === 1 ? '' : 's'}` : ''}`;
      }).join(' · ');
      return `<tr><th scope=row><a href="/access/admin/apps/${esc(set.id)}">${esc(setName(set))}</a></th><td>${esc(APP_ACCESS[set.id]?.purpose || '')}</td><td>${esc(counts)}</td></tr>`;
    }).join('');
    return frame(user, 'apps', 'Apps', `<p class=gsub>Choose an app to see what each role can do and who has it, then add, change or remove assignments. Counts show people given the role directly, plus team groups.</p>
<div class=tablewrap><table class=flowtable><caption class=sr>Apps and role assignments</caption><thead><tr><th scope=col>App</th><th scope=col>What it is for</th><th scope=col>Assignments</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }

  async function appPage(user, setId) {
    const set = sets.find(item => item.id === setId);
    if (!set) return null;
    const index = await directory();
    const back = '/access/admin/apps/' + set.id;
    const sections = [];
    for (const role of ROLES) {
      const group = index.byName.get(set.groups[role]);
      const people = group ? await blakId.members(group.pk) : [];
      const teams = group ? index.children(group.pk) : [];
      const personRows = people.map(person => `<tr><th scope=row><a href="/access/admin/people/${esc(person.pk)}">${esc(person.name || person.username)}</a><br><span class=muted>${esc(person.email || person.username)}</span></th><td>Directly</td><td>${roleChangeForm(user, { action: 'person-role', person: person.pk, app: set.id, return: back }, role, 'New role for ' + (person.name || person.username))}</td></tr>`);
      const teamRows = teams.map(team => `<tr><th scope=row><a href="/access/admin/groups/${esc(team.pk)}">${esc(team.name)}</a><br><span class=muted>${(team.users || []).length} member${(team.users || []).length === 1 ? '' : 's'}</span></th><td>${badge(model.classify(team, index).type)}</td><td>${roleChangeForm(user, { action: 'team-role', team: team.pk, app: set.id, return: back }, role, 'New role for team ' + team.name)}</td></tr>`);
      const rows = personRows.concat(teamRows).join('');
      sections.push(`<h2 class=acc-h2>${roleBadge(role)} <span class=muted>${esc(set.groups[role])}</span></h2>
${!group ? '<p class=notice>This role group does not exist in Blak ID yet. An operator must run identity provisioning.</p>' : rows ? `<div class=tablewrap><table class=flowtable><caption class=sr>${esc(ROLE_LABEL[role])} assignments</caption><thead><tr><th scope=col>Who</th><th scope=col>How</th><th scope=col>Change</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class=muted>Nobody has this role.</p>'}`);
    }
    const teams = index.groups.filter(group => { const kind = model.classify(group, index); return kind.type === 'team' && !kind.locked; });
    return frame(user, 'apps', setName(set), `<p class=gsub>${esc(APP_ACCESS[set.id]?.purpose || '')}</p>
${set.apps.length > 1 ? `<p class=notice>${esc(setName(set))} share one set of roles. A change here applies to both.</p>` : ''}
<p class=notice><b>When changes apply:</b> ${esc(timingFor(set))}</p>
${roleCards(set)}
<h2 class=acc-h2>Add an assignment</h2>
<div class=assign>
<form method=post action="/access/admin/review" class=stackform>${csrfField(user)}${hidden('action', 'person-role')}${hidden('app', set.id)}${hidden('return', back)}
<h3>Give a person a role</h3>
<label>Person (username or email)<input name=who required autocomplete=off maxlength=150></label>
<label>Role<select name=role>${roleOptions('writer')}</select></label>
<button class=btn type=submit>Review</button></form>
<form method=post action="/access/admin/review" class=stackform>${csrfField(user)}${hidden('action', 'team-role')}${hidden('app', set.id)}${hidden('return', back)}
<h3>Give a team group a role</h3>
${teams.length ? `<label>Team group<select name=team>${teams.map(team => `<option value="${esc(team.pk)}">${esc(team.name)}</option>`).join('')}</select></label>
<label>Role<select name=role>${roleOptions('reader')}</select></label>
<button class=btn type=submit>Review</button>` : '<p class=muted>No team groups yet. <a href="/access/admin/groups">Create one on the Groups tab</a>.</p>'}</form>
</div>
${sections.join('')}`);
  }

  async function groupsPage(user) {
    const index = await directory();
    const rows = index.groups.slice().sort((a, b) => a.name.localeCompare(b.name)).map(group => {
      const kind = model.classify(group, index);
      const description = group.attributes?.description || GROUP_TYPES[kind.type].description;
      const roles = kind.type === 'team' ? (group.parents || []).map(pk => index.byPk.get(String(pk))).map(parent => parent && index.roleByName.get(parent.name)).filter(Boolean).map(found => `${ROLE_LABEL[found.role]} in ${setName(found.set)}`).join('; ') : '';
      return `<tr><th scope=row><a href="/access/admin/groups/${esc(group.pk)}">${esc(group.name)}</a></th><td>${badge(kind.type)}${kind.locked ? ' <span class=badge data-type=locked>Managed in Blak ID</span>' : ''}</td><td>${esc(description)}${roles ? `<br><span class=muted>Gives: ${esc(roles)}</span>` : ''}</td><td>${(group.users || []).length}</td></tr>`;
    }).join('');
    return frame(user, 'groups', 'Groups', `<p class=gsub>Every group in Blak ID and what it does. Only app role groups and team groups can be changed here.</p>
<dl class=types>${Object.keys(GROUP_TYPES).map(type => `<dt>${badge(type)}</dt><dd>${esc(GROUP_TYPES[type].description)}</dd>`).join('')}</dl>
<form method=post action="/access/admin/review" class="stackform narrow">${csrfField(user)}${hidden('action', 'team-create')}${hidden('return', '/access/admin/groups')}
<h2 class=acc-h2>Create a team group</h2>
<label>Name<input name=name required minlength=2 maxlength=64 autocomplete=off placeholder="Rangers"></label>
<label>Description<input name=description maxlength=200 autocomplete=off placeholder="Ranger team on Country"></label>
<button class=btn type=submit>Review</button></form>
<div class=tablewrap><table class=flowtable><caption class=sr>Blak ID groups</caption><thead><tr><th scope=col>Group</th><th scope=col>Type</th><th scope=col>What it does</th><th scope=col>Members</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }

  async function groupPage(user, pk) {
    const index = await directory();
    const group = index.byPk.get(String(pk));
    if (!group) return null;
    const kind = model.classify(group, index);
    const members = await blakId.members(group.pk);
    const back = '/access/admin/groups/' + group.pk;
    const editable = kind.type === 'team' && !kind.locked;
    const rows = members.map(person => `<tr><th scope=row><a href="/access/admin/people/${esc(person.pk)}">${esc(person.name || person.username)}</a></th><td>${esc(person.email || person.username)}</td><td>${editable ? assignForm(user, { action: 'team-leave', team: group.pk, person: person.pk, return: back }, 'Remove from team') : ''}</td></tr>`).join('');
    let roles = '';
    if (kind.type === 'team') {
      const given = (group.parents || []).map(parent => index.byPk.get(String(parent))).map(parent => parent && index.roleByName.get(parent.name)).filter(Boolean);
      roles = `<h2 class=acc-h2>App roles this team gives its members</h2>
${given.length ? `<div class=tablewrap><table class=flowtable><thead><tr><th scope=col>App</th><th scope=col>Role</th><th scope=col>Change</th></tr></thead><tbody>${given.map(found => `<tr><th scope=row>${esc(setName(found.set))}</th><td>${roleBadge(found.role)}</td><td>${editable ? roleChangeForm(user, { action: 'team-role', team: group.pk, app: found.set.id, return: back }, found.role, 'New role in ' + setName(found.set)) : ''}</td></tr>`).join('')}</tbody></table></div>` : '<p class=muted>This team gives no app roles yet.</p>'}
${editable ? `<form method=post action="/access/admin/review" class=inlineform>${csrfField(user)}${hidden('action', 'team-role')}${hidden('team', group.pk)}${hidden('return', back)}<span class=field><label for=team-app>App</label><select id=team-app name=app>${setOptions()}</select></span><span class=field><label for=team-role>Role</label><select id=team-role name=role>${roleOptions('reader')}</select></span><button class=btn-sec type=submit>Review</button></form>` : ''}`;
    }
    return frame(user, 'groups', group.name, `<p>${badge(kind.type)}${kind.locked ? ' <span class=badge data-type=locked>Managed in Blak ID</span>' : ''}</p>
<p class=gsub>${esc(group.attributes?.description || GROUP_TYPES[kind.type].description)}</p>
${kind.locked ? `<p class=notice role=note>${esc(kind.lock)}</p>` : ''}
${kind.type === 'role' ? `<p class=notice>Manage who has this role on the <a href="/access/admin/apps/${esc(kind.set.id)}">${esc(setName(kind.set))} app page</a>.</p>` : ''}
${roles}
<h2 class=acc-h2>Members (${members.length})</h2>
${editable ? `<form method=post action="/access/admin/review" class=inlineform>${csrfField(user)}${hidden('action', 'team-join')}${hidden('team', group.pk)}${hidden('return', back)}<label>Add a person (username or email)<input name=who required autocomplete=off maxlength=150></label><button class=btn-sec type=submit>Review</button></form>` : ''}
${rows ? `<div class=tablewrap><table class=flowtable><thead><tr><th scope=col>Name</th><th scope=col>Email</th><th scope=col><span class=sr>Actions</span></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class=muted>No direct members.</p>'}`);
  }

  async function peoplePage(user, q) {
    const people = q ? await blakId.searchUsers(q) : [];
    const rows = people.map(person => `<tr><th scope=row><a href="/access/admin/people/${esc(person.pk)}">${esc(person.name || person.username)}</a></th><td>${esc(person.username)}</td><td>${esc(person.email || '')}</td><td>${person.is_active ? 'Active' : 'Disabled'}${person.is_superuser ? ' · Workspace administrator' : ''}</td></tr>`).join('');
    return frame(user, 'people', 'People', `<form method=get action="/access/admin/people" class=inlineform role=search><label>Find a person<input name=q type=search value="${esc(q)}" autocomplete=off maxlength=100 placeholder="Name, username or email"></label><button class=btn-sec type=submit>Search</button></form>
${q ? (rows ? `<div class=tablewrap><table class=flowtable><caption class=sr>Search results</caption><thead><tr><th scope=col>Name</th><th scope=col>Username</th><th scope=col>Email</th><th scope=col>Status</th></tr></thead><tbody>${rows}</tbody></table></div>` : `<p role=status>Nobody matches “${esc(q)}”.</p>`) : '<p class=gsub>Search for a person to see and change their access.</p>'}`);
  }

  async function personPage(user, pk) {
    const [index, person] = await Promise.all([directory(), blakId.user(pk)]);
    const access = model.resolveAccess(person, index);
    const back = '/access/admin/people/' + person.pk;
    const direct = new Set((person.groups || []).map(String));
    const rows = sets.map(set => {
      const found = access.apps.find(item => item.set.id === set.id);
      const directRole = ROLES.find(role => { const group = index.byName.get(set.groups[role]); return group && direct.has(String(group.pk)); }) || '';
      const via = found ? `<ul class=via>${found.grants.map(grant => `<li>${grant.via === 'direct' ? 'Directly' : `Team group <a href="/access/admin/groups/${esc(grant.groupPk)}">${esc(grant.group)}</a>`} (${ROLE_LABEL[grant.role]})</li>`).join('')}</ul>` : '';
      return `<tr><th scope=row>${esc(setName(set))}</th><td>${roleBadge(found?.role || null)}</td><td>${via}</td><td>${roleChangeForm(user, { action: 'person-role', person: person.pk, app: set.id, return: back }, directRole, 'Direct role in ' + setName(set), 'No direct role')}</td></tr>`;
    }).join('');
    const teams = [...direct].map(id => index.byPk.get(id)).filter(group => group && model.classify(group, index).type === 'team');
    const joinable = index.groups.filter(group => { const kind = model.classify(group, index); return kind.type === 'team' && !kind.locked && !direct.has(String(group.pk)); });
    return frame(user, 'people', person.name || person.username, `<p class=gsub>${esc(person.email || person.username)} · ${person.is_active ? 'Active' : 'Disabled: no access to any app'}${person.is_superuser ? ' · Workspace administrator' : ''}</p>
<h2 class=acc-h2>Effective access</h2><p class=gsub>The role shown is what the person gets. Change sets their direct role only; team roles stay. The highest role wins.</p>
<div class=tablewrap><table class=flowtable><thead><tr><th scope=col>App</th><th scope=col>Role</th><th scope=col>Comes from</th><th scope=col>Direct role</th></tr></thead><tbody>${rows}</tbody></table></div>
<h2 class=acc-h2>Team groups</h2>
${teams.length ? `<ul class=teamlist>${teams.map(team => `<li><a href="/access/admin/groups/${esc(team.pk)}">${esc(team.name)}</a> ${model.classify(team, index).locked ? '' : assignForm(user, { action: 'team-leave', team: team.pk, person: person.pk, return: back }, 'Remove from team')}</li>`).join('')}</ul>` : '<p class=muted>Not in any team group.</p>'}
${joinable.length ? `<form method=post action="/access/admin/review" class=inlineform>${csrfField(user)}${hidden('action', 'team-join')}${hidden('person', person.pk)}${hidden('return', back)}<label>Add to team<select name=team>${joinable.map(team => `<option value="${esc(team.pk)}">${esc(team.name)}</option>`).join('')}</select></label><button class=btn-sec type=submit>Review</button></form>` : ''}`);
  }

  function changesPage(user) {
    const rows = audit.recent(100).map(entry => `<tr><td>${esc(String(entry.at).slice(0, 19).replace('T', ' '))} UTC</td><td>${esc(entry.actor?.name || entry.actor?.sub || '')}</td><td>${esc(entry.summary || entry.action)}</td><td>${entry.outcome === 'applied' ? 'Applied' : `<span class=fail>Failed</span>${entry.error ? ': ' + esc(entry.error) : ''}`}</td></tr>`).join('');
    return frame(user, 'changes', 'Recent changes', `<p class=gsub>Every change made from People &amp; access, newest first. Blak ID also records each group change in its own event log.</p>
${rows ? `<div class=tablewrap><table class=flowtable><thead><tr><th scope=col>When</th><th scope=col>Who</th><th scope=col>Change</th><th scope=col>Result</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class=muted>No changes yet.</p>'}`);
  }

  async function findPerson(fields) {
    if (fields.person) return blakId.user(fields.person);
    const who = String(fields.who || '').trim().toLowerCase();
    if (!who) throw new model.GuardError('Enter a username or email.', 400);
    const matches = (await blakId.searchUsers(who)).filter(person => person.username.toLowerCase() === who || String(person.email || '').toLowerCase() === who);
    if (matches.length !== 1) throw new model.GuardError(matches.length ? 'More than one person matches. Use the People tab to pick one.' : 'Nobody has that exact username or email. Use the People tab to search.', 400);
    return matches[0];
  }

  // Builds the plan from fresh Blak ID state. Used by both review and apply.
  async function prepare(fields) {
    if (!ACTIONS.has(fields.action)) throw new model.GuardError('Unknown change', 400);
    const index = await directory();
    const team = fields.team ? index.byPk.get(String(fields.team)) : null;
    if (fields.team && !team) throw new model.GuardError('Unknown group', 404);
    if (fields.action === 'person-role') {
      const person = await findPerson(fields);
      const plan = model.planPersonRole(person, fields.app, fields.role || '', index);
      if (!plan.add.length && !plan.remove.length) throw new model.GuardError('Nothing to change: that is already the direct role.', 400);
      const text = model.describePersonRole(person, plan, index);
      const summary = `${plan.role ? 'Set ' + (person.name || person.username) + "'s direct role to " + ROLE_LABEL[plan.role] : 'Remove ' + (person.name || person.username) + "'s direct role"} in ${setName(plan.set)}`;
      return { index, plan, text, summary, target: { kind: 'person', id: person.pk, name: person.username }, fields: { action: fields.action, person: person.pk, app: plan.set.id, role: plan.role || '' } };
    }
    if (fields.action === 'team-role') {
      const plan = model.planTeamRole(team, fields.app, fields.role || '', index);
      if (!plan.changed) throw new model.GuardError('Nothing to change: the team already has that role.', 400);
      const members = await blakId.members(team.pk);
      const text = model.describeTeamRole(plan, index, members);
      const summary = `${plan.role ? 'Give team ' + team.name + ' ' + ROLE_LABEL[plan.role] : 'Remove the role of team ' + team.name} in ${setName(plan.set)}`;
      return { index, plan, text, summary, target: { kind: 'group', id: team.pk, name: team.name }, fields: { action: fields.action, team: team.pk, app: plan.set.id, role: plan.role || '' } };
    }
    if (fields.action === 'team-join' || fields.action === 'team-leave') {
      if (!team) throw new model.GuardError('Choose a team group.', 400);
      const person = await findPerson(fields);
      const plan = model.planMembership(person, team, fields.action === 'team-join', index);
      if ((person.groups || []).map(String).includes(String(team.pk)) === (fields.action === 'team-join')) throw new model.GuardError(fields.action === 'team-join' ? 'That person is already in the team.' : 'That person is not in the team.', 400);
      const text = model.describeMembership(person, plan, index);
      const summary = `${fields.action === 'team-join' ? 'Add ' + (person.name || person.username) + ' to' : 'Remove ' + (person.name || person.username) + ' from'} team ${team.name}`;
      return { index, plan, text, summary, target: { kind: 'person', id: person.pk, name: person.username, group: team.name }, fields: { action: fields.action, person: person.pk, team: team.pk } };
    }
    const name = model.validateTeamName(fields.name, index);
    const description = String(fields.description || '').trim().slice(0, 200);
    return { index, plan: { kind: 'team-create', name, description }, text: { lines: [`A new team group called ${name} will be created in Blak ID with no members and no app roles.`], timing: 'Takes effect straight away.' }, summary: 'Create team group ' + name, target: { kind: 'group', name }, fields: { action: fields.action, name, description } };
  }

  async function execute(prepared) {
    const { plan } = prepared;
    const done = [];
    try {
      if (plan.kind === 'person-role') {
        const person = prepared.target.id;
        // Add before removing so a partial failure never leaves less access than asked.
        for (const group of plan.add) { await blakId.addMember(group.pk, person); done.push('added to ' + group.name); }
        for (const group of plan.remove) { await blakId.removeMember(group.pk, person); done.push('removed from ' + group.name); }
        const after = new Set(((await blakId.user(person)).groups || []).map(String));
        const expected = new Set(plan.after.groups.map(String));
        const roleGroups = ROLES.map(role => prepared.index.byName.get(plan.set.groups[role])).filter(Boolean).map(group => String(group.pk));
        if (roleGroups.some(pk => after.has(pk) !== expected.has(pk))) throw new Error('Blak ID did not confirm the new role');
      } else if (plan.kind === 'team-role') {
        if (plan.changed) { await blakId.setParents(plan.team.pk, plan.parents); done.push('team roles updated'); }
        const saved = (await blakId.group(plan.team.pk)).parents.map(String).sort().join();
        if (saved !== plan.parents.slice().sort().join()) throw new Error('Blak ID did not confirm the team role');
      } else if (plan.kind === 'team-join' || plan.kind === 'team-leave') {
        const person = prepared.target.id;
        if (plan.kind === 'team-join') await blakId.addMember(plan.team.pk, person);
        else await blakId.removeMember(plan.team.pk, person);
        done.push(plan.kind === 'team-join' ? 'added to team' : 'removed from team');
        const member = ((await blakId.user(person)).groups || []).map(String).includes(String(plan.team.pk));
        if (member !== (plan.kind === 'team-join')) throw new Error('Blak ID did not confirm the team change');
      } else {
        const created = await blakId.createTeam(plan.name, plan.description);
        if (!created || created.name !== plan.name || created.is_superuser) throw new Error('Blak ID did not confirm the new group');
        prepared.target.id = created.pk;
      }
    } catch (error) {
      error.partial = done;
      throw error;
    }
  }

  function reviewPage(user, prepared, back) {
    return frame(user, 'review', 'Confirm change', `<section class=confirm aria-labelledby=confirm-h><h2 id=confirm-h class=acc-h2>${esc(prepared.summary)}</h2>
<ul class=effect>${prepared.text.lines.map(line => `<li>${esc(line)}</li>`).join('')}</ul>
${prepared.text.timing ? `<p class=muted><b>When it applies:</b> ${esc(prepared.text.timing)}</p>` : ''}
<form method=post action="/access/admin/apply">${csrfField(user)}${Object.entries(prepared.fields).map(([name, value]) => hidden(name, value)).join('')}${hidden('return', back)}
<div class=actions><button class=btn type=submit>Confirm change</button> <a class=btn-sec href="${esc(back)}">Cancel</a></div></form></section>`);
  }

  function resultPage(user, ok, prepared, back, message) {
    return frame(user, 'review', ok ? 'Change saved' : 'Change not saved', ok
      ? `<section class="result ok" role=status><h2 class=acc-h2>Done: ${esc(prepared.summary)}</h2><ul class=effect>${prepared.text.lines.map(line => `<li>${esc(line)}</li>`).join('')}</ul>${prepared.text.timing ? `<p><b>When it applies:</b> ${esc(prepared.text.timing)}</p>` : ''}<p><a class=btn-sec href="${esc(back)}">Back</a></p></section>`
      : `<section class="result fail" role=alert><h2 class=acc-h2>Not saved${prepared ? ': ' + esc(prepared.summary) : ''}</h2><p>${esc(message)}</p><p><a class=btn-sec href="${esc(back)}">Back</a></p></section>`);
  }

  function safeReturn(value) {
    return /^\/access\/admin\/(?:apps|groups|people)(?:\/[A-Za-z0-9-]+)?$/.test(String(value || '')) ? value : '/access/admin/apps';
  }

  async function readForm(req) {
    return Object.fromEntries(new URLSearchParams((await readBody(req, 16384)).toString('utf8')));
  }

  function actorOf(user) { return { sub: user.sub, identity: user.identity, name: user.name || user.sub }; }

  async function handleAdmin(req, res, url, user) {
    if (!blakId?.configured) {
      send(res, 503, frame(user, 'apps', 'Not set up yet', '<p class=notice role=alert>Access management is not connected to Blak ID on this workspace. An operator must run <code>scripts/deploy/provision-access-admin.py</code> and give the portal its Blak ID token.</p>'));
      return;
    }
    if (!readLimit(user.sub)) { send(res, 429, frame(user, 'apps', 'Slow down', `<p class=notice role=alert>${PAGE_LIMIT_MESSAGE}</p>`)); return; }
    let admin;
    try { admin = await blakId.isWorkspaceAdmin(user.identity); } catch {
      send(res, 503, frame(user, 'apps', 'Blak ID unavailable', '<p class=notice role=alert>Blak ID could not confirm that you are a workspace administrator. Nothing was changed. Try again shortly.</p>'));
      return;
    }
    if (!admin) {
      send(res, 403, frame(user, 'apps', 'Administrators only', '<p class=notice role=alert>Only workspace administrators can manage access. To get access to an app, ask your workspace administrator.</p><p><a href="/access/me">See your own access</a></p>'));
      return;
    }
    const parts = url.pathname.split('/').filter(Boolean).slice(2);
    if (req.method === 'POST') {
      if (!sameOrigin(req, origin)) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('Cross-origin request rejected'); return; }
      const fields = await readForm(req);
      if (!csrf.valid(user.sessionId, fields.csrf)) { res.writeHead(403, { 'content-type': 'text/plain' }); res.end('This form has expired. Go back, reload the page and try again.'); return; }
      const back = safeReturn(fields.return);
      if (parts[0] === 'review' && parts.length === 1) {
        try { send(res, 200, reviewPage(user, await prepare(fields), back)); } catch (error) { send(res, error.status && error.status < 500 ? error.status : 502, resultPage(user, false, null, back, error.guard || error.status ? error.message : 'Blak ID could not be reached. Nothing was changed.')); }
        return;
      }
      if (parts[0] === 'apply' && parts.length === 1) {
        if (!writeLimit(user.sub)) { send(res, 429, resultPage(user, false, null, back, PAGE_LIMIT_MESSAGE + ' Nothing was changed.')); return; }
        let prepared = null;
        try {
          prepared = await prepare(fields);
          await execute(prepared);
          audit.record({ actor: actorOf(user), action: fields.action, summary: prepared.summary, target: prepared.target, app: prepared.fields.app, role: prepared.fields.role, outcome: 'applied' });
          send(res, 200, resultPage(user, true, prepared, back));
        } catch (error) {
          const partial = error.partial?.length ? ` Part of the change was applied (${error.partial.join(', ')}); check the person's access and try again.` : ' Nothing was changed.';
          const reason = error.status || /^Blak ID /.test(error.message) ? error.message + '.' : 'Blak ID could not complete the change.';
          const message = error.guard ? error.message : reason + partial;
          audit.record({ actor: actorOf(user), action: fields.action, summary: prepared?.summary || ACTIONS.get(fields.action) || 'Unknown change', target: prepared?.target, outcome: 'failed', error: message });
          send(res, error.guard ? error.status : 502, resultPage(user, false, prepared, back, message));
        }
        return;
      }
      res.writeHead(404); res.end(); return;
    }
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    try {
      let html = null;
      if (!parts.length) { res.writeHead(302, { location: '/access/admin/apps' }); res.end(); return; }
      if (parts[0] === 'apps' && parts.length === 1) html = await appsPage(user);
      else if (parts[0] === 'apps' && parts.length === 2) html = await appPage(user, parts[1]);
      else if (parts[0] === 'groups' && parts.length === 1) html = await groupsPage(user);
      else if (parts[0] === 'groups' && parts.length === 2) html = await groupPage(user, parts[1]);
      else if (parts[0] === 'people' && parts.length === 1) html = await peoplePage(user, (url.searchParams.get('q') || '').slice(0, 100));
      else if (parts[0] === 'people' && parts.length === 2) html = await personPage(user, parts[1]);
      else if (parts[0] === 'changes' && parts.length === 1) html = changesPage(user);
      if (!html) { send(res, 404, frame(user, 'apps', 'Not found', '<p>That page does not exist.</p>')); return; }
      send(res, 200, html);
    } catch (error) {
      send(res, error.status === 404 || error.status === 400 ? 404 : 502, frame(user, 'apps', 'Blak ID unavailable', `<p class=notice role=alert>${error.status === 404 || error.status === 400 ? 'Not found in Blak ID.' : 'Blak ID could not be reached. Try again shortly.'}</p>`));
    }
  }

  return {
    async handle(req, res, url, user) {
      if (url.pathname !== '/access' && !url.pathname.startsWith('/access/')) return false;
      if (!user) { res.writeHead(302, { location: '/login' }); res.end(); return true; }
      if (url.pathname === '/access' || url.pathname === '/access/') {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return true; }
        send(res, 200, explainerPage(user)); return true;
      }
      if (url.pathname === '/access/me') {
        if (req.method !== 'GET') { res.writeHead(405); res.end(); return true; }
        if (!readLimit(user.sub)) { send(res, 429, frame(user, 'me', 'Slow down', `<p class=notice role=alert>${PAGE_LIMIT_MESSAGE}</p>`)); return true; }
        send(res, 200, await myAccessPage(user)); return true;
      }
      if (url.pathname === '/access/admin' || url.pathname.startsWith('/access/admin/')) { await handleAdmin(req, res, url, user); return true; }
      send(res, 404, frame(user, 'how', 'Not found', '<p>That page does not exist.</p>'));
      return true;
    },
    explainerPage, myAccessPage, appPage, groupsPage, personPage,
  };
}

module.exports = { createAccess };
