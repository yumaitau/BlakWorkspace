'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const crypto=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createSessionStore}=require('../session-store');

test('persistent sessions are encrypted, scoped and revocable after restart',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'blak-sessions-')),file=path.join(dir,'sessions.enc');
  try {
    const store=createSessionStore(file,'test-key');
    const first=store.create({sub:'owner-one',oidcSid:'sid-one',accessToken:'private-access-token',exp:Date.now()+60000});
    const second=store.create({sub:'owner-two',oidcSid:'sid-two',exp:Date.now()+60000});
    assert(!fs.readFileSync(file).includes(Buffer.from('private-access-token')));
    const restored=createSessionStore(file,'test-key');
    assert.equal(restored.get(first).sub,'owner-one');
    restored.revokeIdentity({sid:'sid-one'});
    assert.equal(restored.get(first),null);assert.equal(restored.get(second).sub,'owner-two');
    assert.equal(createSessionStore(file,'test-key').get(first),null);
    assert.throws(()=>createSessionStore(file,'wrong-key'));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('OIDC browser flow validates PKCE, nonce, identity, grants and signed logout',async t=>{
  const jose=await import('jose');
  const {publicKey,privateKey}=await jose.generateKeyPair('RS256');
  const jwk={...await jose.exportJWK(publicKey),kid:'test-key',alg:'RS256',use:'sig'};
  let origin,nonce,challenge,badNonce=false,refreshCount=0;
  const claims={sub:'fixed-owner',preferred_username:'mutable-name',blak_id:crypto.randomUUID(),name:'Test User',blak_apps:['draw']};
  const issuer=()=>origin+'/application/o/blak-portal/';
  async function jwt(payload,audience='blak-portal') {
    return new jose.SignJWT(payload).setProtectedHeader({alg:'RS256',kid:'test-key'}).setIssuer(issuer()).setAudience(audience).setIssuedAt().setExpirationTime('5m').sign(privateKey);
  }
  const idp=http.createServer(async(req,res)=>{
    try {
      res.setHeader('content-type','application/json');
      if(req.url.endsWith('/.well-known/openid-configuration')) return res.end(JSON.stringify({issuer:issuer(),jwks_uri:origin+'/jwks',authorization_endpoint:origin+'/authorize',token_endpoint:origin+'/application/o/token/',userinfo_endpoint:origin+'/application/o/userinfo/',end_session_endpoint:origin+'/end-session'}));
      if(req.url==='/jwks') return res.end(JSON.stringify({keys:[jwk]}));
      if(req.url==='/application/o/userinfo/') return res.end(JSON.stringify(claims));
      if(req.url==='/application/o/token/') {
        let body='';for await(const chunk of req) body+=chunk;
        const params=new URLSearchParams(body);
        if(params.get('grant_type')==='refresh_token') {
          assert.equal(params.get('refresh_token'),'test-refresh');refreshCount++;
          return res.end(JSON.stringify({access_token:'refreshed-access',refresh_token:'rotated-refresh',expires_in:300,id_token:await jwt({sub:claims.sub,sid:'browser-one'})}));
        }
        assert.equal(crypto.createHash('sha256').update(params.get('code_verifier')).digest('base64url'),challenge);
        return res.end(JSON.stringify({access_token:'test-access',refresh_token:'test-refresh',expires_in:1,id_token:await jwt({sub:claims.sub,nonce:badNonce?'wrong':nonce,sid:'browser-one'})}));
      }
      res.writeHead(404);res.end('{}');
    } catch {res.writeHead(500);res.end('{}');}
  });
  await new Promise(resolve=>idp.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+idp.address().port;
  process.env.OIDC_BASE=origin+'/application/o';process.env.OIDC_ISSUER=issuer();process.env.OIDC_AUTH_URL=origin+'/authorize';
  process.env.OIDC_REDIRECT_URI='http://127.0.0.1/callback';
  const {server,sign}=require('../server');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();idp.closeAllConnections();server.close();idp.close();});
  const base='http://127.0.0.1:'+server.address().port;
  async function login() {
    const start=await fetch(base+'/login?app=draw',{redirect:'manual'});
    const auth=new URL(start.headers.get('location'));nonce=auth.searchParams.get('nonce');challenge=auth.searchParams.get('code_challenge');
    assert.equal(auth.searchParams.get('code_challenge_method'),'S256');
    return fetch(base+'/callback?code=test&state='+auth.searchParams.get('state'),{redirect:'manual',headers:{cookie:start.headers.getSetCookie()[0].split(';')[0]}});
  }
  badNonce=true;assert.equal((await login()).status,502);badNonce=false;
  const callback=await login();assert.equal(callback.status,302);assert.equal(callback.headers.get('location'),'/launch/draw');
  const cookie=callback.headers.getSetCookie().find(c=>c.startsWith('blak_session=')).split(';')[0];
  const request=(url,options={})=>fetch(base+url,{redirect:'manual',...options,headers:{cookie,...options.headers}});
  const me=await (await request('/api/me')).json();assert.equal(me.sub,'fixed-owner');assert.equal(me.identity,claims.blak_id);
  const modules=await (await request('/api/modules')).json();assert.deepEqual(modules.modules.map(a=>a.id),['draw']);
  assert.equal((await request('/launch/crm')).status,403);assert.equal((await request('/cloud')).status,403);
  assert.equal((await request('/welcome')).status,200);
  const home=await (await request('/')).text();assert(!home.includes('href="/launch/crm"'));assert(!home.includes('href="/launch/drive"'));
  assert.equal((await request('/api/modules',{headers:{origin:'https://untrusted.example'}})).status,403);
  const legacy=sign({sub:'owner',exp:Date.now()+60000});
  assert.equal((await fetch(base+'/api/me',{headers:{cookie:'blak_session='+legacy}})).status,401);
  claims.blak_apps=['forms'];
  const formSession=await login();
  const formCookie=formSession.headers.getSetCookie().find(c=>c.startsWith('blak_session=')).split(';')[0];
  const formLaunch=await fetch(base+'/launch/forms',{redirect:'manual',headers:{cookie:formCookie}});
  const target=new URL(formLaunch.headers.get('location'));
  assert.equal(target.pathname,'/connect/oidc');assert.match(target.searchParams.get('state'),/^[a-f0-9]{32}$/);
  claims.blak_apps=['draw'];
  const now=Date.now;
  try {
    Date.now=()=>now()+31000;
    assert.equal((await request('/api/me')).status,200);assert.equal(refreshCount,1);
  } finally {Date.now=now;}
  const logout=async audience=>request('/oidc/backchannel-logout',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({logout_token:await jwt({sid:'browser-one',jti:crypto.randomUUID(),events:{'http://schemas.openid.net/event/backchannel-logout':{}}},audience)})});
  assert.equal((await logout('another-client')).status,400);assert.equal((await request('/api/me')).status,200);
  assert.equal((await logout('blak-portal')).status,200);assert.equal((await request('/api/me')).status,401);
});
