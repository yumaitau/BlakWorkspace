#!/usr/bin/env bash
# Create Rocket.Chat custom OAuth (Blak ID) via the in-pod admin API.
# Uses ADMIN_PASS already in the chat container. Never prints secrets.
set -euo pipefail
# Uses the selected kubectl context or KUBECONFIG.
NS="${NS:-blak-micro}"
kubectl -n "$NS" exec deploy/chat -- node -e '
const http=require("http");
function req(method,path,body,headers){
  return new Promise((resolve,reject)=>{
    const data=body?JSON.stringify(body):null;
    const h=Object.assign({"content-type":"application/json"},headers||{});
    if(data) h["content-length"]=Buffer.byteLength(data);
    const r=http.request({host:"127.0.0.1",port:3000,path,method,headers:h},res=>{let d="";res.on("data",c=>d+=c);res.on("end",()=>resolve({status:res.statusCode,body:d}));});
    r.on("error",reject); if(data) r.end(data); else r.end();
  });
}
(async()=>{
  const login=JSON.parse((await req("POST","/api/v1/login",{user:"akadmin",password:process.env.ADMIN_PASS})).body);
  if(!login.data) throw new Error("login failed");
  const auth={"X-Auth-Token":login.data.authToken,"X-User-Id":login.data.userId};
  await req("POST","/api/v1/method.call/addOAuthService",{message:JSON.stringify({msg:"method",id:"1",method:"addOAuthService",params:["blakid"]})},auth);
  const secret=process.env["Accounts_OAuth_Custom-Blakid-secret"];
  const sets=[
    ["Accounts_OAuth_Custom-Blakid", true],
    ["Accounts_OAuth_Custom-Blakid-url", "https://id.workspace.example.com/application/o"],
    ["Accounts_OAuth_Custom-Blakid-token_path", "/token/"],
    ["Accounts_OAuth_Custom-Blakid-identity_path", "/userinfo/"],
    ["Accounts_OAuth_Custom-Blakid-authorize_path", "/authorize/"],
    ["Accounts_OAuth_Custom-Blakid-scope", "openid email profile"],
    ["Accounts_OAuth_Custom-Blakid-id", "rocketchat"],
    ["Accounts_OAuth_Custom-Blakid-secret", secret],
    ["Accounts_OAuth_Custom-Blakid-button_label_text", "Sign in with Blak ID"],
    ["Accounts_OAuth_Custom-Blakid-login_style", "redirect"],
    ["Accounts_OAuth_Custom-Blakid-token_sent_via", "payload"],
    ["Accounts_OAuth_Custom-Blakid-merge_users", true],
    ["Accounts_OAuth_Custom-Blakid-username_field", "preferred_username"],
    ["Accounts_OAuth_Custom-Blakid-email_field", "email"],
    ["Accounts_OAuth_Custom-Blakid-name_field", "name"],
    ["Accounts_ShowFormLogin", false],
  ];
  for (const [id,value] of sets){
    const r=await req("POST","/api/v1/settings/"+encodeURIComponent(id),{value},auth);
    if(r.status>=300) throw new Error(id+" "+r.status);
  }
  console.log("rocketchat oauth configured");
})().catch(e=>{console.error(String(e)); process.exit(1);});
'
