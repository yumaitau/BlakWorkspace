"""Persist a Collabora WOPI signing key; never disable proof verification."""
import json,subprocess
args=['kubectl','-n','blak-micro']
if not subprocess.check_output([*args,'get','secret','blak-docs-proof-key','--ignore-not-found','-o','name']).strip():
    key=subprocess.check_output(['openssl','genrsa','-traditional','4096'],stderr=subprocess.DEVNULL).decode()
    subprocess.run([*args,'create','-f','-'],input=json.dumps({'apiVersion':'v1','kind':'Secret','metadata':{'name':'blak-docs-proof-key','namespace':'blak-micro'},'stringData':{'proof_key':key}}).encode(),check=True,stdout=subprocess.DEVNULL)
print('Docs proof key configured')
