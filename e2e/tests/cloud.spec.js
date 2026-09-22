'use strict';
const {test,expect}=require('../helpers/fixtures');
const bucket='blak-e2e-cleanup';
test('signed-in Blak Cloud opens the white-label console',async({signedIn:page})=>{
  await page.goto('/cloud');
  await expect(page).toHaveTitle('Blak Cloud');
  await expect(page.locator('body')).toContainText('Console Home');
  await expect(page.locator('#blak-workspace-shell')).toBeVisible();
});
test('object API uploads, downloads and deletes through the signed-in session',async({signedIn:page,account})=>{
  expect((await page.request.post('/cloud/bucket',{form:{name:bucket},maxRedirects:0})).status()).toBeLessThan(400);
  const name=`${account}-cafe.txt`,content='Blak E2E round-trip '+account;
  const url='/cloud/object?'+new URLSearchParams({bucket,key:name});
  try {
    expect((await page.request.put(url,{data:content})).status()).toBeLessThan(300);
    const response=await page.request.get(url);
    expect(response.status()).toBe(200);
    expect(await response.text()).toBe(content);
    expect((await page.request.delete(url)).ok()).toBeTruthy();
    expect((await page.request.get(url)).status()).toBe(404);
  } finally {await page.request.delete(url);}
});
test('invalid cloud inputs rejected',async({signedIn:page})=>{
  for(const query of ['bucket=abc','key=x','bucket=../bad&key=x','bucket=abc&key=../x'])expect((await page.request.get('/cloud/object?'+query)).status()).toBe(400);
  const response=await page.request.post('/cloud/bucket',{form:{name:'bad/name'},maxRedirects:0});expect(response.headers().location).toContain('Invalid%20bucket');
});
