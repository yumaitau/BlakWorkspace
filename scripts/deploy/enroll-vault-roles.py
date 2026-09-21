#!/usr/bin/env python3
"""Validate and enrol a native Vault organization/controller from JSON on stdin.

Input: organization_id, collection_ids, controller_user_id, client_id,
client_secret. No master password, private key or vault item data is accepted.
Run from a prepared release, with kubectl and network access to the Vault origin.
"""
import json
from pathlib import Path
import subprocess
import sys
import uuid

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'services/app-roles'))
from http_client import API
from enrollment import save_app

KUBE=['kubectl','-n','blak-micro']


def main():
    data=json.load(sys.stdin)
    if set(data)!={'organization_id','collection_ids','controller_user_id','client_id','client_secret'}:
        raise ValueError('Provide only native organization IDs and controller API credentials')
    metadata=json.loads((ROOT/'.deployment.json').read_text())
    origins=metadata.get('tailnet',{}).get('origins',{})
    base=origins.get('vault','https://vault.'+metadata['domain'])
    issuer=origins.get('id','https://id.'+metadata['domain'])+'/application/o/blak-vault/'
    owner=str(uuid.UUID(data['controller_user_id']))
    org=str(uuid.UUID(data['organization_id']))
    collections={str(uuid.UUID(value)) for value in data['collection_ids']}
    if not collections or data['client_id']!='user.'+owner:
        raise ValueError('Explicit collections and matching controller user API key required')
    api=API(base)
    api.login_api_key(data['client_id'],data['client_secret'])
    profile=api('GET','/api/accounts/profile')
    if profile['id']!=owner:raise ValueError('Controller identity mismatch')
    memberships=api('GET','/api/organizations/'+org+'/users')['data']
    member=next((m for m in memberships if m['userId']==owner),None)
    if not member or member['type']!=0 or member['status']!=2:
        raise ValueError('Controller must be a confirmed native organization owner')
    available=api('GET','/api/organizations/'+org+'/collections')['data']
    if not collections<={c['id'] for c in available}:
        raise ValueError('Configured collections do not belong to organization')
    save_app(KUBE, 'vault', {**data,'organization_id':org,'controller_user_id':owner,
                           'base':'http://vault:8080','issuer':issuer,'collection_ids':sorted(collections)})
    print('Native controller and collection ownership verified; role credentials enrolled')
    print('Enable the role controller only for an organization dedicated to Blak ID-managed membership.')


if __name__=='__main__':
    try:main()
    except Exception as error:
        print('Vault role enrollment failed: '+type(error).__name__)
        raise SystemExit(1)
