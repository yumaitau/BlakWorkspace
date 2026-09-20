'use strict';
const crypto=require('node:crypto');
const {test,expect}=require('@playwright/test');
const {authentikLogin}=require('../helpers/auth');
const {syncAccount,serviceURL}=require('../helpers/sync');

test('Blak Docs opens, edits and saves a real Drive document with themed chrome',async({page,playwright})=>{
 test.setTimeout(150000);
 const source=syncAccount().sources.drive;
 const drive=await playwright.request.newContext({baseURL:serviceURL('drive',9200),extraHTTPHeaders:{authorization:'Basic '+Buffer.from(source.username+':'+source.password).toString('base64')}});
 const drives=await (await drive.get('/graph/v1.0/drives')).json();
 const personal=drives.value.find(item=>item.driveType==='personal');expect(personal).toBeTruthy();
 const name='blak-docs-e2e-'+crypto.randomBytes(5).toString('hex')+'.odt';
 const path=new URL(personal.root.webDavUrl).pathname+'/'+name;
 try {
  expect((await drive.put(path,{data:require('node:fs').readFileSync(require('node:path').join(__dirname,'../fixtures/docs.odt')),headers:{'content-type':'application/vnd.oasis.opendocument.text'}})).ok()).toBeTruthy();
  await page.goto('https://drive.homelab.local');await authentikLogin(page);
  await page.waitForURL(u=>u.hostname==='drive.homelab.local'&&!/callback/.test(u.pathname));
  await page.getByText(name,{exact:true}).dblclick();
  await expect(page.locator('iframe')).toBeVisible();
  const editor=page.frameLocator('iframe');
  await expect(editor.locator('#document-container')).toBeVisible({timeout:60000});
  await expect(editor.locator('html')).toHaveAttribute('data-blak-app','docs');
  await expect(editor.locator('#toolbar-up')).toBeVisible();
  const welcome=editor.frameLocator('iframe[title="Welcome Dialogue"]');
  await editor.locator('iframe[title="Welcome Dialogue"]').waitFor({timeout:5000}).catch(()=>{});
  if(await editor.locator('iframe[title="Welcome Dialogue"]').isVisible())await welcome.getByRole('button',{name:'Close',exact:true}).click();
  const edited='Saved by Blak Docs '+crypto.randomBytes(4).toString('hex');
  await editor.locator('#document-container').click();await page.keyboard.press('Control+End');await page.keyboard.press('Enter');await page.keyboard.type(edited);await page.keyboard.press('Control+s');
  await expect.poll(async()=>{const data=await (await drive.get(path)).body();return require('node:child_process').execFileSync('python3',['-c',"import sys,io,zipfile; print(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read('content.xml').decode())"],{input:data}).toString();},{timeout:45000}).toContain(edited);
  await page.screenshot({path:test.info().outputPath('docs-editor.png'),fullPage:true});
 } finally {await page.close();expect((await drive.delete(path)).ok()).toBeTruthy();await drive.dispose();}
});
