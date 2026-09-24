'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cpuCores, bytes, hosts, listHosts } = require('../host-monitor');

test('Kubernetes quantities and host readings use node capacity', async () => {
  assert(Math.abs(cpuCores('1715123794n') - 1.715123794) < 1e-9);
  assert.equal(cpuCores('250m'), 0.25);
  assert.equal(bytes('17233172Ki'), 17646768128);
  const nodes = { items: [{ metadata: { name: 'homelab' }, status: { capacity: { cpu: '8', memory: '32Gi' }, conditions: [{ type: 'Ready', status: 'True' }] } }] };
  const metrics = { items: [{ metadata: { name: 'homelab' }, timestamp: '2026-09-24T10:48:11Z', usage: { cpu: '1715123794n', memory: '17233172Ki' } }] };
  const now = Date.parse('2026-09-24T10:48:30Z');
  assert.deepEqual(hosts(nodes, metrics, now), [{
    name: 'homelab', ready: true, measuredAt: '2026-09-24T10:48:11Z',
    cpu: { used: cpuCores('1715123794n'), capacity: 8 }, memory: { used: 17646768128, capacity: 32 * 1024 ** 3 },
  }]);
  const get = endpoint => Promise.resolve(endpoint.includes('metrics.k8s.io') ? metrics : nodes);
  assert.equal((await listHosts(get))[0].name, 'homelab');
  assert.equal(hosts(nodes, metrics, now + 120000)[0].cpu, null);
});
