#!/usr/bin/env python3
"""Publish a prepared tailnet release without replacing unrelated Serve listeners."""
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
        if listener and listener.get('Handlers')!={'/':{'Proxy':'http://127.0.0.1:18080'}}:
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
ListenStream=127.0.0.1:18080
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
        run(['sudo','tailscale','serve','--bg','--yes','--https='+str(port),'http://127.0.0.1:18080'])
    # Keep subjects, secrets and existing callbacks intact. Add exact new origins.
    source='''
import json
from dataclasses import replace
from authentik.providers.oauth2.models import OAuth2Provider
config=json.loads(CONFIG_JSON)
origins=config['tailnet']['origins']
domain=config['domain']
for provider in OAuth2Provider.objects.all():
    redirects=list(provider.redirect_uris)
    additions=[]
    for redirect in redirects:
        url=redirect.url
        for app,origin in origins.items():
            for scheme in ['http','https']:
                url=url.replace(scheme+'://'+app+'.'+domain,origin)
                url=url.replace(scheme+'://'+(app+'.'+domain).replace('.',r'\.'),origin.replace('.',r'\.'))
        item=replace(redirect,url=url)
        if item!=redirect and item not in redirects and item not in additions:additions.append(item)
    if additions:
        provider.redirect_uris=redirects+additions
        provider.save(update_fields=['redirect_uris'])
print('Existing OIDC providers retain identity and gain tailnet callbacks')
'''
    source='CONFIG_JSON='+repr(json.dumps(CONFIG))+'\n'+source
    kube('exec','-i','deploy/authentik-server','--','ak','shell',input=('exec('+repr(source)+')\n').encode())
    print('Tailnet listeners configured; private rollback inventory:',backup)


if __name__=='__main__':
    try:main()
    except Exception as error:
        print('Tailnet publication failed:',type(error).__name__)
        raise SystemExit(1)
