'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {healthFor}=require('../sync-health');
test('sync status never exposes another owner and has no credentials or document IDs',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blak-health-'));try{
 const file=path.join(dir,'health.json');fs.writeFileSync(file,JSON.stringify({generated_at:1000,accounts:[{portal_owner:'alice',sources:[{name:'crm',label:'CRM',last_success:990,documents:2,token:'should-never-leak',files:['private-id']}]}]}));
 assert.equal(healthFor('bob',file,1000).enrolled,false);const health=healthFor('alice',file,1000);assert.equal(health.sources[0].status,'healthy');assert.ok(!JSON.stringify(health).includes('private-id'));assert.ok(!JSON.stringify(health).includes('should-never-leak'));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('stale, revoked, near-expiry and expired credentials produce actionable states',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blak-health-'));try{const file=path.join(dir,'health.json');
 fs.writeFileSync(file,JSON.stringify({accounts:[{portal_owner:'alice',sources:[{name:'drive',last_success:1},{name:'forms',last_success:1900,last_error:true},{name:'crm',last_success:1900,expires_at:2100},{name:'chat',last_success:1900,expires_at:1999},{name:'draw'}]}]}));
 assert.deepEqual(healthFor('alice',file,2000).sources.map(s=>s.status),['stale','error','expiring','expired','pending']);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
