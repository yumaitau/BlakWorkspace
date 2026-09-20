#!/usr/bin/env python3
"""Adapt a prepared release to one tailnet hostname, keeping database site identities."""
import argparse
import ipaddress
import json
from pathlib import Path
import re

PORTS={'portal':443,'id':8444,'drive':8445,'docs':8446,'sites':8447,'projects':8448,'forms':8449,'crm':8450,'chat':8451,'hermes':8452}
UPSTREAMS={'portal':'portal:3000','id':'authentik-server:9000','drive':'drive:9200','docs':'docs:9980','sites':'sites:3000','projects':'projects:5173','forms':'forms:9157','crm':'crm:3000','chat':'chat:3000','hermes':'hermes:8080'}


def configure(root,host,address):
    if not re.fullmatch(r'[a-z0-9-]+\.[a-z0-9-]+\.ts\.net',host):
        raise ValueError('Expected the existing node DNS name ending in .ts.net')
    ipaddress.ip_address(address)
    metadata=json.loads((root/'.deployment.json').read_text())
    if metadata.get('tailnet'):raise ValueError('Prepare a fresh release before applying tailnet configuration')
    domain=metadata['domain']
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
                text=text.replace("'"+app+'.'+domain+"'", "'"+origin.removeprefix('https://')+"'")
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
    # Preserve old routes while adding explicit port-aware tailnet origins.
    nginx=root/'services/workspace-shell/nginx.conf'
    text=nginx.read_text().replace('map $host $blak_upstream','map $http_host $blak_upstream')
    routes=''.join('  '+origins[app].removeprefix('https://')+' '+upstream.replace(':','.blak-micro.svc.cluster.local:')+';\n' for app,upstream in UPSTREAMS.items())
    text=text.replace("  default '';", "  default '';\n"+routes,1)
    text=text.replace('if ($host != drive.'+domain+')', 'if ($http_host != '+origins['drive'].removeprefix('https://')+')')
    assets='<link rel="stylesheet" href="/_blak/shell.css"><script src="/_blak/shell.js" defer></script>'
    text='map $http_host $blak_assets { default \''+assets+'\'; '+origins['id'].removeprefix('https://')+' \"\"; }\n'+text
    text=text.replace("sub_filter '</head>' '"+assets+"</head>';", "sub_filter '</head>' '$blak_assets</head>';")
    text=text.replace('    proxy_pass http://$blak_upstream;', '    rewrite ^/application/o/[^/]+/(authorize|token|userinfo)/$ /application/o/$1/ break;\n    proxy_pass http://$blak_upstream;')
    nginx.write_text(text)
    # CoreDNS cannot always resolve MagicDNS names; use the node's verified tailnet IP.
    import yaml
    for path in (root/'deploy/k3s/micro').glob('*.yaml'):
        documents=list(yaml.safe_load_all(path.read_text()));changed=False
        for doc in documents:
            if not doc or doc.get('kind')!='Deployment':continue
            spec=doc['spec']['template']['spec']
            if doc['metadata']['name'] in ['portal','opencloud','collabora','outline','chat','projects','forms','frappe-crm','hermes']:
                spec.setdefault('hostAliases',[]).append({'ip':address,'hostnames':[host]});changed=True
            if doc['metadata']['name']=='collabora':
                for container in spec['containers']:
                    for env in container.get('env',[]):
                        if env['name']=='domain':env['value']=re.escape(host)+'|drive'
        if changed:path.write_text(yaml.safe_dump_all(documents,sort_keys=False))
    metadata['tailnet']={'host':host,'address':address,'origins':origins,'ports':PORTS}
    (root/'.deployment.json').write_text(json.dumps(metadata,indent=2)+'\n')
    return origins


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release',type=Path,required=True)
    parser.add_argument('--host',required=True)
    parser.add_argument('--address',required=True)
    args=parser.parse_args()
    print(json.dumps(configure(args.release,args.host,args.address),indent=2))
