'use strict';

function rewriteConsoleDocument(html) {
  return html
    .replaceAll('/assets/', '/cloud/assets/')
    .replace('<title>Floci UI</title>', '<title>Blak Cloud</title>')
    .replace('Floci UI — Any Cloud. Locally. The local cloud console for Floci.', 'Blak Cloud. Private workspace cloud, powered by Floci.')
    .replace('<html lang="en">', '<html lang="en" data-blak-app="storage">')
    .replace('<div id="root"></div>', '<main id="root"></main>');
}

function rewriteConsoleScript(source) {
  return source.replaceAll('/api/clouds', '/cloud/api/clouds');
}

function consoleUpstreamPath(pathname) {
  if (pathname === '/cloud' || pathname === '/cloud/') return '/';
  if (pathname.startsWith('/cloud/assets/')) return pathname.slice('/cloud'.length);
  if (pathname.startsWith('/cloud/api/clouds')) return pathname.slice('/cloud'.length);
  return null;
}

module.exports = { rewriteConsoleDocument, rewriteConsoleScript, consoleUpstreamPath };
