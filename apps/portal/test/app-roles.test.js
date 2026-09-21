'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rolesFromClaims, requiredRole } = require('../app-roles');

test('native application role claims survive portal sessions without becoming REST proxy rules', () => {
  assert.deepEqual(rolesFromClaims({ sites: 'reader', projects: 'admin', hermes: 'writer', vault: 'reader', unknown: 'admin', draw: 'owner' }),
    { sites: 'reader', projects: 'admin', hermes: 'writer', vault: 'reader' });
  for (const app of ['sites', 'projects', 'hermes', 'vault']) {
    assert.equal(requiredRole(app, 'POST', '/api/native-query'), null);
  }
  assert.equal(requiredRole('draw', 'POST', '/api/draw'), 'writer');
});
