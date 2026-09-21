'use strict';
const {test,expect}=require('../helpers/fixtures');
const {identityCookies,updateIdentity}=require('../helpers/identity');

test('grants filter navigation and native login; renames preserve private ownership',async({page,context,account,baseURL})=>{
  test.setTimeout(150000);
  await context.addCookies(await identityCookies(account,'Access test',['draw']));
  await page.goto('/');
  const original=await(await page.request.get('/api/me')).json();
  expect(original.sub).toBe(original.identity);
  const modules=async()=>(await(await page.request.get('/api/modules')).json()).modules.map(a=>a.id);
  expect(await modules()).toEqual(['draw']);
  expect((await page.request.get('/launch/crm',{maxRedirects:0})).status()).toBe(403);
  expect((await page.request.get('/cloud')).status()).toBe(403);
  const board=await(await page.request.post('/api/draw',{data:{name:'Identity continuity'}})).json();
  try {
    // Direct app entry must enforce the same grant at the actual identity provider.
    await page.goto('https://forms.workspace.example.com/connect/oidc?state='+account);
    await expect(page.locator('body')).toContainText(/denied|not authorized|not permitted/i,{timeout:30000});
    updateIdentity(account,{rename:true});
    await page.goto(baseURL+'/login');await page.waitForURL(baseURL+'/');
    const renamed=await(await page.request.get('/api/me')).json();
    expect(renamed.sub).toBe(original.sub);expect(renamed.identity).toBe(original.identity);
    expect((await page.request.get('/api/draw/'+board.id)).status()).toBe(200);
    updateIdentity(account,{grants:[]});
    await expect.poll(modules,{timeout:45000,intervals:[1000]}).toEqual([]);
    expect((await page.request.get('/api/draw/'+board.id)).status()).toBe(403);
    await page.reload();await expect(page.locator('#tiles .card')).toHaveCount(0);
    await page.goto(baseURL+'/welcome');await expect(page.getByRole('heading',{name:'Your first steps'})).toBeVisible();
  } finally {
    updateIdentity(account,{grants:['draw']});
    await page.goto(baseURL+'/login');await page.waitForURL(baseURL+'/');
    const response=await page.request.delete('/api/draw/'+board.id,{data:{revision:board.revision}});
    expect(response.ok()).toBeTruthy();
  }
});
