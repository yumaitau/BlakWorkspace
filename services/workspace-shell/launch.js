/* Use Frappe's own server-generated OAuth URL and state cookie. */
(async()=>{
  const apps=await fetch('/_blak/apps.json').then(r=>r.json());
  const app=apps.find(a=>new URL(a.url).origin===location.origin);
  if(app?.id==='forms') {
    // HeyForm uses store.js (JSON) and a readable cookie for its device binding.
    const key='HEYFORM_DEVICE_ID';
    let device;
    try { device=JSON.parse(localStorage.getItem(key)); } catch {}
    if(typeof device!=='string'||!device) device=decodeURIComponent(document.cookie.split('; ').find(v=>v.startsWith(key+'='))?.slice(key.length+1)||'');
    if(!device) device=crypto.randomUUID();
    localStorage.setItem(key,JSON.stringify(device));
    document.cookie=key+'='+encodeURIComponent(device)+'; Path=/; Secure; SameSite=Lax; Max-Age=31536000';
    location.replace('/connect/oidc?state='+encodeURIComponent(device));
    return;
  }
  if(app?.id!=='crm') throw Error('Unsupported application');
  const response=await fetch('/login?redirect-to=/crm',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok) throw Error('Login unavailable');
  if(new URL(response.url).pathname==='/crm') { location.replace('/crm'); return; }
  const loginDocument=new DOMParser().parseFromString(await response.text(),'text/html');
  const link=loginDocument.querySelector('a[href*="client_id=blak-crm"]');
  if(!link) { location.replace('/crm'); return; }
  const target=new URL(link.getAttribute('href'));
  const id=apps.find(a=>a.id==='idp');
  if(!id || target.origin!==new URL(id.url).origin) throw Error('Unexpected login provider');
  location.replace(target.href);
})().catch(()=>{document.getElementById('status').textContent='Could not open this application. Return to the workspace and retry.';});
