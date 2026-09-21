'use strict';
// Native geometry stays crisp at every size; no embedded bitmap or font dependency.
function orbit(count, radius, dot, offset, colours) {
  return Array.from({length:count}, (_, i) => {
    const angle = (i / count * 360 + offset) * Math.PI / 180;
    return `<circle cx="${(112 + radius * Math.cos(angle)).toFixed(3)}" cy="${(112 + radius * Math.sin(angle)).toFixed(3)}" r="${dot}" fill="${colours[Math.floor(i * colours.length / count)]}"/>`;
  }).join('');
}
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 224 224" role="img" aria-label="Blak Workspace"><title>Blak Workspace</title><circle cx="112" cy="112" r="22" fill="#d69a40"/>${orbit(12,52,9,-90,['#d55a2a','#f4eee2','#d55a2a','#f4eee2'])}${orbit(20,94,7,-90,['#d55a2a','#d69a40','#f4eee2','#d55a2a'])}</svg>`;
module.exports = { LOGO_SVG };
