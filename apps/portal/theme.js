'use strict';
const fs = require('node:fs');
const path = require('node:path');
const tokens = require('./theme-tokens.json');
const declarations = (values) => Object.entries(values).map(([key, value]) => `--${key}:${value};`).join('');
const tokenCSS = `:root{color-scheme:dark;${declarations(tokens.dark)}}[data-theme="light"]{color-scheme:light;${declarations(tokens.light)}}`;
const CSS = fs.readFileSync(path.join(__dirname,'fonts.css'),'utf8') + tokenCSS + fs.readFileSync(path.join(__dirname, 'styles.css'), 'utf8');
const themeScript = `(()=>{
const key='blak-theme',root=document.documentElement;
function apply(theme){root.dataset.theme=theme==='light'?'light':'dark';const button=document.getElementById('themebtn');if(button){const light=root.dataset.theme==='light';button.setAttribute('aria-label','Switch to '+(light?'dark':'light')+' theme');button.textContent=light?'☾':'☀';}}
try{apply(localStorage.getItem(key));}catch{apply('dark');}
document.addEventListener('DOMContentLoaded',()=>{apply(root.dataset.theme);const button=document.getElementById('themebtn');if(button)button.onclick=()=>{apply(root.dataset.theme==='light'?'dark':'light');try{localStorage.setItem(key,root.dataset.theme);}catch{}};});
window.addEventListener('storage',event=>{if(event.key===key)apply(event.newValue);});
})();`;
function driveRoles(mode) {
  const t = { ...tokens.dark, ...(mode === 'light' ? tokens.light : {}) };
  return {
    primary:t.primary,onPrimary:t['on-primary'],primaryContainer:t['earth-700'],onPrimaryContainer:tokens.dark['text-primary'],
    secondary:t.secondary,onSecondary:t['sand-50'],secondaryContainer:t['water-700'],onSecondaryContainer:tokens.dark['text-primary'],
    tertiary:t.warning,onTertiary:t['blak-950'],tertiaryContainer:t['ochre-600'],onTertiaryContainer:t['blak-950'],
    error:t.danger,onError:t['blak-950'],errorContainer:t['earth-700'],onErrorContainer:tokens.dark['text-primary'],
    background:t.surface,onBackground:t['text-primary'],surface:t['surface-raised'],onSurface:t['text-primary'],
    surfaceVariant:t['surface-hover'],onSurfaceVariant:t['text-secondary'],outline:t['border-strong'],outlineVariant:t['border-subtle'],
    shadow:'#000000',scrim:'#000000',inverseSurface:t['text-primary'],inverseOnSurface:t.surface,inversePrimary:t.primary,
    primaryFixed:t['ochre-400'],onPrimaryFixed:t['blak-950'],surfaceDim:t['surface-base'],surfaceBright:t['surface-hover'],
    surfaceContainerLowest:t['surface-base'],surfaceContainerLow:t.surface,surfaceContainer:t['surface-raised'],surfaceContainerHigh:t['surface-hover'],surfaceContainerHighest:t['surface-selected'],
    chrome:t['surface-base'],onChrome:t['text-primary'],
  };
}
function blakTheme(logo = 'themes/blak/assets/logo.svg') {
  const slogan = 'Your work. Your workspace.';
  return { common:{name:'Blak Drive',slogan,logo},clients:{web:{defaults:{logo,favicon:logo,slogan,background:''},themes:['dark','light'].map(mode=>({isDark:mode==='dark',label:`Blak ${mode === 'dark' ? 'Dark' : 'Light'}`,designTokens:{roles:driveRoles(mode)}}))}}};
}
module.exports = { CSS, tokenCSS, tokens, themeScript, blakTheme };
