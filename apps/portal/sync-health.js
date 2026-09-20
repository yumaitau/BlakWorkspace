'use strict';
const fs = require('node:fs');
const STALE_SECONDS = 15 * 60;
const EXPIRY_WARNING_SECONDS = 14 * 86400;
function healthFor(owner, file, now = Math.floor(Date.now()/1000)) {
  if (!file) return { enrolled:false, sources:[], message:'Connect your workspace to Hermes to see sync status.' };
  let report;
  try { report=JSON.parse(fs.readFileSync(file,'utf8')); } catch { return {enrolled:false,sources:[],message:'Sync status is unavailable. Contact your workspace administrator.'}; }
  const account=report.accounts?.find(a=>a.portal_owner===owner);
  if(!account) return {enrolled:false,sources:[],message:'Your account is not connected. An administrator can enrol your own source credentials.'};
  const sources=account.sources.map(source=>{
    const age=source.last_success ? Math.max(0,now-source.last_success) : null;
    const expired=source.expires_at && source.expires_at<=now;
    const expiresSoon=source.expires_at && source.expires_at-now<=EXPIRY_WARNING_SECONDS;
    const status=expired?'expired':source.last_error?'error':age===null?'pending':age>STALE_SECONDS?'stale':expiresSoon?'expiring':'healthy';
    return {name:source.name,label:source.label,last_success:source.last_success||null,documents:source.documents||0,status,
      expires_at:source.expires_at||null,credential_checked_at:source.credential_checked_at||null};
  });
  return {enrolled:true,generated_at:report.generated_at,sources,healthy:sources.every(s=>s.status==='healthy')};
}
module.exports={healthFor,STALE_SECONDS,EXPIRY_WARNING_SECONDS};
