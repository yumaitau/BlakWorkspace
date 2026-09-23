'use strict';

// One source of plain-language access explanations. The portal pages and the
// Blak ID group descriptions (scripts/deploy/ak-workspace-contract.py) both
// read this file. Derived from docs/identity/app-role-contract.md.
const { INTEGRATIONS } = require('./integration');

const ROLES = Object.freeze(['reader', 'writer', 'admin']);
const ROLE_LABEL = Object.freeze({ reader: 'Reader', writer: 'Writer', admin: 'Admin' });

// How quickly a change reaches each kind of app. Keep these honest: they are
// the measured reconcile intervals, not a promise of instant change.
const TIMING = Object.freeze({
  native: 'Blak ID updates the app within about a minute. The person may need to sign in to the app again.',
  portal: 'Takes effect within 30 seconds. Blak Home re-checks roles on the next page load.',
  directory: 'Takes effect after an operator runs the directory sync. Until then the app keeps the old role.',
});

const APP_ACCESS = {
  vault: {
    name: 'Blak Vault', timing: 'native',
    purpose: 'Shared passwords, keys and sensitive notes for your team.',
    note: 'The vault master password is separate from Blak ID. Each person sets it the first time they open Vault.',
    roles: {
      reader: { summary: 'see and copy shared passwords in Blak Vault', can: ['See and copy passwords and notes in the shared team collection', 'Keep your own private vault items'], cannot: ['Add, change or delete shared items', 'Manage who can use the vault'] },
      writer: { summary: 'add and edit shared passwords in Blak Vault', can: ['Everything a Reader can do', 'Add and edit shared passwords, keys and notes'], cannot: ['Manage vault members or settings', "See anyone else's private vault items"] },
      admin: { summary: 'manage the shared team vault and its members in Blak Vault', can: ['Everything a Writer can do', "Manage the team's collections and who can use them inside Vault"], cannot: ['Run or reconfigure the Vault server', "See anyone else's private vault items", 'Change Blak ID roles'] },
    },
  },
  drive: {
    name: 'Blak Drive', timing: 'native',
    purpose: 'Store, share and organise files.',
    roles: {
      reader: { summary: 'open and download files in Blak Drive', can: ['Open, preview and download files in shared team spaces', 'Open documents read-only in Blak Docs'], cannot: ['Upload, edit, rename or delete files in shared spaces', 'Save changes in Blak Docs'] },
      writer: { summary: 'add and edit files in Blak Drive', can: ['Everything a Reader can do', 'Upload, edit, move and delete files in shared spaces', 'Edit and save documents in Blak Docs'], cannot: ['Manage space members or space settings'] },
      admin: { summary: 'manage shared spaces and their members in Blak Drive', can: ['Everything a Writer can do', 'Manage shared spaces, their members and settings', 'Put back files that were held because they looked unsafe'], cannot: ["Open other people's personal files", 'Change Blak ID roles'] },
    },
  },
  docs: {
    name: 'Blak Docs', timing: 'native', sharedWith: 'drive',
    purpose: 'Edit documents, spreadsheets and presentations opened from Blak Drive. Uses the same role as Blak Drive.',
    roles: {
      reader: { summary: 'open documents read-only in Blak Docs', can: ['Open documents, spreadsheets and presentations read-only'], cannot: ['Save changes to a shared file'] },
      writer: { summary: 'edit and save documents in Blak Docs', can: ['Edit and save documents in shared spaces'], cannot: ['Change who can open a space'] },
      admin: { summary: 'edit documents and manage shared spaces through Blak Docs', can: ['Everything a Writer can do', 'Manage the Drive spaces the documents live in'], cannot: ["Open other people's personal files"] },
    },
  },
  chat: {
    name: 'Blak Chat', timing: 'native',
    purpose: 'Team messaging in channels and direct messages.',
    roles: {
      reader: { summary: 'read their rooms in Blak Chat', can: ['Read the rooms you are a member of', 'Change your own notification settings'], cannot: ['Send messages or upload files', 'Create rooms'] },
      writer: { summary: 'send messages and create rooms in Blak Chat', can: ['Everything a Reader can do', 'Send messages and files', 'Create rooms and direct messages'], cannot: ["Manage other people's rooms or members", 'Change server settings'] },
      admin: { summary: 'manage rooms and their members in Blak Chat', can: ['Everything a Writer can do', 'Manage rooms and their members', 'Moderate messages'], cannot: ['Change server settings, sign-in or Blak ID roles'] },
    },
  },
  sites: {
    name: 'Blak Knowledge', timing: 'native',
    purpose: 'Intranet sites and shared team knowledge.',
    roles: {
      reader: { summary: 'read pages in Blak Knowledge', can: ['Read the pages you have access to', 'Export, bookmark and follow pages'], cannot: ['Edit, delete, share or comment on pages'] },
      writer: { summary: 'write and edit pages in Blak Knowledge', can: ['Everything a Reader can do', 'Create, edit and comment on pages', 'Share pages'], cannot: ['Change Knowledge settings'] },
      admin: { summary: 'manage sites and settings in Blak Knowledge', can: ['Everything a Writer can do', 'Manage sites, collections and settings'], cannot: ["Read other people's private collections", 'Change who is a member (that stays in Blak ID)'] },
    },
  },
  projects: {
    name: 'Blak Projects', timing: 'native',
    purpose: 'Projects, tasks and boards.',
    roles: {
      reader: { summary: 'view projects and tasks in Blak Projects', can: ['View projects, boards and tasks'], cannot: ['Create, edit or delete projects or tasks'] },
      writer: { summary: 'create and edit projects and tasks in Blak Projects', can: ['Everything a Reader can do', 'Create, edit and delete projects and tasks', 'Assign tasks'], cannot: ['Manage workspace members or settings'] },
      admin: { summary: 'manage the team workspace in Blak Projects', can: ['Everything a Writer can do', 'Manage the team workspace and its settings'], cannot: ['Promote people or change roles (that stays in Blak ID)'] },
    },
  },
  crm: {
    name: 'Blak CRM', timing: 'native',
    purpose: 'Leads, contacts, organisations and deals.',
    roles: {
      reader: { summary: 'view and export records in Blak CRM', can: ['View, print, export and report on CRM records'], cannot: ['Create or change records', 'Upload files'] },
      writer: { summary: 'create and update records in Blak CRM', can: ['Everything a Reader can do', 'Create and update leads, contacts, organisations and deals'], cannot: ['Manage CRM settings', "Change other people's permissions"] },
      admin: { summary: 'manage CRM records and settings in Blak CRM', can: ['Everything a Writer can do', "Manage the team's CRM records and CRM settings"], cannot: ['Administer the whole server', 'Change Blak ID roles'] },
    },
  },
  forms: {
    name: 'Blak Forms', timing: 'native',
    purpose: 'Forms and surveys.',
    roles: {
      reader: { summary: 'see forms and responses in Blak Forms', can: ['See forms and their responses'], cannot: ['Create, edit or publish forms', 'Upload files'] },
      writer: { summary: 'create and publish forms in Blak Forms', can: ['Everything a Reader can do', 'Create, edit and publish forms'], cannot: ['Manage workspace members or integrations'] },
      admin: { summary: 'manage the Forms workspace, members and integrations', can: ['Everything a Writer can do', 'Manage workspace members and integrations'], cannot: ['Change sign-in or Blak ID roles'] },
    },
  },
  hermes: {
    name: 'Blak Hermes', timing: 'native',
    purpose: 'Local AI assistant that answers from content you can already see.',
    roles: {
      reader: { summary: 'chat with Blak Hermes and use shared team knowledge', can: ['Chat with the assistant', 'Use shared team knowledge'], cannot: ['Add or edit shared knowledge'] },
      writer: { summary: 'add and edit shared knowledge in Blak Hermes', can: ['Everything a Reader can do', 'Create and edit shared knowledge'], cannot: ['Change who can see a knowledge collection you do not own'] },
      admin: { summary: 'manage shared knowledge in Blak Hermes', can: ['Everything a Writer can do', 'Manage knowledge shared with the team'], cannot: ["See other people's private knowledge or files", 'Change server settings'] },
    },
  },
  draw: {
    name: 'Blak Draw', timing: 'portal',
    purpose: 'Private diagrams and drawings.',
    roles: {
      reader: { summary: 'open their drawings in view mode in Blak Draw', can: ['Open your drawings in view mode'], cannot: ['Create, save or delete drawings'] },
      writer: { summary: 'create and edit drawings in Blak Draw', can: ['Everything a Reader can do', 'Create, edit and delete your drawings'], cannot: ["Open anyone else's drawings"] },
      admin: { summary: 'create and edit drawings in Blak Draw', can: ['Everything a Writer can do (Draw has no extra admin controls yet)'], cannot: ["Open anyone else's drawings"] },
    },
  },
  flow: {
    name: 'Blak Flow', timing: 'portal',
    purpose: 'Automations that move work between apps.',
    roles: {
      reader: { summary: 'see their flows and run history in Blak Flow', can: ['See your flows and their run history'], cannot: ['Create, run, turn on or delete flows'] },
      writer: { summary: 'build and run flows in Blak Flow', can: ['Everything a Reader can do', 'Create, run, turn on and off, and delete your flows'], cannot: ["See other people's flows"] },
      admin: { summary: 'build and run flows in Blak Flow', can: ['Everything a Writer can do (Flow has no extra admin controls yet)'], cannot: ["See other people's flows"] },
    },
  },
  storage: {
    name: 'Blak Cloud', timing: 'portal',
    purpose: 'Private cloud console for storage buckets and message queues.',
    roles: {
      reader: { summary: 'browse and download from Blak Cloud', can: ['Browse buckets and download objects'], cannot: ['Create buckets or queues', 'Upload or delete objects', 'Send queue messages'] },
      writer: { summary: 'create buckets, upload and send messages in Blak Cloud', can: ['Everything a Reader can do', 'Create buckets and queues', 'Upload and delete objects', 'Send queue messages'], cannot: ['Change who can use Blak Cloud'] },
      admin: { summary: 'create buckets, upload and send messages in Blak Cloud', can: ['Everything a Writer can do (Cloud has no extra admin controls yet)'], cannot: ['Change who can use Blak Cloud'] },
    },
  },
  search: {
    name: 'Blak Search', timing: 'portal',
    purpose: 'Search across content you can already open in other apps.',
    roles: {
      reader: { summary: 'search content they can already open, in Blak Search', can: ['Search content you can already open in other apps'], cannot: ['See results from apps where you have no role'] },
      writer: { summary: 'search content they can already open, in Blak Search', can: ['The same as Reader'], cannot: ['See more results: a higher Search role never widens what you can find'] },
      admin: { summary: 'search content they can already open, in Blak Search', can: ['The same as Reader (admin settings may come later)'], cannot: ['See results you could not open yourself'] },
    },
  },
  smith: {
    name: 'BlakSmith', timing: 'directory',
    purpose: 'Knowledge graph for Country, title and heritage.',
    roles: {
      reader: { summary: 'view records in BlakSmith', can: ['View records you have access to'], cannot: ['Add or change records'] },
      writer: { summary: 'add and edit records in BlakSmith', can: ['Everything a Reader can do', 'Add and edit records'], cannot: ['Manage BlakSmith settings'] },
      admin: { summary: 'manage records and settings in BlakSmith', can: ['Everything a Writer can do', 'Manage BlakSmith settings'], cannot: ['Change Blak ID roles'] },
    },
  },
  eyes: {
    name: 'BlakEyes', timing: 'directory',
    purpose: 'Drone imagery for land and sea management on Country.',
    roles: {
      reader: { summary: 'view imagery and maps in BlakEyes', can: ['View imagery and map layers'], cannot: ['Upload or change imagery'] },
      writer: { summary: 'upload and edit imagery in BlakEyes', can: ['Everything a Reader can do', 'Upload and edit imagery and layers'], cannot: ['Manage BlakEyes settings'] },
      admin: { summary: 'manage imagery and settings in BlakEyes', can: ['Everything a Writer can do', 'Manage BlakEyes settings'], cannot: ['Change Blak ID roles'] },
    },
  },
};

