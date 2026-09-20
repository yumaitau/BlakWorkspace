'use strict';
const crypto=require('node:crypto');
const {test:base,expect}=require('@playwright/test');
const sessionSecret=process.env.BLAK_E2E_SESSION_SECRET;
function session(sub,name=sub) {
  if(!sessionSecret)throw new Error('BLAK_E2E_SESSION_SECRET required for isolated test identities');
  const p=Buffer.from(JSON.stringify({sub,name,exp:Date.now()+3600000})).toString('base64url');
  return p+'.'+crypto.createHmac('sha256',sessionSecret).update(p).digest('base64url');
}
const test=base.extend({
  account:async({},use,testInfo)=>{await use(`e2e-${testInfo.workerIndex}-${crypto.randomUUID()}`);},
  signedIn:async({page,context,baseURL,account},use)=>{
    await context.addCookies([{name:'blak_session',value:session(account,'E2E Tester'),url:baseURL,httpOnly:true,sameSite:'Lax'}]);
    await use(page);
    const response=await context.request.get('/flow');
    const ids=[...new Set([...(await response.text()).matchAll(/href="\/flow\/([a-f0-9]{16})"/g)].map(match=>match[1]))];
    for(const id of ids)await context.request.post(`/flow/${id}/delete`);
  },
});
module.exports={test,expect,session};
