'use strict';
const { LOGO_SVG } = require('./brand');
const tokens = require('./theme-tokens.json');

const messages = {
  400: ['Let’s try that again', 'We couldn’t use that request. Check the details and try again.'],
  401: ['Please sign in', 'Sign in to your workspace to continue.'],
  403: ['You don’t have access yet', 'Ask your workspace administrator for access, or go Home to see your available apps.'],
  404: ['We couldn’t find that page', 'The link may have changed, or the page may no longer be available. Check the address or go Home to find what you need.'],
  405: ['That action isn’t available', 'Open the page again and use its buttons or links to continue.'],
  409: ['Something has changed', 'Reload the page to see the latest changes before trying again.'],
  413: ['That upload is too large', 'Choose a smaller file or send less content, then try again.'],
  421: ['We couldn’t find that workspace', 'Check the address, or go Home to open your workspace.'],
  429: ['Please wait a moment', 'There have been too many requests. Wait a minute, then try again.'],
  500: ['Something went wrong', 'We couldn’t complete your request. Try again shortly. If this keeps happening, contact your workspace administrator.'],
  502: ['We couldn’t reach this app', 'The app is temporarily unavailable. Try again shortly, or go Home to open another app.'],
  503: ['This app isn’t ready right now', 'Try again shortly. If this keeps happening, contact your workspace administrator.'],
  504: ['This is taking longer than expected', 'The app didn’t respond in time. Check whether your last action completed before trying again.'],
};

// Fetch metadata takes precedence: an API fetch accepting HTML is still a fetch.
function isBrowserNavigation(req) {
  const headers = req.headers || {};
  const dest = headers['sec-fetch-dest'];
  if (dest) return ['document', 'iframe', 'frame'].includes(dest);
  if (headers['sec-fetch-mode']) return headers['sec-fetch-mode'] === 'navigate';
  return /(?:^|,)\s*text\/html(?:\s*;[^,]*)?(?:,|$)/i.test(headers.accept || '')
    && !/text\/html\s*;\s*q=0(?:\.0*)?(?:\s*(?:,|$))/i.test(headers.accept || '');
}
function escape(value) {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function errorPage(status, { title, message, home = '/', signIn = '/login', retryLogin = false } = {}) {
  const defaults = messages[status] || messages[500];
  const palette = mode => Object.entries(tokens[mode]).map(([key, value]) => `--${key}:${value}`).join(';');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escape(title || defaults[0])} · Blak Workspace</title>
<style>:root{color-scheme:dark;${palette('dark')}}@media(prefers-color-scheme:light){:root{color-scheme:light;${palette('light')}}}*{box-sizing:border-box}body{margin:0;background:var(--surface-base);color:var(--text-primary);font:1rem/1.65 Inter,system-ui,sans-serif}main{max-width:44rem;margin:0 auto;padding:clamp(2rem,8vw,6rem) 1.5rem}.brand{display:flex;align-items:center;gap:.8rem;color:var(--text-primary);font-weight:650;text-decoration:none}.brand svg{width:2.75rem;height:2.75rem}.code{margin:3.5rem 0 .75rem;color:var(--text-secondary);font-size:.85rem;letter-spacing:.12em}h1{font-size:clamp(2rem,6vw,3rem);line-height:1.15;letter-spacing:-.025em;margin:0 0 1.25rem}p{max-width:36rem;color:var(--text-secondary)}nav{display:flex;flex-wrap:wrap;gap:1rem;margin-top:2rem}nav a{display:inline-block;padding:.75rem 1.25rem;border:1px solid var(--border);border-radius:.6rem;color:var(--text-primary);text-decoration:none;font-weight:650}nav a:first-child{background:var(--primary);color:var(--on-primary);border-color:var(--primary)}a:focus-visible{outline:3px solid var(--focus);outline-offset:5px}a:hover{text-decoration:underline}.help{margin-top:3rem;font-size:.9rem}</style></head>
<body><main><a class="brand" href="${escape(home)}"><span aria-hidden="true">${LOGO_SVG}</span>Blak Workspace</a><p class="code">${Number(status)} · BLAK WORKSPACE</p><h1>${escape(title || defaults[0])}</h1><p>${escape(message || defaults[1])}</p><nav aria-label="Next steps">${status === 401 || retryLogin ? `<a href="${escape(signIn)}">Sign in again</a>` : ''}<a href="${escape(home)}">Go Home</a></nav><p class="help">Your work. Your workspace.</p></main></body></html>`;
}
// Only pass application-authored copy here, never an upstream error.message.
function sendError(req, res, status, options = {}) {
  status = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  const html = isBrowserNavigation(req);
  const body = html ? errorPage(status, options) : JSON.stringify({ error: options.message || (messages[status] || messages[500])[1] });
  const vary = [res.getHeader?.('vary'), 'Accept', 'Sec-Fetch-Dest', 'Sec-Fetch-Mode'].filter(Boolean).join(', ');
  res.writeHead(status, { 'content-type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-blak-error-page': '1', vary });
  res.end(req.method === 'HEAD' ? undefined : body);
}
module.exports = { errorPage, isBrowserNavigation, sendError, messages };
