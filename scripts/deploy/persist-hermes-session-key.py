"""Preserve the running Hermes session key before its first persistent-key rollout."""
import subprocess,json,base64,os
ns=['kubectl','-n',os.environ.get('NS','blak-micro')]
secret=json.loads(subprocess.check_output(ns+['get','secret','blak-hermes','-o','json']))
if 'session-secret' not in secret['data']:
 value=subprocess.check_output(ns+['exec','deploy/hermes','--','cat','/app/backend/.webui_secret_key']).strip()
 secret['data']['session-secret']=base64.b64encode(value).decode()
 subprocess.run(ns+['apply','-f','-'],input=json.dumps(secret).encode(),check=True)
