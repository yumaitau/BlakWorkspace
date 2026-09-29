'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requireMailAccess, requireRegion, outboundRoute } = require('../mail-policy');
const { domainName, verifyDomainDns } = require('../mail-dns');

const tenantId = '11111111-1111-4111-8111-111111111111';
const otherTenant = '22222222-2222-4222-8222-222222222222';
const identity = { issuer: 'https://id.example.test', subject: 'member-a' };
function fixture() {
  const memberships = [{ ...identity, tenantId, active: true, permissions: ['domains:read'] }];
  const record = { tenantId, domain: 'tenant.example.test', challenge: 'a'.repeat(43), challengeExpiresAt: 2000,
    expected: { mx: [{ priority: 10, exchange: 'mx1.example.test' }, { priority: 20, exchange: 'mx2.example.test' }],
      spf: 'v=spf1 include:amazonses.com -all', dmarc: 'v=DMARC1; p=reject;',
      mtaSts: 'v=STSv1; id=20260928;', tlsRpt: 'v=TLSRPTv1; rua=mailto:reports@example.test;',
      dkim: [{ selector: 'syd', target: 'syd.dkim.amazonses.com' }] } };
  const txt = {
    '_blak-mail.tenant.example.test': [[`blak-mail=${record.challenge}`]],
    'tenant.example.test': [[record.expected.spf]],
    '_dmarc.tenant.example.test': [[record.expected.dmarc]],
    '_mta-sts.tenant.example.test': [[record.expected.mtaSts]],
    '_smtp._tls.tenant.example.test': [[record.expected.tlsRpt]],
  };
  const resolver = { resolveTxt: async name => txt[name], resolveMx: async () => record.expected.mx,
    resolveCname: async () => ['syd.dkim.amazonses.com.'] };
  return { identity, memberships, tenantId, record, now: 1000, resolver, txt };
}

test('both Australian regions hold during SES outage and drain only through Sydney', () => {
  for (const region of [undefined, '', 'us-east-1', 'ap-southeast-1', 'ap-southeast-2.evil']) {
    assert.throws(() => requireRegion(region));
  }
  assert.equal(outboundRoute('ap-southeast-2', true).host, 'email-smtp.ap-southeast-2.amazonaws.com');
  assert.equal(outboundRoute('ap-southeast-2', false).action, 'hold');
  assert.deepEqual(outboundRoute('ap-southeast-4', true), outboundRoute('ap-southeast-2', true));
  assert.equal(outboundRoute('ap-southeast-4', false).action, 'hold');
  assert.equal(outboundRoute('ap-southeast-4', false).region, 'ap-southeast-4');
  assert.throws(() => outboundRoute('ap-southeast-2', 'true'));
});

test('workspace admin or email domain cannot replace current tenant membership', () => {
  const f = fixture();
  assert.equal(requireMailAccess(identity, f.memberships, tenantId, 'domains:read').tenantId, tenantId);
  for (const args of [
    [{ ...identity, apps: ['idp'] }, [], tenantId, 'domains:read'],
    [identity, f.memberships, otherTenant, 'domains:read'],
    [{ ...identity, issuer: 'https://other.test' }, f.memberships, tenantId, 'domains:read'],
    [identity, [{ ...f.memberships[0], active: false }], tenantId, 'domains:read'],
    [identity, f.memberships, tenantId, 'domains:write'],
  ]) assert.throws(() => requireMailAccess(...args), /access denied/);
});

test('domain normalisation rejects URL, path, IP, whitespace and control injection', () => {
  assert.equal(domainName('EXAMPLE.test.'), 'example.test');
  assert.equal(domainName('bücher.test'), 'xn--bcher-kva.test');
  for (const value of ['http://example.test', 'a@b.test', '../example.test', '127.0.0.1',
    'a.test\n', ' example.test', '-a.test', 'a..test', 'a.test:443', 'a\\b.test']) {
    assert.throws(() => domainName(value));
  }
});

test('correct DNS remains distinct from activation and HTTPS policy verification', async () => {
  const f = fixture();
  f.txt['tenant.example.test'] = [['v=spf1 include:', 'amazonses.com -all']];
  const result = await verifyDomainDns(f);
  assert.equal(result.dnsVerified, true);
  assert.equal(result.activationReady, false);
  assert.ok(result.pending.includes('mta-sts-https'));
});

test('duplicate and substring policy records do not falsely verify', async () => {
  for (const rows of [[['v=spf1 include:amazonses.com -all'], ['v=spf1 +all']],
    [['prefix v=spf1 include:amazonses.com -all']], [['v=spf1 include:'], ['amazonses.com -all']]]) {
    const f = fixture(); f.txt['tenant.example.test'] = rows;
    assert.equal((await verifyDomainDns(f)).checks.find(x => x.type === 'spf').status, 'failed');
  }
});

test('DNS outage is unknown; authoritative absence is failed', async () => {
  for (const [code, expected] of [['ETIMEOUT', 'unknown'], ['ENODATA', 'failed']]) {
    const f = fixture(); f.resolver.resolveMx = async () => { throw Object.assign(new Error('sensitive error'), { code }); };
    const result = await verifyDomainDns(f);
    assert.equal(result.checks.find(x => x.type === 'mx').status, expected);
    assert.equal(JSON.stringify(result).includes('sensitive error'), false);
  }
});

test('cross-tenant and expired challenges rejected before resolver access', async () => {
  for (const mutate of [f => { f.record.tenantId = otherTenant; }, f => { f.record.challengeExpiresAt = 1000; },
    f => { f.memberships[0].active = false; }, f => { f.record.expected.dkim[0].selector = '../other'; }]) {
    const f = fixture(); mutate(f);
    f.resolver = new Proxy({}, { get() { assert.fail('Unauthorised DNS query'); } });
    await assert.rejects(verifyDomainDns(f));
  }
});

test('unexpected MX and DKIM targets fail closed', async () => {
  const f = fixture(); f.resolver.resolveMx = async () => [{ priority: 10, exchange: 'attacker.example.test' }];
  f.resolver.resolveCname = async () => ['attacker.example.test'];
  const result = await verifyDomainDns(f);
  for (const type of ['mx', 'dkim']) assert.equal(result.checks.find(x => x.type === type).status, 'failed');
});
