'use strict';
const crypto=require('node:crypto');
const {test,expect}=require('../helpers/offline-test');
const {authentikLogin}=require('../helpers/auth');
const {syncAccount,serviceURL,ownedPersonalDrive}=require('../helpers/sync');

test.use({ trace: 'off', screenshot: 'off', video: 'off' });
test('Drive opens, edits and saves a real document in Collabora',async({page,playwright})=>{
 test.setTimeout(150000);
 const driveOrigin=process.env.BLAK_E2E_DRIVE_URL||'https://drive.workspace.example.com';
 const source=syncAccount().sources.drive;
 const drive=await playwright.request.newContext({proxy:undefined,baseURL:serviceURL('drive',9200),extraHTTPHeaders:{authorization:'Basic '+Buffer.from(source.username+':'+source.password).toString('base64')}});
 const drives=await (await drive.get('/graph/v1.0/drives')).json();
 const personal=ownedPersonalDrive(await (await drive.get('/graph/v1.0/me')).json(),drives);
 const name='blak-docs-e2e-'+crypto.randomBytes(5).toString('hex')+'.odt';
 const path=new URL(personal.root.webDavUrl).pathname+'/'+name;
 let failure;
 if(process.env.BLAK_E2E_DRIVE_DIAGNOSTICS==='true')page.on('response',response=>{
  if(response.status()>=400)console.log('Docs HTTP rejection',response.status(),new URL(response.url()).pathname);
 });
 try {
  expect((await drive.put(path,{data:require('node:fs').readFileSync(require('node:path').join(__dirname,'../fixtures/docs.odt')),headers:{'content-type':'application/vnd.oasis.opendocument.text'}})).ok()).toBeTruthy();
  await page.goto(driveOrigin);await authentikLogin(page);
  await page.waitForURL(u=>u.origin===new URL(driveOrigin).origin&&!/callback/.test(u.pathname));
  await page.getByText(name,{exact:true}).dblclick();
  await expect(page.locator('iframe')).toBeVisible();
  const editor=page.frameLocator('iframe');
  await expect(editor.locator('#document-container')).toBeVisible({timeout:60000});
  // The workspace shell brands Drive; it deliberately does not inject into WOPI frames.
  await expect(page.locator('html')).toHaveAttribute('data-blak-app','drive');
  await expect(editor.locator('#toolbar-up')).toBeVisible();
  const welcome=editor.frameLocator('iframe[title="Welcome Dialogue"]');
  await editor.locator('iframe[title="Welcome Dialogue"]').waitFor({timeout:5000}).catch(()=>{});
  if(await editor.locator('iframe[title="Welcome Dialogue"]').isVisible())await welcome.getByRole('button',{name:'Close',exact:true}).click();
  const edited='Saved by Blak Docs '+crypto.randomBytes(4).toString('hex');
  await editor.locator('#document-container').click();
  const input=editor.locator('#clipboard-area');
  await input.press('End');await input.press('Enter');await input.pressSequentially(edited);await input.press('ControlOrMeta+s');
  await expect.poll(async()=>{
   const response=await drive.get(path);
   // OpenCloud can briefly lock (423) or still process (425) a saved file.
   // Keep the bounded content-readback assertion; neither status means success.
   if([423,425].includes(response.status()))return false;
   if(!response.ok())throw Error(`Saved document read failed: HTTP ${response.status()}`);
   const data=await response.body();
   if(data[0]!==0x50||data[1]!==0x4b)throw Error(`Saved document is not ODT: HTTP ${response.status()}, ${response.headers()['content-type']||'unknown type'}`);
   const content=require('node:child_process').execFileSync('python3',['-c',"import sys,io,zipfile; print(zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())).read('content.xml').decode())"],{input:data}).toString();
   return content.includes(edited);
  },{timeout:45000}).toBe(true);
  await page.screenshot({path:test.info().outputPath('docs-editor.png'),fullPage:true});
 } catch(error) {
  failure=error;throw error;
 } finally {
  await page.close();
  // Collabora releases its WOPI lock asynchronously after the editor closes.
  try {
   await expect.poll(async()=>{const response=await drive.delete(path);return response.ok()||response.status()===404;},{timeout:30000}).toBe(true);
  } catch(cleanupError) {
   if(!failure)throw cleanupError;
   console.log('Docs fixture cleanup failed after primary test failure');
  } finally {await drive.dispose();}
 }
});
