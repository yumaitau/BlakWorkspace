/* Native app logout runs on that app's origin. Credentials never leave it. */
(async () => {
  'use strict';
  const apps=await fetch('/_blak/apps.json').then(r=>r.json());
  const portal=new URL(apps.find(a=>a.id==='portal').url).origin;
  const app=apps.find(a=>a.id!=='portal' && new URL(a.url).origin===location.origin);
  const state=new URL(location.href).searchParams.get('state');
  if(!app || !state || !/^[a-f0-9]{32}$/.test(state)) throw Error('Invalid sign-out request');
  async function request(url,options={}) {
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store',...options});
    if(!response.ok && response.status!==401) throw Error('Native logout rejected');
    return response;
  }
  try {
    switch(app.id) {
      case 'forms': await request('/logout'); break;
      case 'crm': await request('/api/method/logout'); break;
      case 'projects': await request('/api/auth/sign-out',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}); break;
      case 'sites': {
        const csrf=document.cookie.split('; ').find(value=>value.startsWith('__Host-csrfToken='))?.slice('__Host-csrfToken='.length);
        await request('/api/auth.delete',{method:'POST',headers:{'content-type':'application/json',...(csrf?{'x-csrf-token':decodeURIComponent(csrf)}:{})},body:'{}'}); break;
      }
      case 'hermes': {
        const token=localStorage.getItem('token');
        await request('/api/v1/auths/signout',{method:'POST',headers:token?{authorization:'Bearer '+token}:{}});
        localStorage.removeItem('token'); break;
      }
      case 'chat': {
        const token=localStorage.getItem('Meteor.loginToken'), user=localStorage.getItem('Meteor.userId');
        if(token && user) await request('/api/v1/logout',{method:'POST',headers:{'X-Auth-Token':token,'X-User-Id':user}});
        for(const key of ['Meteor.loginToken','Meteor.userId','Meteor.loginTokenExpires']) localStorage.removeItem(key);
        break;
      }
      case 'drive':
        // OpenCloud's browser OIDC client owns these records. The coordinator
        // ends the OP session after all app sessions have been cleared.
        for(const storage of [localStorage,sessionStorage]) for(const key of Object.keys(storage)) if(key.startsWith('oidc.')) storage.removeItem(key);
        break;
      default: throw Error('No maintained logout adapter');
    }
    localStorage.setItem('blak-last-signout',String(Date.now()));
    document.getElementById('status').textContent='Signed out';
    window.parent.postMessage({type:'blak-signout',state,app:app.id,ok:true},portal);
  } catch {
    document.getElementById('status').textContent='Sign-out needs another attempt';
    window.parent.postMessage({type:'blak-signout',state,app:app.id,ok:false},portal);
  }
})().catch(()=>{document.getElementById('status').textContent='Sign-out unavailable';});
