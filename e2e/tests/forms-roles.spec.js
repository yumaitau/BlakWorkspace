'use strict';
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { identityCookies, updateIdentity } = require('../helpers/identity');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function controllerToken() {
  try {
    const secret = JSON.parse(execFileSync('kubectl', ['-n', 'blak-micro', 'get', 'secret',
      'blak-forms-role-controller', '-o', 'json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
    return Buffer.from(secret.data.token, 'base64').toString();
  } catch { throw Error('Forms controller fixture unavailable; credentials omitted'); }
}

function cleanup(nativeId, subject, key) {
  if (!nativeId || !subject) return;
  // Operator cleanup is restricted to this test's immutable identity and owned workspace.
  const source = `const mongoose=require('/app/packages/server/node_modules/mongoose');
  (async()=>{await mongoose.connect(process.env.MONGO_URI);const db=mongoose.connection.db;
  const id=${JSON.stringify(nativeId)},subject=${JSON.stringify(subject)},key=${JSON.stringify(key)};
  const user=await db.collection('usermodels').findOne({_id:new mongoose.Types.ObjectId(id)});
  const link=await db.collection('usersocialaccountmodels').findOne({kind:'oidc',userId:id,openId:process.env.OIDC_ISSUER+'#'+encodeURIComponent(subject)});
  if(!user||!link||!user.email.endsWith('@example.invalid'))throw Error('Fixture identity mismatch');
  const teams=await db.collection('teammodels').find({ownerId:id,name:{$regex:'^'+key}}).toArray();
  for(const team of teams){const teamId=String(team._id);
    const projects=await db.collection('projectmodels').find({teamId}).toArray();
    const projectIds=projects.map(p=>String(p._id));
    const forms=await db.collection('formmodels').find({teamId}).toArray();const formIds=forms.map(f=>String(f._id));
    for(const name of ['submissionmodels','formanalyticmodels','formopenhistorymodels','formreportmodels','integrationmodels'])await db.collection(name).deleteMany({formId:{$in:formIds}});
    await db.collection('formmodels').deleteMany({teamId});
    await db.collection('projectmembermodels').deleteMany({projectId:{$in:projectIds}});
    await db.collection('projectmodels').deleteMany({teamId});
    for(const name of ['teammembermodels','teamactivitymodels','teaminvitationmodels','brandkitmodels'])await db.collection(name).deleteMany({teamId});
    await db.collection('teammodels').deleteOne({_id:team._id,ownerId:id});
  }
  await db.collection('usersocialaccountmodels').deleteOne({_id:link._id});
  await db.collection('usermodels').deleteOne({_id:user._id});await mongoose.disconnect();
  })().catch(()=>{console.error('Forms fixture cleanup failed; private details omitted');process.exitCode=1});`;
  execFileSync('kubectl', ['-n', 'blak-micro', 'exec', '-i', 'deploy/forms', '-c', 'forms', '--', 'node', '-'],
    { input: source, stdio: ['pipe', 'pipe', 'pipe'] });
}

test('native Forms roles cap owners, aliases, uploads and existing sessions', async ({ page, context }) => {
  test.setTimeout(840000);
  const origin = new URL(process.env.BLAK_E2E_FORMS_URL).origin;
  const token = controllerToken(), key = 'forms-role-' + crypto.randomBytes(5).toString('hex');
  let native, subject, teamId, projectId, formId;
  async function waitRole(role) {
    await expect.poll(async () => {
      const response = await page.request.post(origin + '/api/blak/roles/identities', {
        headers: { authorization: 'Bearer ' + token }, data: {},
      });
      if (!response.ok()) throw Error('Forms controller identities HTTP ' + response.status());
      native = (await response.json()).find(user => user.subject === subject);
      return native ? native.role : 'missing';
    }, { timeout: 160000, intervals: [2000, 4000] }).toBe(role);
  }
  async function gql(query, variables = {}) {
    const response = await page.request.post(origin + '/graphql', { data: { query, variables } });
    if (response.status() !== 200) throw Error('Forms GraphQL HTTP ' + response.status());
    return response.json();
  }
  async function accepted(query, variables) {
    const result = await gql(query, variables);
    expect(Boolean(result.errors)).toBe(false);
    return result.data;
  }
  async function denied(query, variables) {
    const result = await gql(query, variables);
    expect(result.errors?.some(error => error.message === 'Blak ID does not grant this Forms operation')).toBe(true);
  }
  const readForm = () => accepted('query($input:FormDetailInput!){formDetail(input:$input){id name}}', { input: { formId } });
  const rename = name => ({ input: { formId, name } });
  const update = 'mutation($input:UpdateFormInput!){updateForm(input:$input)}';
  try {
    await context.addCookies(await identityCookies(key, 'Forms native role fixture', ['forms'], { forms: 'writer' }));
    subject = (await (await page.request.get('/api/me')).json()).sub;
    await waitRole('writer');
    const nativeId = native.id;
    await page.goto(origin + '/_blak/launch.html');
    await page.waitForURL(url => url.origin === origin && !url.pathname.startsWith('/connect/')
      && url.pathname !== '/_blak/launch.html' && url.pathname !== '/login', { timeout: 60000 });
    const profile = (await accepted('query{userDetail{id blakRole}}')).userDetail;
    expect(profile).toEqual({ id: nativeId, blakRole: 'writer' });
    teamId = (await accepted('mutation($input:CreateTeamInput!){createTeam(input:$input)}', {
      input: { name: key, projectName: key },
    })).createTeam;
    projectId = (await accepted('query($input:TeamDetailInput!){projects(input:$input){id}}', { input: { teamId } })).projects[0].id;
    // Native HeyForm enums: INTERACTIVE=2, SURVEY=1.
    formId = (await accepted('mutation($input:CreateFormInput!){createForm(input:$input)}', {
      input: { projectId, name: key, interactiveMode: 2, kind: 1 },
    })).createForm;
    await accepted(update, rename(key + '-writer'));
    await denied('mutation($input:UpdateTeamInput!){updateTeam(input:$input)}', { input: { teamId, name: key + '-forbidden' } });
    await denied('mutation($input:CreateProjectInput!){createProject(input:$input)}', { input: { teamId, name: key, memberIds: ['foreign'] } });
    updateIdentity(key, { roles: { forms: 'reader' } });
    await waitRole('reader');
    expect((await readForm()).formDetail.name).toBe(key + '-writer');
    await denied(update, rename('forbidden'));
    await denied('mutation($input:UpdateFormInput!){first:updateForm(input:$input) second:updateForm(input:$input)}', rename('forbidden'));
    await denied('query($input:ProjectDetailInput!){innocent:deleteProjectCode(input:$input)}', { input: { projectId } });
    const upload = await page.request.post(origin + '/api/upload', {
      multipart: { file: { name: key + '.txt', mimeType: 'text/plain', buffer: Buffer.from(key) } },
    });
    expect(upload.status()).toBe(403);
    expect((await readForm()).formDetail.name).toBe(key + '-writer');
    await page.goto(origin + '/workspace/' + teamId + '/project/' + projectId);
    await expect(page.getByText(key + '-writer', { exact: true }).first()).toBeVisible({ timeout: 60000 });
    updateIdentity(key, { roles: { forms: 'admin' } });
    await waitRole('admin');
    await accepted('mutation($input:UpdateTeamInput!){updateTeam(input:$input)}', { input: { teamId, name: key + '-admin' } });
    await accepted(update, rename(key + '-admin'));
    const unauthorizedController = await page.request.post(origin + '/api/blak/roles/reconcile', { data: [] });
    expect(unauthorizedController.status()).toBe(403);
    updateIdentity(key, { active: false });
    await waitRole(null);
    await denied('query{userDetail{id}}');
    updateIdentity(key, { active: true, roles: { forms: 'reader' } });
    await waitRole('reader');
    expect(native.id).toBe(nativeId);
    expect((await readForm()).formDetail.name).toBe(key + '-admin');
    updateIdentity(key, { grants: ['search'], roles: { search: 'admin' } });
    await waitRole(null);
    await denied('query{userDetail{id}}');
    updateIdentity(key, { grants: ['forms'], roles: { forms: 'writer' }, email: key + '-renamed@example.invalid' });
    await waitRole('writer');
    expect(native.id).toBe(nativeId);
    await accepted(update, rename(key + '-restored'));
    updateIdentity(key, { grants: [] });
    await waitRole(null);
    await denied('query{userDetail{id}}');
  } finally {
    // Stop directory recreation before removing native fixture records.
    if (subject && native) {
      updateIdentity(key, { grants: [] });
      await waitRole(null);
      cleanup(native.id, subject, key);
    }
  }
});
