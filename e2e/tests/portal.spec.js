'use strict';
const {test,expect,session}=require('../helpers/fixtures');
const {APPS}=require('../../apps/portal/catalog');
const {tokens}=require('../../apps/portal/theme');
const pages=['/','/welcome','/flow','/flow/new','/flow/activity','/search','/cloud','/draw','/sync'];
for(const route of ['/api/me','/api/modules','/api/status','/cloud/object?bucket=abc&key=a']) test(`anonymous API denied ${route}`,async({request})=>{
  expect((await request.get(route)).status()).toBe(401);
});
for(const route of ['/flow','/flow/new','/search','/cloud']) test(`anonymous page gated ${route}`,async({request})=>{
  const response=await request.get(route,{maxRedirects:0});expect(response.status()).toBe(302);expect(response.headers().location).toBe('/login');
});
for(const cookie of ['broken','a.b','a.b.c'])test(`bad cookie cannot crash portal ${cookie}`,async({request})=>{
  expect((await request.get('/api/me',{headers:{cookie:`blak_session=${cookie}`}})).status()).toBe(401);
  expect((await request.get('/api/health')).ok()).toBeTruthy();
});
test('callback refuses unbound and missing state',async({request})=>{
  expect((await request.get('/callback?code=fake&state=fake')).status()).toBe(400);
});
test('login sets expiring browser-bound state',async({request})=>{
  const response=await request.get('/login',{maxRedirects:0});
  expect(response.status()).toBe(302);expect(response.headers()['set-cookie']).toContain('blak_login=');
  expect(response.headers()['set-cookie']).toContain('HttpOnly');expect(response.headers()['set-cookie']).toContain('Max-Age=600');
});
for(const mode of ['dark','light'])for(const route of pages)test(`${mode} theme persists on ${route}`,async({signedIn:page})=>{
  await page.goto('/');
  if(mode==='light')await page.getByRole('button',{name:'Switch to light theme'}).click();
  await page.goto(route);await expect(page.locator('html')).toHaveAttribute('data-theme',mode);
  await page.evaluate(()=>document.fonts.load('400 16px Inter'));
  expect(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='Inter'&&f.status==='loaded'))).toBe(true);
  const colours=await page.locator('body').evaluate(el=>({surface:getComputedStyle(el).getPropertyValue('--surface').trim(),primary:getComputedStyle(el).getPropertyValue('--primary').trim()}));
  expect(colours.surface).toBe((tokens[mode].surface||tokens.dark.surface));expect(colours.primary).toBe(tokens.dark.primary);
  await expect(page.getByRole('button',{name:`Switch to ${mode==='dark'?'light':'dark'} theme`})).toBeVisible();
});
for(const width of [390,768,1440])test(`shell fits ${width}px`,async({signedIn:page})=>{
  await page.setViewportSize({width,height:900});
  for(const route of pages){await page.goto(route);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route).toBeTruthy();}
  await page.screenshot({path:test.info().outputPath(`shell-${width}.png`),fullPage:true});
});
test('catalog, launcher and live tiles agree',async({signedIn:page})=>{
  await page.goto('/');await page.getByRole('button',{name:'App launcher'}).click();
  await expect(page.getByRole('button',{name:'App launcher'})).toHaveAttribute('aria-expanded','true');
  const granted=(await (await page.request.get('/api/modules')).json()).modules.map(a=>a.id);
  for(const app of APPS.filter(a=>granted.includes(a.id))){const item=page.locator(`#drawer [data-app="${app.id}"]`);await expect(item).toContainText(app.name);if(app.url)await expect(item).toHaveAttribute('href','/launch/'+app.id);else await expect(item).not.toHaveAttribute('href');}
  await page.keyboard.press('Escape');await expect(page.locator('#drawer')).toBeHidden();
});
test('command palette search, empty state and keyboard navigation',async({signedIn:page})=>{
  await page.goto('/');await page.keyboard.press('Control+k');await page.locator('#pali').fill('no-such-application');await expect(page.locator('#palres')).toContainText('No matches');
  await page.locator('#pali').fill('Blak Flow');await page.locator('#pali').press('Enter');await expect(page).toHaveURL(/\/flow$/);
});
test('home filter and workspace search',async({signedIn:page})=>{
  await page.goto('/');await page.getByRole('searchbox',{name:'Search workspace'}).fill('Blak Flow');await expect(page.locator('#tiles .card:visible')).toHaveCount(1);
  await page.getByRole('searchbox',{name:'Search workspace'}).press('Enter');await expect(page).toHaveURL(/\/search\?q=Blak%20Flow/);
});
test('special characters in account name do not break scripts',async({page,context,baseURL,account})=>{
  const name="Ada O'Neil \\ <script>\nTest";
  await context.addCookies([{name:'blak_session',value:await session(account,name),url:baseURL}]);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('/');await expect(page.locator('#greet')).toContainText("Ada O'Neil");expect(errors).toEqual([]);
});
test('sign out clears session and preserves theme',async({signedIn:page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Switch to light theme'}).click();await page.locator('.userchip').getByRole('link',{name:'Sign out'}).click();
  await expect(page.getByRole('link',{name:'Sign in with Blak ID'})).toBeVisible();expect((await page.request.get('/api/me')).status()).toBe(401);await expect(page.locator('html')).toHaveAttribute('data-theme','light');
});
test('Drive theme adapter matches portal in both modes',async({request})=>{
  const response=await request.get('/blak-theme/theme.json');const theme=await response.json();
  expect(theme.clients.web.themes).toHaveLength(2);
  for(const t of theme.clients.web.themes){expect(t.designTokens.roles.primary).toBe(tokens.dark.primary);expect(t.designTokens.roles.background).toBe(t.isDark?tokens.dark.surface:tokens.light.surface);}
});
test('cross-origin writes rejected',async({signedIn:page})=>{
  expect((await page.request.post('/flow',{headers:{origin:'https://untrusted.example'},form:{name:'bad'}})).status()).toBe(403);
});

test('oversized form rejected without taking down portal',async({signedIn:page})=>{
  expect((await page.request.post('/flow',{data:'name='+ 'x'.repeat(70*1024),headers:{'content-type':'application/x-www-form-urlencoded'}})).status()).toBe(413);
  expect((await page.request.get('/api/health')).ok()).toBeTruthy();
});
