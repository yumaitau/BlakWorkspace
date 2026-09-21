'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sign, verifySession } = require('../session');
const flow = require('../flow-engine');
const { dispatchCloudObject } = require('../cloud-object');
const request = value => ({ headers: { cookie: `blak_session=${value}` } });
for (const value of ['junk', 'abc.x', 'abc.' + 'x'.repeat(43), 'a.b.c', 'a.' + 'é'.repeat(43), '']) {
  test(`malformed session rejected: ${value.slice(0, 8)}`, () => assert.equal(verifySession(request(value)), null));
}
for (const session of [{sub:'ada'}, {sub:'ada',exp:Date.now()-1}, {exp:Date.now()+10000}, {sub:'ada',exp:'tomorrow'}, null]) {
  test(`invalid signed claims ${JSON.stringify(session)}`, () => assert.equal(verifySession(request(sign(session))), null));
}
test('cookie name must match exactly', () => assert.equal(verifySession({headers:{cookie:`other_blak_session=${sign({sub:'ada',exp:Date.now()+10000})}`}}), null));
test('valid signed session accepted', () => assert.equal(verifySession(request(sign({sub:'ada',exp:Date.now()+10000}))).sub, 'ada'));
test('inherited flow and file keys never resolve', () => {
  assert.throws(()=>flow.getFlow(flow.createStore(),'constructor'));
  const drive = new flow.DriveAdapter();
  assert.equal(drive.execute('read_file',{path:'toString'},{}).ok,false);
  drive.execute('write_file',{path:'__proto__',content:'safe'},{});
  assert.equal(drive.execute('read_file',{path:'__proto__'},{}).content,'safe');
});
test('store survives atomic save and refuses corrupt data', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blak-flow-')); const file=path.join(dir,'store.json');
  try { const store=flow.createStore(); flow.saveStore(store,file); assert.deepEqual(flow.loadStore(file),store); fs.writeFileSync(file,'{'); assert.throws(()=>flow.loadStore(file)); }
  finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('connector exception recorded; following step never runs', () => {
  const store=flow.createStore(); const f=flow.createFlow(store,{owner:'ada',name:'Failure',starter:{type:'event',name:'event'},steps:[{connector:'drive',action:'write_file'},{connector:'sites',action:'create_page'}]});
  flow.setEnabled(store,f.id,true);
  const run=flow.trigger(store,f.id,{type:'event',name:'event'},{drive:{execute(){throw new Error('offline');}},sites:{execute(){assert.fail('must stop');}}});
  assert.equal(run.status,'error');assert.equal(run.steps.length,1);assert.equal(flow.listRuns(store).length,1);
});
test('object delete preserves upstream failure status', async () => {
  const result=await dispatchCloudObject(async()=>({status:403}),{method:'DELETE',bucket:'test-bucket',key:'a'});
  assert.equal(result.httpStatus,403);assert.equal(result.json.ok,false);
});
test('object download header handles Unicode and CRLF', async () => {
  const result=await dispatchCloudObject(async()=>({status:200,body:Buffer.from('ok')}),{method:'GET',bucket:'test-bucket',key:'café\r\n.txt'});
  assert.equal(result.httpStatus,200);assert(!/[\r\n]/.test(result.headers['content-disposition']));assert.match(result.headers['content-disposition'],/filename\*=UTF-8/);
});
for (const key of ['../secret','a/../secret','./secret']) test(`reject object path traversal ${key}`, async()=>{
  const result=await dispatchCloudObject(()=>assert.fail('no upstream call'),{method:'GET',bucket:'test-bucket',key});assert.equal(result.httpStatus,400);
});

test('HTTP helper preserves upstream errors and UTF-8 request bytes', async () => {
  const http = require('node:http');
  const { textRequest } = require('../http-client');
  const upstream = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => { res.writeHead(409); res.end(Buffer.concat(chunks)); });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  try {
    const result = await textRequest(`http://127.0.0.1:${upstream.address().port}`, { method: 'POST', body: 'café' });
    assert.equal(result.status, 409);
    assert.equal(result.body, 'café');
  } finally { await new Promise(resolve => upstream.close(resolve)); }
});

test('search denies indexes without explicit ACL support', () => {
  const { supportsAccessFilter, accessFilter } = require('../search-access');
  assert.equal(supportsAccessFilter(['title']), false);
  assert.equal(supportsAccessFilter(['allowedUsers']), false);
  assert.equal(supportsAccessFilter(['allowedUsers', 'visibility']), false);
  assert.equal(supportsAccessFilter(['allowedUsers', 'visibility', 'source']), true);
  const sub = 'ada" OR visibility = "private';
  assert.equal(accessFilter({ sub, apps: ['draw'], roles: { draw: 'reader' } }), `(allowedUsers = ${JSON.stringify(sub)} OR visibility = "workspace") AND source IN ["Draw"]`);
  assert.equal(accessFilter({ sub, apps: ['search'], roles: { search: 'admin' } }), null);
  assert.equal(accessFilter({ sub, apps: ['draw'], roles: { storage: 'admin' } }), null);
});

test('bucket validation rejects invalid DNS names and IP addresses', () => {
  const { validBucketName } = require('../cloud-object');
  for (const name of ['a', 'UPPER', 'bad/name', 'two..dots', '192.168.1.19']) assert.equal(validBucketName(name), false);
  assert.equal(validBucketName('blak-workspace'), true);
});
