#!/usr/bin/env python3
"""Add/update one private sync mapping from an operator's mode-600 JSON file."""
import argparse, base64, json, os, stat, subprocess
from pathlib import Path
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('file',type=Path,help='JSON account mapping; never pass credentials as arguments')
parser.add_argument('--replace',action='store_true',help='Explicitly replace an existing mapping of the same name')
args=parser.parse_args()
if stat.S_IMODE(args.file.stat().st_mode) & 0o077: parser.error('Credential file must have mode 600')
mapping=json.loads(args.file.read_text())
for key in ('name','owner_id','portal_owner','hermes','sources'):
    if not mapping.get(key): parser.error('Missing '+key)
if not isinstance(mapping['sources'],dict): parser.error('sources must be an object')
allowed={'drive','outline','chat','projects','draw','flow','crm','storage'}
if not set(mapping['sources']) <= allowed: parser.error('Unknown source')
# Verify live Hermes identity before changing the mapping. Host resolves cluster service.
import urllib.request
ip=subprocess.check_output(['kubectl','-n','blak-micro','get','service','hermes','-o','jsonpath={.spec.clusterIP}'],text=True)
request=urllib.request.Request('http://'+ip+':8080/api/v1/auths/',headers={'Authorization':'Bearer '+mapping['hermes']['token']})
with urllib.request.urlopen(request,timeout=30) as response: owner=json.load(response)
if owner['id']!=mapping['owner_id']: parser.error('Hermes owner mismatch')
raw=json.loads(subprocess.check_output(['kubectl','-n','blak-micro','get','secret','blak-hermes-sync','-o','json']))
config=json.loads(base64.b64decode(raw['data']['accounts.json']))
existing=next((a for a in config['accounts'] if a['name']==mapping['name']),None)
if existing and not args.replace: parser.error('Mapping exists; use --replace deliberately')
if existing and existing['owner_id']!=mapping['owner_id']: parser.error('Cannot reassign an existing account owner')
if any(a['owner_id']==mapping['owner_id'] and a['name']!=mapping['name'] for a in config['accounts']): parser.error('Owner already has a mapping')
config['accounts']=[a for a in config['accounts'] if a['name']!=mapping['name']]+[mapping]
secret={'apiVersion':'v1','kind':'Secret','metadata':{'name':'blak-hermes-sync','namespace':'blak-micro'},'stringData':{'accounts.json':json.dumps(config)}}
subprocess.run(['kubectl','apply','-f','-'],input=json.dumps(secret).encode(),stdout=subprocess.DEVNULL,check=True)
print('Private mapping saved. Run connect-hermes-apps.js with BLAK_SYNC_ACCOUNT and this owner’s SSO credentials to verify app identities. Keep the credential file private.')
