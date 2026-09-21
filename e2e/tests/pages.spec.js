'use strict';
const {test,expect}=require('@playwright/test');
const {authentikLogin}=require('../helpers/auth');
const AxeBuilder=require('@axe-core/playwright').default;

test('Blak ID renders a working vector logo, branded heading and local font',async({page})=>{
  await page.goto('https://portal.workspace.example.com/login');
  await expect(page.getByRole('textbox',{name:/email or username/i})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Welcome to Blak ID'})).toBeVisible();
  const logo=page.locator('img').first();
  await expect.poll(()=>logo.evaluate(i=>i.complete&&i.naturalWidth>0)).toBe(true);
  await expect(logo).toHaveAttribute('src',/\/_blak\/logo\.svg$/);
  expect((await logo.boundingBox()).width).toBeLessThanOrEqual(120);
  await expect(page.getByRole('button',{name:/log in/i})).toBeInViewport();
  await page.evaluate(()=>document.fonts.load('600 20px Inter'));
  expect(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='Inter'&&f.status==='loaded'))).toBe(true);
  await expect(page.getByRole('heading',{name:'Welcome to Blak ID'})).toHaveCSS('font-family',/Inter/);
  await page.screenshot({path:test.info().outputPath('blak-id-desktop.png'),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(page.getByRole('button',{name:/log in/i})).toBeInViewport();
  await page.screenshot({path:test.info().outputPath('blak-id-mobile.png'),fullPage:true});
});

const areas={
  crm:['Dashboard','Leads','Deals','Contacts','Organizations','Notes','Tasks','Call Logs'],
  sites:['Home','Drafts','Archive','Trash'],
  drive:['Personal','Favorites','Shares','Spaces','Deleted files'],
  forms:['Dashboard','Members','Workspace Settings'],
};
for(const [app,sections] of Object.entries(areas)) test(`${app}: every main page has usable branded chrome`,async({page})=>{
  test.setTimeout(180000);
  await page.goto('https://portal.workspace.example.com/login');await authentikLogin(page);
  await expect(page).toHaveURL('https://portal.workspace.example.com/');
  await page.goto('https://portal.workspace.example.com/launch/'+app);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const section of sections) {
    await page.getByRole('link',{name:section,exact:true}).first().click();
    await expect(page.locator('#blak-workspace-shell')).toBeVisible();
    await page.evaluate(()=>document.fonts.load('400 16px Inter'));
    expect(await page.evaluate(()=>[...document.fonts].some(f=>f.family==='Inter'&&f.status==='loaded'))).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),section).toBe(true);
    expect(await page.locator('img').evaluateAll(images=>images.filter(i=>i.getBoundingClientRect().width>0&&i.complete&&!i.naturalWidth).map(i=>i.alt)),section).toEqual([]);
    await expect(page).toHaveTitle(/Blak/);
    await page.screenshot({path:test.info().outputPath(app+'-'+section.toLowerCase().replaceAll(' ','-')+'.png'),fullPage:true});
  }
  expect(errors).toEqual([]);
});

test('portal guide, search, cloud and status pages have labelled controls',async({page})=>{
  await page.goto('https://portal.workspace.example.com/login');await authentikLogin(page);
  await expect(page).toHaveURL('https://portal.workspace.example.com/');
  for(const path of ['/welcome','/search','/cloud','/sync']) {
    await page.goto('https://portal.workspace.example.com'+path);
    const result=await new AxeBuilder({page}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(result.violations,path).toEqual([]);
  }
});
