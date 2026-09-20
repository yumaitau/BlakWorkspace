#!/usr/bin/env python3
"""Publish a prepared tailnet release without replacing unrelated Serve listeners."""
import base64
import json
from pathlib import Path
import subprocess
import time

ROOT=Path(__file__).resolve().parents[2]
CONFIG=json.loads((ROOT/'.deployment.json').read_text())
TAILNET=CONFIG['tailnet']
NS='blak-micro'


def run(args,**kwargs):
    return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kwargs).stdout


def kube(*args,**kwargs):return run(['kubectl','-n',NS,*args],**kwargs)


def main():
    actual=json.loads(run(['tailscale','status','--json']))['Self']
    if actual['DNSName'].rstrip('.')!=TAILNET['host'] or TAILNET['address'] not in actual['TailscaleIPs']:
        raise RuntimeError('Release tailnet identity does not match this node')
    serve=json.loads(run(['tailscale','serve','status','--json']) or b'{}')
    for port in TAILNET['ports'].values():
        listener=serve.get('Web',{}).get(TAILNET['host']+':'+str(port))
        if listener and listener.get('Handlers')!={'/':{'Proxy':'http://127.0.0.1:18480'}}:
            raise RuntimeError('Requested port already serves another application: '+str(port))
    backup=Path('/var/backups/blak-workspace')/('tailnet-'+str(int(time.time())))
    run(['sudo','install','-d','-m','700',str(backup)])
    for name,data in [('serve.json',json.dumps(serve).encode()),('resources.json',kube('get','deploy,configmap,secret,ingressroute,cronjob','-o','json'))]:
        run(['sudo','tee',str(backup/name)],input=data)
        run(['sudo','chmod','600',str(backup/name)])
    address=kube('get','service','workspace-shell','-o','jsonpath={.spec.clusterIP}').decode()
    socket='''[Unit]
Description=Blak tailnet loopback ingress
[Socket]
ListenStream=127.0.0.1:18480
NoDelay=true
[Install]
WantedBy=sockets.target
'''
    service='''[Unit]
Description=Blak tailnet ingress proxy
[Service]
ExecStart=/usr/lib/systemd/systemd-socket-proxyd '''+address+''':8080
DynamicUser=true
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
'''
    for name,data in [('blak-tailnet.socket',socket),('blak-tailnet.service',service)]:
        run(['sudo','tee','/etc/systemd/system/'+name],input=data.encode())
    run(['sudo','systemctl','daemon-reload'])
    run(['sudo','systemctl','enable','--now','blak-tailnet.socket'])
    for port in TAILNET['ports'].values():
        run(['sudo','tailscale','serve','--bg','--yes','--https='+str(port),'http://127.0.0.1:18480'])
    # Keep subjects, secrets and existing callbacks intact. Add exact new origins.
    source=r'''
import json
from authentik.providers.oauth2.models import OAuth2Provider, RedirectURI
from authentik.brands.models import Brand
from authentik.flows.models import Flow
from authentik.core.models import Application
config=json.loads(CONFIG_JSON)
origins=config['tailnet']['origins']
domain=config['domain']
links=[]
for model,fields in [(Brand,['branding_logo','branding_favicon','branding_default_flow_background']), (Flow,['background']), (Application,['meta_launch_url','meta_icon'])]:
    for item in model.objects.all():
        before={}
        for field in fields:
            value=str(getattr(item,field) or '')
            updated=value
            for app,origin in origins.items():
                for scheme in ['http','https']:
                    updated=updated.replace(scheme+'://'+app+'.'+domain,origin)
            if updated!=value:
                before[field]=value
                setattr(item,field,updated)
        if before:
            links.append({'model':model._meta.label,'pk':str(item.pk),'fields':before})
            item.save()
print('IDENTITY_LINK_BACKUP:'+json.dumps(links))
for provider in OAuth2Provider.objects.all():
    redirects=list(provider.redirect_uris)
    additions=[]
    for redirect in redirects:
        url=redirect.url
        for app,origin in origins.items():
            for scheme in ['http','https']:
                url=url.replace(scheme+'://'+app+'.'+domain,origin)
                url=url.replace(scheme+'://'+(app+'.'+domain).replace('.',r'\.'),origin.replace('.',r'\.'))
        item=RedirectURI(matching_mode=redirect.matching_mode,url=url)
        if item!=redirect and item not in redirects and item not in additions:additions.append(item)
    if additions:
        provider.redirect_uris=redirects+additions
        provider.save()
print('Existing OIDC providers retain identity and gain tailnet callbacks')
'''
    source='CONFIG_JSON='+repr(json.dumps(CONFIG))+'\n'+source
    result=kube('exec','-i','deploy/authentik-server','--','ak','shell',input=('exec('+repr(source)+')\n').encode())
    if b'Existing OIDC providers retain identity and gain tailnet callbacks' not in result:
        raise RuntimeError('OIDC callback reconciliation did not complete')
    for line in result.splitlines():
        if b'IDENTITY_LINK_BACKUP:' in line:
            data=line.split(b'IDENTITY_LINK_BACKUP:',1)[1]
            json.loads(data)
            run(['sudo','tee',str(backup/'identity-links.json')],input=data)
            run(['sudo','chmod','600',str(backup/'identity-links.json')])
    # HeyForm keys accounts by issuer plus subject. Preserve the existing owner
    # when this same IdP moves, instead of provisioning a second social account.
    mongo_snapshot=kube('exec','deploy/mongo','--','mongosh','--quiet','--eval',
        'print(EJSON.stringify({forms:db.getSiblingDB("heyform").usersocialaccountmodels.find({kind:"oidc"}).toArray(),chat:db.getSiblingDB("rocketchat").rocketchat_settings.find({_id:{$in:["Accounts_OAuth_Custom-Blakid-url","Site_Url"]}}).toArray()}))')
    run(['sudo','tee',str(backup/'identity-migration.json')],input=mongo_snapshot)
    run(['sudo','chmod','600',str(backup/'identity-migration.json')])
    migration='const config='+json.dumps(CONFIG)+';'+'''
const oldIssuer='https://id.'+config.domain+'/application/o/blak-forms/';
const newIssuer=config.tailnet.origins.id+'/application/o/blak-forms/';
const forms=db.getSiblingDB('heyform').usersocialaccountmodels;
for(const account of forms.find({kind:'oidc'}).toArray()) {
  if(!account.openId.startsWith(oldIssuer+'#')) continue;
  const openId=newIssuer+account.openId.slice(oldIssuer.length);
  if(forms.findOne({kind:'oidc',openId})) throw new Error('Target identity already exists');
  forms.updateOne({_id:account._id,openId:account.openId},{$set:{openId}});
}
const settings=db.getSiblingDB('rocketchat').rocketchat_settings;
let changed=0;
for(const [id,value] of [['Accounts_OAuth_Custom-Blakid-url',config.tailnet.origins.id+'/application/o'],['Site_Url',config.tailnet.origins.chat]]) {
  changed+=settings.updateOne({_id:id},{$set:{value}}).modifiedCount;
}
if(changed) print('Restart chat');
print('Application identity migration complete');
'''
    migration_result=kube('exec','deploy/mongo','--','mongosh','--quiet','--eval',migration)
    if b'Restart chat' in migration_result:
        kube('rollout','restart','deploy/chat')
        kube('rollout','status','deploy/chat','--timeout=300s')
    sync=json.loads(kube('get','secret','blak-hermes-sync','-o','json'))
    accounts=json.loads(base64.b64decode(sync['data']['accounts.json']))
    for account in accounts['accounts']:
        for source in account.get('sources',{}).values():
            public=source.get('public_base','')
            for app,origin in TAILNET['origins'].items():
                old='https://'+app+'.'+CONFIG['domain']
                if public==old or public.startswith(old+'/'):
                    source['public_base']=origin+public[len(old):]
    kube('patch','secret','blak-hermes-sync','--type=merge','--patch-file=/dev/stdin',
         input=json.dumps({'data':{'accounts.json':base64.b64encode(json.dumps(accounts).encode()).decode()}}).encode())
    print('Tailnet listeners configured; private rollback inventory:',backup)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print('Tailnet publication failed:',type(error).__name__)
        raise SystemExit(1)
