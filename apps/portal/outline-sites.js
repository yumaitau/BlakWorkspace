'use strict';

// Outline has document templates and collections, and no published intranet pack.
// A collection is the site. These pages are the starter a new site is filled with.
const TEMPLATES = [
  {
    title: 'Home',
    text: `# Home\n\nWelcome to this site. Replace this line with what the team is here to do.\n\n## What's new\n\n- \n\n## Start here\n\n- News\n- How we work\n- People\n- Policies\n`,
  },
  {
    title: 'News',
    text: `# News\n\nNewest update first. One heading per announcement.\n\n## \n\nDate:\n\nWho needs to know:\n\nWhat changed:\n`,
  },
  {
    title: 'How we work',
    text: `# How we work\n\n## Hours and leave\n\n## Decisions\n\nWhere a decision is written down, and who can make it.\n\n## Tools\n\nBlak Drive holds files. Blak Chat is for messages. This site holds the pages the whole team keeps.\n`,
  },
  {
    title: 'People',
    text: `# People\n\n| Name | Role | How to reach them |\n| --- | --- | --- |\n|  |  |  |\n`,
  },
  {
    title: 'Policies',
    text: `# Policies\n\nAdd one page under this one for each policy.\n\n## Current policies\n\n- \n`,
  },
];

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function collectionHref(collection, publicUrl) {
  const url = collection && collection.url;
  if (typeof url === 'string' && /^https?:\/\//.test(url)) return url;
  const path = typeof url === 'string' && url.startsWith('/') ? url : '';
  const base = String(publicUrl || '').replace(/\/$/, '');
  return path && base ? base + path : path || base || '#';
}

function createClient({ url, token, publicUrl, fetch: fetchImpl = globalThis.fetch } = {}) {
  const base = String(url || '').replace(/\/$/, '');
  async function call(method, body) {
    if (!base || !token) fail(503, 'Blak Knowledge is not connected for site creation');
    const response = await fetchImpl(base + '/api/' + method, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body || {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) {
      fail(response.status || 502, (payload && (payload.message || payload.error)) || 'Outline request failed');
    }
    return payload.data;
  }
  return {
    enabled: Boolean(base && token),
    publicUrl,
    async listCollections() {
      if (!base || !token) return [];
      const data = await call('collections.list', {});
      return Array.isArray(data) ? data : [];
    },
    async createSite(name, description) {
      const clean = String(name || '').trim();
      if (clean.length < 2 || clean.length > 80) fail(400, 'Site name must be 2-80 characters');
      const collection = await call('collections.create', {
        name: clean,
        description: String(description || '').trim().slice(0, 280),
        permission: 'read_write',
      });
      const pages = [];
      for (const template of TEMPLATES) {
        pages.push(await call('documents.create', {
          title: template.title,
          text: template.text,
          collectionId: collection.id,
          publish: true,
        }));
      }
      return { collection, pages, href: collectionHref(collection, publicUrl) };
    },
  };
}

function homeFragment(collections, publicUrl) {
  const sites = (collections || []).map((collection) => `<a class=card href="${esc(collectionHref(collection, publicUrl))}"><h3>${esc(collection.name)}</h3><p>${esc(collection.description || 'Intranet site in Blak Knowledge')}</p></a>`).join('');
  const feed = sites
    ? `<div class=grid data-testid="intranet-sites">${sites}</div>`
    : `<div class=empty data-testid="org-activity-empty"><p><b>No intranet sites yet.</b></p><p>Create one and Blak Knowledge opens it with Home, News, How we work, People and Policies.</p></div>`;
  return `<h3 class=sec>Intranet</h3>
<p class=gsub>Sites live in Blak Knowledge. Each site is an Outline collection filled from the intranet templates.</p>
${feed}
<p><a class=btn href="/intranet">Create an intranet site</a></p>`;
}

function pageHtml(collections, publicUrl, message) {
  const sites = (collections || []).map((collection) => `<li><a href="${esc(collectionHref(collection, publicUrl))}">${esc(collection.name)}</a></li>`).join('');
  const templateList = TEMPLATES.map((template) => `<li>${esc(template.title)}</li>`).join('');
  return `<div class=intranet><div class=greet>Intranet</div>
<p class=gsub>A new site is a Blak Knowledge collection. Outline has no separate intranet pack, so the product fills the site with these templates: Home, News, How we work, People and Policies. Sign-in stays Blak ID.</p>
${message ? `<p role=alert>${esc(message)}</p>` : ''}
<form method=post action=/intranet/sites data-testid="create-site">
<label>Site name <input name=name required maxlength=80 placeholder="People and culture"></label>
<label>Description <input name=description maxlength=280 placeholder="What this site is for"></label>
<button class=btn type=submit>Create site</button>
</form>
<h3 class=sec>Templates in every new site</h3>
<ul>${templateList}</ul>
${sites ? `<h3 class=sec>Sites</h3><ul>${sites}</ul>` : ''}</div>`;
}

module.exports = { TEMPLATES, createClient, homeFragment, pageHtml, collectionHref, esc };
