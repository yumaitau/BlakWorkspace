(() => {
  'use strict';
  const {state,targets,endSessionURL}=JSON.parse(document.getElementById('logout-config').textContent);
  const results=document.getElementById('logout-results'), status=document.getElementById('logout-status');
  const retry=document.getElementById('logout-retry'), finish=document.getElementById('logout-finish');
  const remaining=new Map(targets.map(app=>[app.id,app]));
  const frames=new Map();
  let timer;
  function report() {
    results.replaceChildren();
    for(const app of targets) {const li=document.createElement('li');li.textContent=app.name+': '+(remaining.has(app.id)?'awaiting confirmation':'signed out');results.append(li);}
    if(!remaining.size) {clearTimeout(timer);location.replace(endSessionURL);}
  }
  window.addEventListener('message',event=>{
    const data=event.data, app=remaining.get(data?.app), frame=frames.get(data?.app);
    if(!app || event.origin!==app.origin || event.source!==frame?.contentWindow || data.type!=='blak-signout' || data.state!==state) return;
    if(data.ok===true) {remaining.delete(app.id);frame.remove();frames.delete(app.id);report();}
  });
  function run() {
    retry.hidden=true;finish.hidden=true;
    for(const app of remaining.values()) {
      frames.get(app.id)?.remove();
      const frame=document.createElement('iframe');frame.hidden=true;frame.title='Sign out of '+app.name;frame.src=app.url;
      frames.set(app.id,frame);document.body.append(frame);
    }
    report();
    timer=setTimeout(()=>{if(remaining.size){status.textContent='Some apps could not confirm sign-out. Retry, or finish Blak ID sign-out and close those app tabs.';retry.hidden=false;finish.hidden=false;}},20000);
  }
  retry.addEventListener('click',run);finish.href=endSessionURL;
  run();
})();
