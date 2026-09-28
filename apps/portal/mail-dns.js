'use strict';

const { domainToASCII } = require('node:url');
const { Resolver } = require('node:dns').promises;
const { requireMailAccess } = require('./mail-policy');

function domainName(input) {
  if (typeof input !== 'string' || input !== input.trim() || /[\s/@:#?\\\x00-\x1f]/.test(input)) {
    throw new Error('Invalid mail domain');
  }
  const value = domainToASCII(input.replace(/\.$/, '')).toLowerCase();
  const labels = value.split('.');
  if (value.length > 253 || labels.length < 2 || labels.some(label =>
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || /^\d+$/.test(labels.at(-1))) {
    throw new Error('Invalid mail domain');
  }
  return value;
}

function txtRows(rows) {
  if (!Array.isArray(rows) || rows.length > 100 || rows.some(row =>
    !Array.isArray(row) || row.some(part => typeof part !== 'string') || row.join('').length > 8192)) {
    throw new Error('Invalid DNS response');
  }
  return rows.map(row => row.join(''));
}

function equalSet(actual, expected) {
  return actual.length === expected.length && new Set(actual).size === actual.length &&
    actual.every(value => expected.includes(value));
}

function boundedRows(rows) {
  if (!Array.isArray(rows) || rows.length > 100) throw new Error('Invalid DNS response');
  return rows;
}

// Expected records come from server-owned provisioning state. DNS checks are not
// domain activation: routing reservation, DKIM delivery, MTA-STS HTTPS and provider
// verification still have separate gates. No arbitrary URL fetching here.
async function verifyDomainDns({ identity, memberships, tenantId, record, now = Date.now(), resolver }) {
  requireMailAccess(identity, memberships, tenantId, 'domains:read');
  if (!record || record.tenantId !== tenantId) throw new Error('Mail domain not found');
  const domain = domainName(record.domain);
  if (!/^[A-Za-z0-9_-]{43}$/.test(record.challenge || '') ||
      !Number.isFinite(record.challengeExpiresAt) || record.challengeExpiresAt <= now) {
    throw new Error('Domain ownership challenge expired or invalid');
  }
  const expected = record.expected;
  if (!expected || !Array.isArray(expected.mx) || expected.mx.length !== 2 ||
      !Array.isArray(expected.dkim) || !expected.dkim.length || expected.dkim.length > 8 ||
      !/^v=spf1\s.+\s-all$/.test(expected.spf || '') ||
      !/^v=DMARC1;/.test(expected.dmarc || '') ||
      !/^v=STSv1; id=[A-Za-z0-9]+;?$/.test(expected.mtaSts || '') ||
      !/^v=TLSRPTv1;/.test(expected.tlsRpt || '')) throw new Error('Mail DNS provisioning is incomplete');
  const mx = expected.mx.map(item => {
    if (!Number.isInteger(item.priority) || item.priority < 0 || item.priority > 65535) throw new Error('Invalid MX priority');
    return `${item.priority} ${domainName(item.exchange)}`;
  });
  const dkim = expected.dkim.map(item => {
    if (!/^[a-zA-Z0-9_-]{1,63}$/.test(item.selector || '')) throw new Error('Invalid DKIM selector');
    return { name: `${item.selector}._domainkey.${domain}`, target: domainName(item.target) };
  });
  if (new Set(mx).size !== 2 || new Set(dkim.map(item => item.name)).size !== dkim.length) throw new Error('Duplicate DNS expectations');
  const dns = resolver || new Resolver({ timeout: 2000, tries: 2 });
  const checks = [];
  async function check(type, name, wanted, read, evaluate) {
    try {
      const observed = await read();
      checks.push({ type, name, expected: wanted, observed, status: evaluate(observed) ? 'verified' : 'failed' });
    } catch (error) {
      checks.push({ type, name, expected: wanted, observed: [], status:
        ['ENODATA', 'ENOTFOUND'].includes(error.code) ? 'failed' : 'unknown' });
    }
  }
  async function txt(type, name, value, prefix) {
    return check(type, name, [value], async () => txtRows(await dns.resolveTxt(name)), values => {
      const policies = values.filter(item => item.toLowerCase().startsWith(prefix.toLowerCase()));
      return policies.length === 1 && policies[0] === value;
    });
  }
  await txt('ownership', `_blak-mail.${domain}`, `blak-mail=${record.challenge}`, 'blak-mail=');
  await check('mx', domain, mx, async () => boundedRows(await dns.resolveMx(domain))
    .map(item => `${item.priority} ${domainName(item.exchange)}`), actual => equalSet(actual, mx));
  await txt('spf', domain, expected.spf, 'v=spf1');
  await txt('dmarc', `_dmarc.${domain}`, expected.dmarc, 'v=DMARC1');
  await txt('mta-sts-dns', `_mta-sts.${domain}`, expected.mtaSts, 'v=STSv1');
  await txt('tls-rpt', `_smtp._tls.${domain}`, expected.tlsRpt, 'v=TLSRPTv1');
  for (const key of dkim) await check('dkim', key.name, [key.target], async () =>
    boundedRows(await dns.resolveCname(key.name)).map(domainName), actual => equalSet(actual, [key.target]));
  return { tenantId, domain, checkedAt: new Date(now).toISOString(), checks,
    dnsVerified: checks.every(item => item.status === 'verified'),
    activationReady: false, pending: ['mta-sts-https', 'provider-verification', 'routing-reservation', 'delivery-test'] };
}

module.exports = { domainName, verifyDomainDns };
