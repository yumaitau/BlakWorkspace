'use strict';
// Operator-created, least-privilege test accounts use the real OIDC browser flow.
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {chromium}=require('@playwright/test');
const {INTEGRATIONS}=require('../../apps/portal/integration');
const run=crypto.randomBytes(6).toString('hex'), accounts=new Map(), sessions=new Map();
function shell(source) {
  try {
    return execFileSync('kubectl',['-n',process.env.BLAK_E2E_NAMESPACE||'blak-micro','exec','-i','deploy/authentik-server','--','ak','shell'],{input:'exec('+JSON.stringify(source)+')\n',encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000});
  } catch { throw Error('OIDC fixture provisioning failed; credentials omitted'); }
}
function groupNames(grants, roles = {}) {
  return grants.map(id => {
    const integration = INTEGRATIONS[id];
    if (!integration) throw Error('Unknown test application');
    if (!integration.roleGroups) return integration.group;
    const name = integration.roleGroups.find(name => name.endsWith('-' + (roles[id] || 'writer')));
    if (!name) throw Error('Unknown test application role');
    return name;
  });
}
async function session(key,name=key,grants=['draw','flow','storage','search','hermes'],roles={}) {
  const cached=sessions.get(key);
  if(cached && cached.name===name && cached.until>Date.now()) return cached.cookie;
  let account=accounts.get(key);
  if(!account) {
    account={username:'e2e-'+run+'-'+crypto.randomBytes(5).toString('hex'),password:crypto.randomBytes(32).toString('hex')};
    account.grants=grants;account.roles=roles;
    const data={...account,name,groups:groupNames(grants,roles)};
    const source='import json\nfrom authentik.core.models import User, Group\ndata=json.loads('+JSON.stringify(JSON.stringify(data))+')\nuser=User.objects.create(username=data["username"],name=data["name"],type="internal",is_active=True)\nuser.set_password(data["password"]);user.save()\nuser.groups.add(*Group.objects.filter(name__in=data["groups"]))\nprint("FIXTURE_ID="+str(user.uuid))';
    const output=shell(source), match=output.match(/FIXTURE_ID=([a-f0-9-]{36})/);
    if(!match) throw Error('OIDC fixture was not created');
    account.uuid=match[1];accounts.set(key,account);
  }
  const browser=process.env.PLAYWRIGHT_WS_ENDPOINT?await chromium.connect({wsEndpoint:process.env.PLAYWRIGHT_WS_ENDPOINT,exposeNetwork:process.env.PLAYWRIGHT_EXPOSE_NETWORK}):await chromium.launch();
  const context=await browser.newContext({ignoreHTTPSErrors:true,...require('./network').publicNetworkOptions});
  try {
    const page=await context.newPage(),base=process.env.BLAK_E2E_BASE_URL||'https://portal.workspace.example.com';
    await page.goto(base+'/login');
    await page.getByRole('textbox',{name:/email or username/i}).fill(account.username);
    await page.getByRole('button',{name:/log in/i}).click();
    await page.getByRole('textbox',{name:/password/i}).fill(account.password);
    await page.getByRole('button',{name:/continue/i}).click();
    await page.waitForURL(url=>url.origin===new URL(base).origin && url.pathname==='/');
    const cookie=(await context.cookies(base)).find(c=>c.name==='blak_session')?.value;
    if(!cookie) throw Error('OIDC fixture did not establish a portal session');
    sessions.set(key,{cookie,name,cookies:await context.cookies(),until:Date.now()+240000});return cookie;
  } finally {await context.close();await browser.close();}
}
async function identityCookies(key,name=key,grants,roles) {
  await session(key,name,grants,roles);return sessions.get(key).cookies;
}
function updateIdentity(key,{rename=false,grants,roles,active}={}) {
  const account=accounts.get(key);if(!account) throw Error('Unknown test identity');
  if(grants) account.grants=grants;
  if(roles) account.roles=roles;
  const data={uuid:account.uuid,username:rename?account.username+'-renamed':account.username,groups:grants||roles?groupNames(account.grants,account.roles):undefined,active};
  shell('import json\nfrom authentik.core.models import User, Group\ndata=json.loads('+JSON.stringify(JSON.stringify(data))+')\nuser=User.objects.get(uuid=data["uuid"],username__startswith='+JSON.stringify('e2e-'+run+'-')+')\nuser.username=data["username"]\nif "active" in data: user.is_active=data["active"]\nuser.save()\nif "groups" in data: user.groups.set(Group.objects.filter(name__in=data["groups"]))');
  account.username=data.username;sessions.delete(key);
}
process.once('exit',()=>{
  if(!accounts.size) return;
  const ids=[...accounts.values()].map(a=>a.uuid);
  try {shell('import json\nfrom authentik.core.models import User\nUser.objects.filter(uuid__in=json.loads('+JSON.stringify(JSON.stringify(ids))+'),username__startswith='+JSON.stringify('e2e-'+run+'-')+').delete()');} catch {}
});
module.exports={session,identityCookies,updateIdentity};
