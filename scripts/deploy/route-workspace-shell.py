"""Patch only known app routes after the shell is healthy; preserve TLS/middleware."""
import json
import subprocess
HOSTS = {'portal','drive','sites','projects','crm','forms','chat','hermes','docs'}
def kube(*args, data=None):
    return subprocess.check_output(['kubectl','-n','blak-micro',*args],input=data,text=True)
for item in json.loads(kube('get','ingressroute','-o','json'))['items']:
    routes=item['spec']['routes']
    changed=False
    for route in routes:
        if route.get('middlewares'): continue
        if route['match'] in {f'Host(`{host}.workspace.example.com`)' for host in HOSTS}:
            route['services']=[{'name':'workspace-shell','port':8080}]
            changed=True
    if changed:
        kube('patch','ingressroute',item['metadata']['name'],'--type=json','-p',json.dumps([{'op':'replace','path':'/spec/routes','value':routes}]))
print('Workspace app routes use shared shell; identity and WOPI redirects retained')
