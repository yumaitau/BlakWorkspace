'use strict';
const {test,expect}=require('@playwright/test');
const AxeBuilder=require('@axe-core/playwright').default;
const {authentikLogin}=require('../helpers/auth');
const {session}=require('../helpers/fixtures');
const apps=[['portal','https://portal.homelab.local/'],['crm','https://crm.homelab.local/login?redirect-to=/crm'],['forms','https://forms.homelab.local/'],['projects','https://projects.homelab.local/'],['knowledge','https://sites.homelab.local/'],['drive','https://drive.homelab.local/'],['hermes','https://hermes.homelab.local/'],['chat','https://chat.homelab.local/']];
async function portalLogin(page){await page.goto('https://portal.homelab.local/login');await authentikLogin(page);await page.waitForURL(u=>u.hostname==='portal.homelab.local'&&u.pathname==='/');}
for(const [name,url] of apps)test(`shared shell ${name}: themes, navigation, keyboard, responsive and accessible`,async({page})=>{
 test.setTimeout(120000);await portalLogin(page);await page.goto(url);
 if(name==='crm')await page.getByRole('link',{name:/Blak ID/}).click();
 if(name==='forms')await page.getByRole('button',{name:'Blak ID',exact:true}).click();
 if(name==='hermes')await page.getByRole('button',{name:'Continue with Blak ID'}).click();
 if(name==='projects'){const login=page.getByRole('button',{name:/Continue with OIDC/i});await Promise.race([page.waitForURL(/\/onboarding|\/workspace/, {timeout:15000}),login.waitFor({timeout:15000})]).catch(()=>{});if(await login.isVisible())await login.click();}
 if(name==='chat'){const login=page.getByRole('button',{name:/Blak ID/i});if(await login.isVisible())await login.click();}
 await page.waitForURL(u=>u.hostname===new URL(url).hostname&&!/login|sign-in|oauth|callback/.test(u.pathname));
 const shell=page.locator('#blak-workspace-shell');await expect(shell).toBeVisible();
 const open=shell.getByRole('button',{name:'Blak Workspace',exact:true});
 await open.click();await expect(shell.getByRole('link',{name:'Workspace home',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(open).toBeFocused();
 for(const mode of ['light','dark']){
  await open.click();const toggle=shell.getByRole('button',{name:'Use '+mode+' theme'});if(await toggle.isVisible())await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme',mode);
  await expect(shell.locator('#panel')).toHaveScreenshot(`${name}-switcher-${mode}.png`,{animations:'disabled',maxDiffPixelRatio:0.005});
  const result=await new AxeBuilder({page}).include('#blak-workspace-shell').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(result.violations).toEqual([]);
  await page.keyboard.press('Escape');
 }
 await page.setViewportSize({width:390,height:844});await open.click();
 const box=await shell.locator('#panel').boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
 await expect(shell.locator('#panel')).toHaveScreenshot(`${name}-switcher-mobile.png`,{animations:'disabled',maxDiffPixelRatio:0.005});
 await page.keyboard.press('Escape');await page.screenshot({path:test.info().outputPath(name+'-mobile.png'),fullPage:true});
 await shell.getByRole('button',{name:'Blak Workspace',exact:true}).click();await shell.getByRole('link',{name:'Workspace home',exact:true}).click();await expect(page).toHaveURL('https://portal.homelab.local/');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
});
test('theme preference crosses domains and existing tabs without exposing auth',async({page,context})=>{
 await portalLogin(page);await page.locator('#blak-workspace-shell').getByRole('button',{name:'Blak Workspace',exact:true}).click();
 await page.locator('#blak-workspace-shell').getByRole('button',{name:'Use light theme'}).click();
 const other=await context.newPage();await other.goto('https://projects.homelab.local/');await expect(other.locator('html')).toHaveAttribute('data-theme','light');
 await other.locator('#blak-workspace-shell').getByRole('button',{name:'Blak Workspace',exact:true}).click();await other.locator('#blak-workspace-shell').getByRole('button',{name:'Use dark theme'}).click();
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 const cookie=(await context.cookies()).find(c=>c.name==='blak-theme');expect(cookie.value).toBe('dark');expect(cookie.secure).toBe(true);await other.close();
});
test('Hermes health is owner-private and renders useful enrolment and status states',async({page,context})=>{
 expect((await page.request.get('/api/sync-health')).status()).toBe(401);await portalLogin(page);
 const health=await (await page.request.get('/api/sync-health')).json();expect(health.enrolled).toBe(true);expect(health.sources).toHaveLength(9);expect(JSON.stringify(health)).not.toMatch(/token|api_secret|file_id|headers/);
 await page.goto('/sync');await expect(page.getByRole('heading',{name:'Hermes sync status',exact:true})).toBeVisible();
 const result=await new AxeBuilder({page}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(result.violations).toEqual([]);
 await context.addCookies([{name:'blak_session',value:session('polish-other-owner'),url:'https://portal.homelab.local'}]);
 const other=await (await page.request.get('/api/sync-health')).json();expect(other.enrolled).toBe(false);expect(other.sources).toEqual([]);
});
