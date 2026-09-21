'use strict';
const fs = require('node:fs');
const path = require('node:path');
// The supplied brand artwork is embedded so every app can render this SVG
// without font dependencies, external image requests, or cross-origin failures.
const artwork = fs.readFileSync(path.join(__dirname, 'brand-home-logo.jpg')).toString('base64');
function svg(viewBox, title) {
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${viewBox}" role="img" aria-label="${title}"><title>${title}</title><image width="1200" height="630" xlink:href="data:image/jpeg;base64,${artwork}"/></svg>`;
}
const LOGO_SVG = svg('410 0 385 370', 'Blak Workspace');
module.exports = { LOGO_SVG };