// Group-type taxonomy shown as badges in the portal and written to Blak ID.
const GROUP_TYPES = Object.freeze({
  role: { label: 'App role group', description: 'Gives its members one role in one app. Manage it from People & access in Blak Home.' },
  admins: { label: 'Workspace administrators', description: 'Members are Blak ID administrators. They are Admin in every app and manage people and access. Change this group only in Blak ID.' },
  team: { label: 'Team group', description: 'A group of people, such as a team or a site. Give it an app role and every member gets that role.' },
  retired: { label: 'Retired: no effect', description: 'Old app access group. It no longer grants anything and is kept so history is not lost. Use the app role groups instead.' },
});

// Role sets: apps that share role groups are managed together (Drive and Docs).
function roleSets(integrations = INTEGRATIONS) {
  const sets = new Map();
  for (const [app, value] of Object.entries(integrations)) {
    if (!value.roleGroups?.length) continue;
    const key = value.roleGroups.join('|');
    if (!sets.has(key)) sets.set(key, { id: app, apps: [], groups: Object.fromEntries(ROLES.map(role => [role, value.roleGroups.find(name => name.endsWith('-' + role))])), legacy: new Set() });
    sets.get(key).apps.push(app);
    if (value.group) sets.get(key).legacy.add(value.group);
  }
  return [...sets.values()].map(set => ({ ...set, legacy: [...set.legacy] }));
}

function appName(app) { return APP_ACCESS[app]?.name || app; }
function setName(set) { return set.apps.map(appName).join(' and '); }

// Descriptions written onto the Blak ID groups themselves by provisioning.
function groupNotes(integrations = INTEGRATIONS) {
  const notes = {};
  for (const set of roleSets(integrations)) {
    for (const role of ROLES) {
      const explain = APP_ACCESS[set.id]?.roles[role];
      notes[set.groups[role]] = {
        blak_type: 'role', blak_apps: set.apps, blak_role: role,
        description: `${ROLE_LABEL[role]} in ${setName(set)}. Members can ${explain ? explain.summary : 'use ' + setName(set)}. ${GROUP_TYPES.role.description}`,
      };
    }
    for (const legacy of set.legacy) {
      notes[legacy] = { blak_type: 'retired', blak_retired: true, description: `${GROUP_TYPES.retired.label}. ${GROUP_TYPES.retired.description} Access to ${setName(set)} now comes from ${ROLES.map(role => set.groups[role]).join(', ')}.` };
    }
  }
  return notes;
}

module.exports = { ROLES, ROLE_LABEL, TIMING, APP_ACCESS, GROUP_TYPES, roleSets, appName, setName, groupNotes };
