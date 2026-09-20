/* Shared chrome: no auth tokens or document content are read or transmitted. */
(async () => {
  'use strict';
  if (document.getElementById('blak-workspace-shell')) return;
  const [apps, tokens] = await Promise.all(['apps','tokens'].map(name => fetch('/_blak/' + name + '.json').then(r => { if (!r.ok) throw Error('Workspace assets unavailable'); return r.json(); })));
  const app = location.hostname === 'docs.homelab.local' ? apps.find(a=>a.id==='docs') : apps.find(a => new URL(a.url).hostname === location.hostname);
  if (!app) return;
  const portalURL=apps.find(a=>a.id==='portal').url;
  const root = document.documentElement, cookieName = 'blak-theme';
  const cookieTheme = () => document.cookie.split('; ').find(s => s.startsWith(cookieName + '='))?.split('=')[1];
  let mode = cookieTheme();
  if (!['light','dark'].includes(mode)) { try { mode = localStorage.getItem(cookieName); } catch {} }
  if (!['light','dark'].includes(mode)) mode = 'dark';
  function apply(value, persist = false) {
    mode = value === 'light' ? 'light' : 'dark';
    if (root.dataset.theme !== mode) root.dataset.theme = mode;
    root.dataset.blakApp = app.id;
    root.classList.toggle('dark', mode === 'dark');
    root.style.colorScheme = mode;
    for (const [key,value] of Object.entries({...tokens.dark,...tokens[mode]})) root.style.setProperty('--blak-' + key,value);
    if(app.id==='chat') for(const [key,value] of Object.entries(tokens.chat[mode])) document.body.style.setProperty('--rcx-color-'+key,value,'important');
    if(app.id==='drive') {
      try {const value=JSON.stringify(mode==='dark');localStorage.setItem('oc_currentThemeIsDark',value);localStorage.setItem('oc_currentThemeName','Blak '+(mode==='dark'?'Dark':'Light'));window.dispatchEvent(new StorageEvent('storage',{key:'oc_currentThemeName',newValue:'Blak '+(mode==='dark'?'Dark':'Light'),storageArea:localStorage}));window.dispatchEvent(new StorageEvent('storage',{key:'oc_currentThemeIsDark',newValue:value,storageArea:localStorage}));} catch {}
      for(const [key,value] of Object.entries(tokens.drive[mode])) {const prop='--oc-role-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase());root.style.setProperty(prop,value);document.body.style.setProperty(prop,value);}
    }
    // These native preference keys are cosmetic only. Shared cookie is authoritative.
    try { localStorage.setItem(cookieName,mode); localStorage.setItem('theme',mode); localStorage.setItem('color-scheme',mode); } catch {}
    if (persist) document.cookie = `${cookieName}=${mode}; Domain=homelab.local; Path=/; Max-Age=31536000; Secure; SameSite=Lax`;
    if(app.id==='sites') {
      try {const settings=JSON.parse(localStorage.getItem('UI_STORE')||'{}');settings.theme=mode;const value=JSON.stringify(settings);localStorage.setItem('UI_STORE',value);window.dispatchEvent(new StorageEvent('storage',{key:'UI_STORE',newValue:value,storageArea:localStorage}));} catch {}
    }
    window.dispatchEvent(new CustomEvent('blak-theme-change',{detail:mode}));
    const toggle = document.querySelector('#blak-workspace-shell')?.shadowRoot?.querySelector('#theme');
    if (toggle) toggle.textContent = mode === 'dark' ? 'Use light theme' : 'Use dark theme';
  }
  apply(mode);
  window.addEventListener('focus',() => { const value=cookieTheme(); if (value && value!==mode) apply(value); });
  setInterval(() => { const value=cookieTheme(); if (value && value!==mode) apply(value); },1500);
  document.addEventListener('click',event => { if (event.target.closest?.('#themebtn')) { mode=root.dataset.theme; apply(mode,true); } });
  if (window.top !== window.self) return; // WOPI editor keeps parent navigation.
  const host = document.createElement('aside'); host.id='blak-workspace-shell'; host.setAttribute('aria-label','Blak Workspace');
  const shadow = host.attachShadow({mode:'open'});
  const style=document.createElement('style'); style.textContent=`:host{position:fixed;right:16px;bottom:16px;z-index:2147483000;font:14px/1.5 system-ui,sans-serif;color:var(--blak-text-primary)}*{box-sizing:border-box}button,a{font:inherit}button{cursor:pointer}button,a{border-radius:8px}button{border:1px solid var(--blak-border-strong);background:var(--blak-surface);color:inherit;padding:10px 14px;min-height:44px}button:hover,a:hover{background:var(--blak-surface-hover)}:focus-visible{outline:3px solid var(--blak-focus);outline-offset:3px}#open{font-weight:600;box-shadow:0 4px 16px #0003}#panel{width:min(320px,calc(100vw - 32px));max-height:calc(100dvh - 100px);overflow:auto;background:var(--blak-surface);border:1px solid var(--blak-border-strong);border-radius:12px;padding:16px;margin-bottom:8px;box-shadow:0 12px 40px #0004}#panel[hidden]{display:none}h2{font-size:16px;margin:0 0 12px}nav{display:grid;grid-template-columns:1fr 1fr;gap:4px}a{padding:10px;color:inherit;text-decoration:none;min-height:44px}a[aria-current]{background:var(--blak-surface-selected);font-weight:600}#theme{width:100%;margin-top:12px}.footer{font-size:12px;color:var(--blak-text-secondary);margin-top:12px}#home{display:block;border-bottom:1px solid var(--blak-border-subtle);margin-bottom:8px} @media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}`;
  shadow.append(style);
  const panel=document.createElement('section'); panel.id='panel'; panel.hidden=true; panel.setAttribute('aria-label','Workspace apps');
  const heading=document.createElement('h2'); heading.textContent='Blak Workspace'; panel.append(heading);
  const home=document.createElement('a');home.id='home';home.href=portalURL;home.textContent='Workspace home';panel.append(home);
  const nav=document.createElement('nav');nav.setAttribute('aria-label','Switch app');
  for(const item of apps.filter(a=>a.id!=='portal')) {const link=document.createElement('a');link.href=item.url;link.textContent=item.name;if(item.id===app.id)link.setAttribute('aria-current','page');nav.append(link);}
  panel.append(nav);
  const welcome=document.createElement('a');welcome.href=new URL('/welcome',portalURL).href;welcome.textContent='Getting started with Blak';welcome.style.display='block';panel.append(welcome);
  const health=document.createElement('a');health.href=new URL('/sync',portalURL).href;health.textContent='Hermes sync status';health.style.display='block';panel.append(health);
  const toggle=document.createElement('button');toggle.id='theme';toggle.type='button';toggle.addEventListener('click',()=>apply(mode==='dark'?'light':'dark',true));panel.append(toggle);
  const footer=document.createElement('div');footer.className='footer';footer.textContent=app.backend;panel.append(footer);
  const button=document.createElement('button');button.id='open';button.type='button';button.textContent='Blak Workspace';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','panel');
  const close=()=>{panel.hidden=true;button.setAttribute('aria-expanded','false');button.focus();};
  button.addEventListener('click',()=>{panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)home.focus();});
  shadow.addEventListener('click',e=>e.stopPropagation());
  shadow.addEventListener('keydown',e=>e.stopPropagation());
  // Native mobile apps may move focus to their editor after navigation. Escape
  // still closes an open workspace panel and restores its trigger focus.
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();e.stopImmediatePropagation();close();}},true);
  document.addEventListener('pointerdown',e=>{if(!panel.hidden&&!e.composedPath().includes(host)){panel.hidden=true;button.setAttribute('aria-expanded','false');}});
  shadow.append(panel,button);document.body.append(host);apply(mode);
  // Only known application chrome is changed; editable content is never rewritten.
  function brandChrome() {
    const title=app.name + (app.backend ? ' · ' + app.backend : '');
    if (document.title!==title) document.title=title;

  }
  if(app.id==='projects') {
    const brandLogo=()=>{for(const img of document.querySelectorAll('img[alt="Kaneo"]')) {img.src='/_blak/projects-logo.svg';img.alt='Blak Projects';}};
    brandLogo();new MutationObserver(brandLogo).observe(document.body,{childList:true,subtree:true});
  }
  brandChrome();
})().catch(() => { /* Upstream app remains usable if cosmetic assets fail. */ });
