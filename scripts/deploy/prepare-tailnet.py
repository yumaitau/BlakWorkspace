#!/usr/bin/env python3
"""Adapt a prepared release to one tailnet hostname, keeping database site identities."""
import argparse
import ipaddress
import json
from pathlib import Path
import re
import yaml

PORTS={'portal':443,'id':8444,'drive':8445,'docs':8446,'sites':8447,'projects':8448,'forms':8449,'crm':8450,'chat':8451,'hermes':8452,'vault':8453,'cloud':8454}
UPSTREAMS={'portal':'portal:3000','id':'authentik-server:9000','drive':'drive:9200','docs':'docs:9980','sites':'sites:3000','projects':'projects:5173','forms':'forms:9157','crm':'crm:3000','chat':'chat:3000','hermes':'hermes:8080','vault':'vault:8080','cloud':'floci-ui:4500'}


def configure(root,host,address,crm_site=None):
    if not re.fullmatch(r'[a-z0-9-]+\.[a-z0-9-]+\.ts\.net',host):
        raise ValueError('Expected the existing node DNS name ending in .ts.net')
    ipaddress.ip_address(address)
    metadata=json.loads((root/'.deployment.json').read_text())
    if metadata.get('tailnet'):raise ValueError('Prepare a fresh release before applying tailnet configuration')
    domain=metadata['domain']
    if crm_site is not None and not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}', crm_site):
        raise ValueError('Expected an existing Frappe site directory name')
    origins={app:'https://'+host+(':'+str(port) if port!=443 else '') for app,port in PORTS.items()}
    for path in root.rglob('*'):
        if not path.is_file() or path.is_symlink():continue
        try:original=path.read_text()
        except UnicodeError:continue
        text=original
        for app,origin in origins.items():
            for scheme in ['https','http']:
                text=text.replace(scheme+'://'+app+'.'+domain,origin)
            # Browser URL predicates must compare ports when all apps share a hostname.
            if 'e2e' in path.relative_to(root).parts or path.name=='shell.js' or path.name=='connect-hermes-apps.js':
                for quote in ("'", '"'):
                    text=text.replace(quote+app+'.'+domain+quote, quote+origin.removeprefix('https://')+quote)
                text=text.replace(app+'.'+domain.replace('.',r'\.'), origin.removeprefix('https://').replace('.',r'\.'))
                text=text.replace((app+'.'+domain).replace('.',r'\.'),origin.removeprefix('https://').replace('.',r'\.'))
                text=text.replace('.hostname','.host')
        text=text.replace('Domain='+domain,'Domain='+host)
        if text!=original:path.write_text(text)
    # Site directory names identify existing databases; public URL is separate.
    setup=root/'services/frappe/setup.py'
    if setup.exists():
        addition="site_config = SITES / SITE / 'site_config.json'\nsite_settings = json.loads(site_config.read_text())\nsite_settings['host_name'] = "+repr(origins['crm'])+"\nsite_config.write_text(json.dumps(site_settings))\n"
        text=setup.read_text().replace('import frappe\n', addition+'\nimport frappe\n')
        setup.write_text(text)
    runner=root/'scripts/deploy/test-e2e.sh'
    if runner.exists():runner.write_text(runner.read_text().replace('HOSTS=()', 'HOSTS=(--add-host '+repr(host+':'+address)+')'))
    # Preserve old routes while adding explicit port-aware tailnet origins.
    nginx=root/'services/workspace-shell/nginx.conf'
    text=nginx.read_text().replace('map $host $blak_upstream','map $http_host $blak_upstream')
    routes=''.join('  '+origins[app].removeprefix('https://')+' '+upstream.replace(':','.blak-micro.svc.cluster.local:')+';\n' for app,upstream in UPSTREAMS.items())
    text=text.replace("  default '';", "  default '';\n"+routes,1)
    text=text.replace('if ($host != drive.'+domain+')', 'if ($http_host != '+origins['drive'].removeprefix('https://')+')')
    text=text.replace('    proxy_pass http://$blak_upstream;', '    rewrite ^/application/o/[^/]+/(authorize|token|userinfo)/$ /application/o/$1/ break;\n    proxy_pass http://$blak_upstream;')
    nginx.write_text(text)
    # CoreDNS cannot always resolve MagicDNS names; use the node's verified tailnet IP.
    for path in (root/'deploy/k3s/micro').glob('*.yaml'):
        documents=list(yaml.safe_load_all(path.read_text()));changed=False
        for doc in documents:
            if doc and doc.get('kind')=='NetworkPolicy' and doc['metadata']['name']=='vault-internal':
                prefix=32 if ipaddress.ip_address(address).version==4 else 128
                doc['spec']['egress'].append({'to':[{'ipBlock':{'cidr':address+'/'+str(prefix)}}], 'ports':[{'protocol':'TCP','port':PORTS['id']}]})
                changed=True
            if doc and doc.get('kind') == 'CronJob' and doc['metadata']['name'] == 'hermes-workspace-sync':
                doc['spec']['jobTemplate']['spec']['template']['spec'].setdefault('hostAliases', []).append({'ip': address, 'hostnames': [host]})
                changed = True
            if not doc or doc.get('kind')!='Deployment':continue
            spec=doc['spec']['template']['spec']
            if doc['metadata']['name'] in ['portal','opencloud','collabora','outline','chat','projects','forms','frappe-crm','hermes','vault','blak-app-role-sync']:
                spec.setdefault('hostAliases',[]).append({'ip':address,'hostnames':[host]});changed=True
            if doc['metadata']['name']=='collabora':
                for container in spec['containers']:
                    for env in container.get('env',[]):
                        if env['name']=='domain':env['value']=re.escape(host)+'|drive'
                        if env['name']=='server_name':env['value']=origins['docs'].removeprefix('https://')
        if changed:path.write_text(yaml.safe_dump_all(documents,sort_keys=False))
    if crm_site:
        for relative in ('services/frappe/setup.py', 'services/frappe/enroll-roles.py'):
            path=root/relative
            path.write_text(path.read_text().replace("SITE = 'crm."+domain+"'", "SITE = "+repr(crm_site)))
        path=root/'deploy/k3s/micro/95-crm.yaml'
        docs=list(yaml.safe_load_all(path.read_text()))
        for doc in docs:
            if doc and doc.get('kind')=='Deployment' and doc['metadata']['name']=='frappe-crm':
                for container in doc['spec']['template']['spec']['containers']:
                    for env in container.get('env',[]):
                        if env['name']=='FRAPPE_SITE_NAME_HEADER':env['value']=crm_site
                    for header in container.get('readinessProbe',{}).get('httpGet',{}).get('httpHeaders',[]):
                        if header['name']=='Host':header['value']=crm_site
        path.write_text(yaml.safe_dump_all(docs,sort_keys=False))
    metadata['crm_site']=crm_site or 'crm.'+domain
    metadata['tailnet']={'host':host,'address':address,'origins':origins,'ports':PORTS}
    (root/'.deployment.json').write_text(json.dumps(metadata,indent=2)+'\n')
    return origins


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release',type=Path,required=True)
    parser.add_argument('--host',required=True)
    parser.add_argument('--address',required=True)
    parser.add_argument('--crm-site', help='Existing Frappe site directory; independent of public DNS')
    args=parser.parse_args()
    print(json.dumps(configure(args.release,args.host,args.address,args.crm_site),indent=2))
