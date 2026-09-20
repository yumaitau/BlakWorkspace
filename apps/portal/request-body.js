'use strict';
const MAX_FORM_BYTES = 64 * 1024;
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
function readBody(req, limit = MAX_FORM_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
    req.on('aborted', () => reject(new Error('Request aborted')));
  });
}
module.exports = { readBody, MAX_UPLOAD_BYTES };
