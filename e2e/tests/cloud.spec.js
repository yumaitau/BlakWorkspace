'use strict';
const {test,expect}=require('../helpers/fixtures');
const bucket='blak-e2e-cleanup';
test('create bucket, upload, list, filter, download and delete object',async({signedIn:page,account})=>{
  await page.goto('/cloud');await expect(page.locator('main')).not.toContainText('unavailable right now');
  await page.getByPlaceholder('New bucket name…').fill(bucket);await page.getByRole('button',{name:'Create bucket'}).click();await expect(page).toHaveURL(new RegExp(`bucket=${bucket}`));
  const name=`${account}-café's.txt`,content='Blak E2E round-trip '+account;
  const url='/cloud/object?'+new URLSearchParams({bucket,key:name});
  try {
    await page.locator('#upfile').setInputFiles({name,mimeType:'text/plain',buffer:Buffer.from(content)});await page.getByRole('button',{name:'Upload',exact:true}).click();await expect(page.locator('#upmsg')).toContainText('Uploaded');
    await page.reload();await expect(page.getByRole('link',{name:'⬇ '+name})).toBeVisible();
    const response=await page.request.get(url);expect(response.status()).toBe(200);expect(await response.text()).toBe(content);expect(response.headers()['content-disposition']).toContain('filename*=');
    await page.goto('/cloud?'+new URLSearchParams({bucket,prefix:'not-a-real-prefix'}));await expect(page.getByRole('link',{name:'⬇ '+name})).toHaveCount(0);
    await page.goto('/cloud?'+new URLSearchParams({bucket}));await page.getByRole('button',{name:'Delete '+name,exact:true}).click();await expect(page.getByRole('link',{name:'⬇ '+name})).toHaveCount(0);
    expect((await page.request.get(url)).status()).toBe(404);
  } finally {await page.request.delete(url);}
});
test('invalid cloud inputs rejected',async({signedIn:page})=>{
  for(const query of ['bucket=abc','key=x','bucket=../bad&key=x','bucket=abc&key=../x'])expect((await page.request.get('/cloud/object?'+query)).status()).toBe(400);
  const response=await page.request.post('/cloud/bucket',{form:{name:'bad/name'},maxRedirects:0});expect(response.headers().location).toContain('Invalid%20bucket');
});
