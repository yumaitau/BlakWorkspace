'use strict';
const {test,expect,session}=require('../helpers/fixtures');
async function create(page,name='E2E lifecycle') {
  await page.goto('/flow/new');await page.getByLabel('Name',{exact:true}).fill(name);
  await page.getByRole('button',{name:'Save flow'}).click();await expect(page).toHaveURL(/\/flow\/[a-f0-9]{16}$/);return new URL(page.url()).pathname;
}
test('create, enable, run, disable, delete flow',async({signedIn:page})=>{
  const path=await create(page);await expect(page.getByRole('button',{name:'Run now'})).toHaveCount(0);
  expect((await page.request.post(`${path}/run`)).status()).toBe(400);
  await page.getByRole('button',{name:'Enable',exact:true}).click();await page.getByRole('button',{name:'Run now'}).click();
  await expect(page.locator('[data-testid="run-row"]')).toHaveCount(1);await expect(page.locator('[data-testid="run-row"]')).toContainText('ok');
  await page.goto(path);await page.getByRole('button',{name:'Disable',exact:true}).click();await expect(page.getByRole('button',{name:'Run now'})).toHaveCount(0);
  page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Delete flow'}).click();await expect(page.locator('[data-testid="flow-empty"]')).toBeVisible();
  await page.goto('/flow/activity');await expect(page.locator('[data-testid="flow-activity-empty"]')).toBeVisible();
});
test('server rejects invalid flow action and short name',async({signedIn:page})=>{
  for(const form of [{name:'x'},{name:'Invalid action',step1Action:'erase_everything'}])expect((await page.request.post('/flow',{form:{starterType:'event',starterName:'drive.file_created',...form}})).status()).toBe(400);
});
test('owner cannot read, change, run or delete another account flow',async({signedIn:page,context,baseURL,account})=>{
  const path=await create(page);
  await context.addCookies([{name:'blak_session',value:await session(account+'-other'),url:baseURL}]);
  expect((await page.request.get(path)).status()).toBe(404);
  for(const action of ['enable','disable','run','delete'])expect((await page.request.post(`${path}/${action}`)).status()).toBe(404);
  await context.addCookies([{name:'blak_session',value:await session(account),url:baseURL}]);
});
test('missing and prototype flow names return 404',async({signedIn:page})=>{
  for(const id of ['0000000000000000','constructor','__proto__'])expect((await page.request.get(`/flow/${id}`)).status()).toBe(404);
});
test('failed connector records error and stops later steps',async({signedIn:page})=>{
  await page.goto('/flow/new');await page.getByLabel('Name',{exact:true}).fill('Missing file');await page.locator('select[name="step1Action"]').selectOption('read_file');
  await page.getByRole('button',{name:'Save flow'}).click();await page.getByRole('button',{name:'Enable',exact:true}).click();await page.getByRole('button',{name:'Run now'}).click();
  await expect(page.locator('[data-testid="run-row"]')).toContainText('not found');await expect(page.locator('[data-testid="run-row"]')).not.toContainText('sites.create_page');
});
test('schedule starter can run manually',async({signedIn:page})=>{
  await page.goto('/flow/new');await page.getByLabel('Name',{exact:true}).fill('Manual schedule');await page.getByLabel('Starter type').selectOption('schedule');
  await page.getByRole('button',{name:'Save flow'}).click();await page.getByRole('button',{name:'Enable',exact:true}).click();await page.getByRole('button',{name:'Run now'}).click();await expect(page.locator('[data-testid="run-row"]')).toContainText('ok');
});

test('flow names cannot inject document-title scripts',async({signedIn:page})=>{
  const name='</title><script>window.flowInjected=true</script>';
  await create(page,name);
  expect(await page.evaluate(()=>window.flowInjected)).toBeUndefined();
  await expect(page).toHaveTitle(name+' — Blak Workspace');
  await expect(page.locator('.greet')).toHaveText(name);
});
