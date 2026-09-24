'use strict';

const fs = require('node:fs');
const https = require('node:https');

const ACCOUNT = '/var/run/secrets/kubernetes.io/serviceaccount';

function cpuCores(value) {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?)(n|u|m)?$/);
  if (!match) throw new Error('Invalid CPU quantity');
  return Number(match[1]) * ({ n: 1e-9, u: 1e-6, m: 1e-3, '': 1 }[match[2] || '']);
}

function bytes(value) {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|K|M|G)?$/);
  if (!match) throw new Error('Invalid memory quantity');
  return Number(match[1]) * ({ Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, K: 1000, M: 1e6, G: 1e9, '': 1 }[match[2] || '']);
}

function hosts(nodes, metrics, now = Date.now()) {
  const readings = new Map(metrics.items.map(item => [item.metadata.name, item]));
  return nodes.items.map(node => {
    const name = node.metadata.name;
    const metric = readings.get(name);
    const ready = node.status.conditions.some(condition => condition.type === 'Ready' && condition.status === 'True');
    const fresh = metric && Number.isFinite(Date.parse(metric.timestamp)) && now - Date.parse(metric.timestamp) < 120000 && now >= Date.parse(metric.timestamp) - 30000;
    const cpuCapacity = cpuCores(node.status.capacity.cpu);
    const memoryCapacity = bytes(node.status.capacity.memory);
    return {
      name, ready, measuredAt: fresh ? metric.timestamp : null,
      cpu: fresh ? { used: cpuCores(metric.usage.cpu), capacity: cpuCapacity } : null,
      memory: fresh ? { used: bytes(metric.usage.memory), capacity: memoryCapacity } : null,
    };
  });
}

function kubeGet(endpoint) {
  return new Promise((resolve, reject) => {
    const token = fs.readFileSync(`${ACCOUNT}/token`, 'utf8').trim();
    const ca = fs.readFileSync(`${ACCOUNT}/ca.crt`);
    const req = https.get({ hostname: 'kubernetes.default.svc', port: 443, path: endpoint, ca, headers: { authorization: `Bearer ${token}` }, timeout: 4000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        body += chunk;
        if (body.length > 2_000_000) req.destroy(new Error('Metrics response too large'));
      });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Kubernetes API ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Kubernetes API timeout')));
    req.on('error', reject);
  });
}

async function listHosts(get = kubeGet) {
  const [nodes, metrics] = await Promise.all([
    get('/api/v1/nodes'),
    get('/apis/metrics.k8s.io/v1beta1/nodes'),
  ]);
  return hosts(nodes, metrics);
}

module.exports = { cpuCores, bytes, hosts, listHosts };
