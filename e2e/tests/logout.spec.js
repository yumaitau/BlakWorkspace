'use strict';
const {test,expect}=require('@playwright/test');
const {authentikLogin}=require('../helpers/auth');
const {identityCookies}=require('../helpers/identity');
const {syncAccount}=require('../helpers/sync');

test('Blak ID logout sends a signed back-channel revocation to the portal',async({page,context})=>{
  await context.addCookies(await identityCookies('backchannel-owner','Back-channel owner',['draw']));
  expect((await page.request.get('https://portal.workspace.example.com/api/me')).status()).toBe(200);
  await page.goto('https://id.workspace.example.com/if/flow/default-invalidation-flow/');
  await expect.poll(async()=>(await page.request.get('https://portal.workspace.example.com/api/me')).status(),{timeout:10000}).toBe(401);
});

test('suite logout revokes native sessions and requires fresh Blak ID login',async({page,context,browser})=>{
  test.setTimeout(180000);
  await page.goto('https://portal.workspace.example.com/login');
  await authentikLogin(page);
  await expect(page).toHaveURL('https://portal.workspace.example.com/');
  const checks={
    forms:p=>p.getByText('Recent forms',{exact:true}),
    crm:p=>p.getByRole('button',{name:'Create',exact:true}),
    sites:p=>p.getByRole('link',{name:'Home',exact:true}),
    projects:p=>p.getByRole('button',{name:/Create project|Create workspace/}).first(),
    drive:p=>p.getByRole('heading',{name:'Personal',exact:true}),
    chat:p=>p.getByRole('button',{name:'Create channel',exact:true}),
    hermes:p=>p.locator('#chat-input'),
  };
  const pages={};
  for(const [id,ready] of Object.entries(checks)) {
    const app=await context.newPage();pages[id]=app;
    await app.goto('https://portal.workspace.example.com/launch/'+id);
    await expect(ready(app)).toBeVisible();
  }
  const saved=await context.storageState();
  const chat=await pages.chat.evaluate(()=>({token:localStorage.getItem('Meteor.loginToken'),user:localStorage.getItem('Meteor.userId')}));
  const hermes=await pages.hermes.evaluate(()=>localStorage.getItem('token'));
  await page.goto('https://portal.workspace.example.com/logout');
  await expect(page.getByRole('textbox',{name:/email or username/i})).toBeVisible({timeout:45000});
  const old=await browser.newContext({ignoreHTTPSErrors:true,storageState:saved});
  try {
    expect((await old.request.get('https://portal.workspace.example.com/api/me')).status()).toBe(401);
    expect((await old.request.post('https://sites.workspace.example.com/api/auth.info')).status()).toBe(401);
    expect((await old.request.get('https://chat.workspace.example.com/api/v1/me',{headers:{'X-Auth-Token':chat.token,'X-User-Id':chat.user}})).status()).toBe(401);
    expect((await old.request.get('https://hermes.workspace.example.com/api/v1/auths/',{headers:{Authorization:'Bearer '+hermes}})).status()).toBe(401);
    // An explicitly enrolled background connector has its own PAT, not a browser session.
    const connector=syncAccount().sources.chat;
    expect((await old.request.get('https://chat.workspace.example.com/api/v1/me',{headers:connector.headers})).status()).toBe(200);
    const fresh=await old.newPage();await fresh.goto('https://portal.workspace.example.com/login');
    await expect(fresh.getByRole('textbox',{name:/email or username/i})).toBeVisible();
  } finally {await old.close();}
});
