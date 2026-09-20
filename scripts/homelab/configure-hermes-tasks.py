#!/usr/bin/env python3
"""Reserve homelab CPU inference for answers, preserving unrelated task settings."""
import base64,json,subprocess

def kube(*args,**kwargs):
    return subprocess.run(['kubectl','-n','blak-micro',*args],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kwargs).stdout

try:
    secret=json.loads(kube('get','secret','blak-hermes-sync','-o','json'))
    accounts=json.loads(base64.b64decode(secret['data']['accounts.json']))['accounts']
    account=next(a for a in accounts if a['name']=='homelab-admin')
    code='''
import json,sys,urllib.request
token=json.load(sys.stdin)['token']
base='http://127.0.0.1:8080/api/v1/tasks/config'
headers={'Authorization':'Bearer '+token,'Content-Type':'application/json'}
def request(url,data=None):
    with urllib.request.urlopen(urllib.request.Request(url,headers=headers,data=json.dumps(data).encode() if data is not None else None),timeout=30) as response:return json.load(response)
config=request(base)
keys=['ENABLE_TITLE_GENERATION','ENABLE_TAGS_GENERATION','ENABLE_FOLLOW_UP_GENERATION','ENABLE_RETRIEVAL_QUERY_GENERATION']
if any(config[key] for key in keys):
    config.update({key:False for key in keys})
    request(base+'/update',config)
verified=request(base)
assert all(verified[key] is False for key in keys)
'''
    kube('exec','-i','deploy/hermes','--','python','-c',code,input=json.dumps({'token':account['hermes']['token']}).encode())
    print('Hermes CPU task settings verified')
except Exception as error:
    # Neither API credentials nor response bodies belong in deployment output.
    print('Hermes task configuration failed:',type(error).__name__)
    raise SystemExit(1)
