'use strict';
// Native geometry stays crisp at every size; no embedded bitmap or font dependency.
function orbit(count, radius, dot, offset, colours) {
  return Array.from({length:count}, (_, i) => {
    const angle = (i / count * 360 + offset) * Math.PI / 180;
    return `<circle cx="${(112 + radius * Math.cos(angle)).toFixed(3)}" cy="${(112 + radius * Math.sin(angle)).toFixed(3)}" r="${dot}" fill="${colours[Math.floor(i * colours.length / count)]}"/>`;
  }).join('');
}
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 224 224" role="img" aria-label="Blak Workspace"><title>Blak Workspace</title><circle cx="112" cy="112" r="22" fill="#d69a40"/>${orbit(12,52,9,-90,['#d55a2a','#f4eee2','#d55a2a','#f4eee2'])}${orbit(20,94,7,-90,['#d55a2a','#d69a40','#f4eee2','#d55a2a'])}</svg>`;
// Distinct app symbols share one vector grid, stroke and palette.
const paths={
  vault:'M5 4h22v24H5z M9 4v24 M18 10a6 6 0 1 0 0 12 6 6 0 0 0 0-12 M18 13v6 M15 16h6',
  forms:'M8 5h16v22H8z M12 11h8 M12 16h8 M12 21h5',
  draw:'m8 23 2-7L22 4l6 6-12 12-8 1z M19 7l6 6 M10 16l6 6',
  crm:'M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10 M3 27v-4a9 9 0 0 1 18 0v4 M23 8a4 4 0 0 1 0 8 M25 20a6 6 0 0 1 4 6',
  drive:'M3 9h10l3 4h13v14H3z M3 9V5h10l3 4h11v4',
  docs:'M7 3h12l7 7v19H7z M19 3v8h7 M11 17h11 M11 22h8',
  chat:'M4 5h24v17H13l-7 6v-6H4z M10 12h12 M10 17h8',
  sites:'M16 8C12 4 6 4 3 6v21c5-2 9-1 13 2 4-3 8-4 13-2V6c-3-2-9-2-13 2z M16 8v21',
  projects:'M4 5h24v22H4z M4 11h24 M12 11v16 M21 11v16 M7 16h2 M15 16h3 M24 16h1',
  idp:'M20 3a9 9 0 1 1-6 16L5 28H2v-6l9-9a9 9 0 0 1 9-10z M22 9h.01',
  flow:'M5 5h8v8H5z M20 20h8v8h-8z M13 9h11v11 M9 13v11h11',
  hermes:'m16 3 4 9 9 4-9 4-4 9-4-9-9-4 9-4z',
  search:'M14 3a11 11 0 1 0 0 22 11 11 0 0 0 0-22 M22 22l8 8',
  storage:'M8 25a7 7 0 0 1-1-14 10 10 0 0 1 19 1 7 7 0 0 1-1 13H8 M16 12v11 M11 18l5-6 5 6',
  smith:'M6 8a4 4 0 1 0 .1 0 M26 8a4 4 0 1 0 .1 0 M16 20a4 4 0 1 0 .1 0 M10 12h12 M22 15l-3 5 M10 15l3 5',
  eyes:'M2 16s5-8 14-8 14 8 14 8-5 8-14 8S2 16 2 16 M16 12a4 4 0 1 0 .1 0',
};
const APP_ICONS=Object.fromEntries(Object.entries(paths).map(([id,d])=>[id,`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="#152022"/><path transform="translate(8 8)" d="${d}" fill="none" stroke="#f4eee2" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="39" cy="39" r="3" fill="#d65b2e"/></svg>`]));
module.exports = { LOGO_SVG, APP_ICONS };
