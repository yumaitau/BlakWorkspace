'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

test('monitoring admin policy survives scanner retirement', () => {
  const { isWorkspaceAdmin } = require('../app-roles');
  assert.equal(isWorkspaceAdmin(null), false);
  assert.equal(isWorkspaceAdmin({ apps: ['idp'] }), true);
  assert.equal(isWorkspaceAdmin({ apps: ['drive'], roles: { drive: 'admin' } }), true);
  assert.equal(isWorkspaceAdmin({ apps: [], roles: { drive: 'admin' } }), false);
  assert.equal(isWorkspaceAdmin({ apps: ['drive'], roles: { drive: 'reader' } }), false);
});
