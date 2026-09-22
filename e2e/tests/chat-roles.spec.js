'use strict';
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { test, expect } = require('@playwright/test');
const { identityCookies, updateIdentity } = require('../helpers/identity');
const { serviceURL } = require('../helpers/sync');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function controllerToken() {
  try {
    const secret = JSON.parse(execFileSync('kubectl', ['-n', 'blak-micro', 'get', 'secret', 'blak-chat-role-controller', '-o', 'json'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }));
    return Buffer.from(secret.data.token, 'base64').toString();
  } catch { throw Error('Cannot load native Chat controller; credential omitted'); }
}

test('Chat login loads public bootstrap metadata while private settings stay denied', async ({ page }) => {
  await page.goto('https://chat.workspace.example.com');
  await expect(page.getByRole('button', { name: /Blak ID/i })).toBeVisible({ timeout: 60000 });
  const result = await page.request.post('https://chat.workspace.example.com/api/v1/method.callAnon/private-settings%3Aget', {
    data: { message: JSON.stringify({ msg: 'method', id: 'private-settings-denied', method: 'private-settings/get', params: [] }) },
  });
  expect(result.status()).toBe(200);
  expect(JSON.parse((await result.json()).message).error).toBeTruthy();
});

test('Chat native roles cap room owners, existing tokens and websocket sessions', async ({ page, context }) => {
  test.setTimeout(720000);
  const key = 'chat-roles-' + crypto.randomBytes(6).toString('hex');
  const endpoint = serviceURL('chat', 3000), origin = 'https://chat.workspace.example.com';
  const controller = controllerToken();
  if (process.env.BLAK_E2E_CHAT_DIAGNOSTICS === 'true') {
    page.on('response', async result => {
      const path = new URL(result.url()).pathname;
      if (result.status() >= 400 && path.startsWith('/api/')) console.log('Chat HTTP rejection', result.status(), path);
      if (path.startsWith('/api/v1/method.call')) {
        try {
          const value = await result.json(), message = JSON.parse(value.message);
          if (message.error) console.log('Chat RPC rejection', path, message.error.error);
        } catch {}
      }
    });
    page.on('pageerror', error => console.log('Chat browser exception', error.name));
    function frames(payload) {
      try {
        const text = String(payload), value = JSON.parse(text.startsWith('a[') ? text.slice(1) : text);
        return (Array.isArray(value) ? value : [value]).map(item => typeof item === 'string' ? JSON.parse(item) : item);
      } catch { return []; }
    }
    page.on('websocket', socket => {
      const methods = new Map();
      socket.on('framesent', frame => {
        for (const value of frames(frame.payload)) if (value.msg === 'method') methods.set(value.id, value.method);
      });
      socket.on('framereceived', frame => {
        for (const value of frames(frame.payload)) if (value.error) console.log('Chat DDP rejection', methods.get(value.id), value.error.error);
      });
    });
  }
  let subject, native, token, room, failure;
  async function response(path, body, operator = false) {
    return fetch(endpoint + '/api/v1/' + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...(operator ? { authorization: 'Bearer ' + controller } : { 'X-Auth-Token': token, 'X-User-Id': native.id }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  }
  async function api(path, body, operator = false) {
    const result = await response(path, body, operator);
    const value = await result.json();
    if (!result.ok) throw Error('Native Chat fixture returned HTTP ' + result.status + ' at ' + path + ' (' + String(value.errorType || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) + ')');
    if (!value.success) throw Error('Native Chat fixture rejected operation at ' + path);
    return value;
  }
  async function waitRole(role) {
    await expect.poll(async () => {
      const users = (await api('blak.roles.identities', {}, true)).identities;
      const user = users.find(user => user.subject === subject);
      if (!user) return null;
      if (native) expect(user.id).toBe(native.id);
      native = user;
      return { active: user.active, role: user.role, roles: user.roles };
    }, { timeout: 150000, intervals: [2000, 4000] }).toEqual({ active: Boolean(role), role, roles: role ? ['blak-chat-' + role] : [] });
  }
  async function denied(path, body) {
    expect([401, 403]).toContain((await response(path, body)).status);
  }
  try {
    await context.addCookies(await identityCookies(key, 'Chat native role fixture', ['chat'], { chat: 'writer' }));
    subject = (await (await page.request.get('/api/me')).json()).sub;
    await waitRole('writer');
    await page.goto(origin + '/home?blak_launch=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(localStorage.getItem('Meteor.loginToken')), undefined, { timeout: 90000 });
    token = await page.evaluate(() => localStorage.getItem('Meteor.loginToken'));
    expect(await page.evaluate(() => localStorage.getItem('Meteor.userId'))).toBe(native.id);
    room = (await api('groups.create', { name: key, members: [] })).group;
    const message = (await api('chat.sendMessage', { message: { rid: room._id, msg: 'Native role fixture ' + key } })).message;
    await page.goto(origin + '/group/' + key, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Native role fixture ' + key, { exact: true }).first()).toBeVisible({ timeout: 60000 });
    await denied('users.update', { userId: native.id, data: { roles: ['admin'] } });
    await page.evaluate(async () => {
      const socket = new WebSocket(location.origin.replace(/^http/, 'ws') + '/websocket');
      window.__blakRoleSocket = { closed: false };
      socket.onclose = () => { window.__blakRoleSocket.closed = true; };
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(Error('Native DDP login timed out')), 15000);
        socket.onopen = () => socket.send(JSON.stringify({ msg: 'connect', version: '1', support: ['1'] }));
        socket.onmessage = event => {
          const data = JSON.parse(event.data);
          if (data.msg === 'ping') socket.send(JSON.stringify({ msg: 'pong', id: data.id }));
          if (data.msg === 'connected') socket.send(JSON.stringify({ msg: 'method', method: 'login', id: 'role-login', params: [{ resume: localStorage.getItem('Meteor.loginToken') }] }));
          if (data.msg === 'result' && data.id === 'role-login') {
            clearTimeout(timeout);
            if (data.error) reject(Error('Native DDP login denied')); else resolve();
          }
        };
      });
    });
    updateIdentity(key, { roles: { chat: 'reader' } });
    await waitRole('reader');
    await page.waitForFunction(() => window.__blakRoleSocket?.closed === true);
    expect((await api('groups.history?roomId=' + room._id)).messages.some(item => item._id === message._id)).toBe(true);
    await denied('chat.sendMessage', { message: { rid: room._id, msg: 'forbidden' } });
    await denied('chat.update', { roomId: room._id, msgId: message._id, text: 'forbidden' });
    await denied('chat.delete', { roomId: room._id, msgId: message._id });
    await denied('method.call/updateMessage', { message: JSON.stringify({ msg: 'method', id: 'deny', method: 'updateMessage', params: [{ _id: message._id, rid: room._id, msg: 'forbidden' }] }) });
    await denied('groups.setDescription', { roomId: room._id, description: 'forbidden' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Native role fixture ' + key, { exact: true }).first()).toBeVisible({ timeout: 60000 });
    updateIdentity(key, { roles: { chat: 'admin' } });
    await waitRole('admin');
    await api('groups.setDescription', { roomId: room._id, description: 'Managed by native role fixture' });
    await denied('users.update', { userId: native.id, data: { password: key + '-unused-A9!', roles: ['admin'] } });
    await denied('settings/Accounts_OAuth_Custom-Blakid-url', { value: 'https://invalid.example.invalid' });
    await denied('blak.roles.reconcile', { members: [] });
    updateIdentity(key, { active: false });
    await waitRole(null);
    await denied('groups.history?roomId=' + room._id);
    updateIdentity(key, { active: true, grants: ['search'], roles: { search: 'admin' } });
    await waitRole(null);
    await denied('groups.history?roomId=' + room._id);
    updateIdentity(key, { grants: ['chat'], roles: { chat: 'reader' }, rename: true });
    await waitRole('reader');
    expect((await api('me'))._id).toBe(native.id);
    expect((await api('groups.history?roomId=' + room._id)).messages.some(item => item.msg === 'Native role fixture ' + key)).toBe(true);
    await api('logout', {});
    await page.evaluate(() => { for (const name of ['Meteor.loginToken', 'Meteor.userId', 'Meteor.loginTokenExpires']) localStorage.removeItem(name); });
    await context.addCookies(await identityCookies(key, 'Chat native role fixture', ['chat'], { chat: 'reader' }));
    await page.goto(origin + '/home?blak_launch=1', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(localStorage.getItem('Meteor.loginToken')), undefined, { timeout: 90000 });
    token = await page.evaluate(() => localStorage.getItem('Meteor.loginToken'));
    expect(await page.evaluate(() => localStorage.getItem('Meteor.userId'))).toBe(native.id);
    updateIdentity(key, { grants: [] });
    await waitRole(null);
    await denied('groups.history?roomId=' + room._id);
    await api('logout', {});
    await denied('me');
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
    if (subject) { updateIdentity(key, { active: false }); await waitRole(null); }
    if (native?.id) {
      const fixture = { id: native.id, subject, room: room?._id, key };
      const script = 'const fixture=' + JSON.stringify(fixture) + `;
const dbx=db.getSiblingDB('rocketchat'), user=dbx.users.findOne({_id:fixture.id,'services.blakid.id':fixture.subject});
if(!user || user.active || !Array.isArray(user.emails) || !user.emails.some(function(email){return /@example[.]invalid$/.test(email.address)}))throw Error('Fixture ownership check failed');
if(fixture.room){
 const room=dbx.rocketchat_room.findOne({_id:fixture.room,name:fixture.key});
 const owner=dbx.rocketchat_subscription.findOne({rid:fixture.room,'u._id':fixture.id,roles:'owner'});
 if(!room || !owner)throw Error('Fixture room ownership check failed');
 dbx.rocketchat_message.deleteMany({rid:fixture.room});dbx.rocketchat_subscription.deleteMany({rid:fixture.room});dbx.rocketchat_room.deleteOne({_id:fixture.room});
}
dbx.rocketchat_subscription.deleteMany({'u._id':fixture.id});dbx.users.deleteOne({_id:fixture.id,'services.blakid.id':fixture.subject});`;
      try { execFileSync('kubectl', ['-n', 'blak-micro', 'exec', 'deploy/mongo', '--', 'mongosh', '--quiet', '--eval', script], { stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch { throw Error('Native Chat fixture cleanup failed; details omitted'); }
    }
    } catch (cleanupError) {
      if (!failure) throw cleanupError;
      console.warn('Native Chat fixture cleanup also failed; original error retained');
    }
  }
});
