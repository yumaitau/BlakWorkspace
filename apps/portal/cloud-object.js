'use strict';
const { isIP } = require('node:net');
function validBucketName(name) {
  return typeof name === 'string' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name) && !name.includes('..') && !isIP(name);
}

function s3ObjectPath(bucket, key) {
  return `/${bucket}/${String(key).split('/').map(encodeURIComponent).join('/')}`;
}

function memoryS3() {
  const store = new Map();
  return async function s3Req(method, path, body) {
    if (method === 'PUT') {
      store.set(path, Buffer.isBuffer(body) ? body : Buffer.from(body || ''));
      return { status: 200, body: Buffer.alloc(0), headers: {} };
    }
    if (method === 'DELETE') {
      store.delete(path);
      return { status: 204, body: Buffer.alloc(0), headers: {} };
    }
    if (method === 'GET') {
      const found = store.get(path);
      if (!found) return { status: 404, body: Buffer.alloc(0), headers: {} };
      return { status: 200, body: found, headers: { 'content-type': 'application/octet-stream' } };
    }
    return { status: 405, body: Buffer.alloc(0), headers: {} };
  };
}

async function dispatchCloudObject(s3Req, { method, bucket, key, body }) {
  if (!validBucketName(bucket) || !key || String(key).split('/').some(part => part === '.' || part === '..')) {
    return { httpStatus: 400, text: 'bucket and key required' };
  }
  const path = s3ObjectPath(bucket, key);
  if (method === 'DELETE' || method === 'PUT') {
    const result = await s3Req(method, path, method === 'PUT' ? body || Buffer.alloc(0) : null);
    const ok = result.status >= 200 && result.status < 300;
    return { httpStatus: ok ? 200 : result.status, json: { ok, status: result.status } };
  }
  if (method === 'GET') {
    const r = await s3Req('GET', path, null);
    if (r.status !== 200) return { httpStatus: r.status, text: 'object fetch failed' };
    const headers = {
      'content-type': (r.headers && r.headers['content-type']) || 'application/octet-stream',
      'content-length': r.body.length,
      'content-disposition': `attachment; filename="${String(key).split('/').pop().replace(/[^a-zA-Z0-9._ -]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(String(key).split('/').pop()).replace(/[!'()*]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase())}`,
    };
    return { httpStatus: 200, headers, body: r.body };
  }
  return { httpStatus: 405, text: 'method not allowed' };
}

function writeCloudResult(res, result) {
  if (result.json) {
    res.writeHead(result.httpStatus, { 'content-type': 'application/json' });
    res.end(JSON.stringify(result.json));
    return;
  }
  if (result.body) {
    res.writeHead(result.httpStatus, result.headers || { 'content-type': 'application/octet-stream' });
    res.end(result.body);
    return;
  }
  res.writeHead(result.httpStatus, { 'content-type': 'text/plain' });
  res.end(result.text || '');
}

async function demoPutDelete() {
  const s3 = memoryS3();
  const put = await dispatchCloudObject(s3, {
    method: 'PUT', bucket: 'demo', key: 'note.txt', body: Buffer.from('hello-cloud'),
  });
  const got = await dispatchCloudObject(s3, { method: 'GET', bucket: 'demo', key: 'note.txt' });
  const del = await dispatchCloudObject(s3, { method: 'DELETE', bucket: 'demo', key: 'note.txt' });
  const gone = await dispatchCloudObject(s3, { method: 'GET', bucket: 'demo', key: 'note.txt' });
  return {
    putOk: Boolean(put.json && put.json.ok),
    got: got.body ? got.body.toString() : '',
    delOk: Boolean(del.json && del.json.ok),
    goneStatus: gone.httpStatus,
  };
}

module.exports = {
  validBucketName,
  dispatchCloudObject,
  memoryS3,
  s3ObjectPath,
  writeCloudResult,
  demoPutDelete,
};

if (require.main === module) {
  demoPutDelete().then((d) => process.stdout.write(JSON.stringify(d)));
}
