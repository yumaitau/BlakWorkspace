/* Use Frappe's own server-generated OAuth URL and state cookie. */
(async()=>{
  const response=await fetch('/login?redirect-to=/crm',{credentials:'same-origin',cache:'no-store'});
  if(!response.ok) throw Error('Login unavailable');
  if(new URL(response.url).pathname==='/crm') { location.replace('/crm'); return; }
  const document=new DOMParser().parseFromString(await response.text(),'text/html');
  const link=document.querySelector('a[href*="client_id=blak-crm"]');
  if(!link) { location.replace('/crm'); return; }
  const target=new URL(link.getAttribute('href'));
  const apps=await fetch('/_blak/apps.json').then(r=>r.json());
  const id=apps.find(a=>a.id==='idp');
  if(!id || target.origin!==new URL(id.url).origin) throw Error('Unexpected login provider');
  location.replace(target.href);
})().catch(()=>{document.getElementById('status').textContent='Could not open Blak CRM. Return to the workspace and retry.';});
