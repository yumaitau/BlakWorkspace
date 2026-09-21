"""Apply a rehearsed sequential Authentik upgrade on the cluster node.

The rehearsal result is required. An offline database backup and both deployment
specifications are saved before the first migration. Failure leaves Authentik
stopped; restore the database backup before restoring the old deployments.
"""
import argparse
import copy
import json
import os
from pathlib import Path
import subprocess
import time
from importlib.util import spec_from_file_location, module_from_spec

spec = spec_from_file_location('rehearsal', Path(__file__).with_name('rehearse-id-upgrade.py'))
rehearsal = module_from_spec(spec)
spec.loader.exec_module(rehearsal)
kube, VERSIONS = rehearsal.kube, rehearsal.VERSIONS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rehearsal', type=Path, required=True)
    parser.add_argument('--id-origin', required=True)
    args = parser.parse_args()
    result = json.loads((args.rehearsal / 'result.json').read_text())
    assert result['status'] == 'passed' and result['versions'] == VERSIONS
    assert result.get('lifecycle') is True and result.get('server_ready') is True, 'A full lifecycle and server-startup rehearsal is required'
    assert args.id_origin.startswith('https://')
    os.umask(0o077)
    stamp = str(int(time.time()))
    directory = Path('/tmp/blak-id-live-upgrade-' + stamp)
    directory.mkdir(mode=0o700)
    deployments = {}
    for name in ['authentik-server', 'authentik-worker']:
        deployment = json.loads(kube('get', 'deploy', name, '-o', 'json'))
        assert deployment['spec']['template']['spec']['containers'][0]['image'] in ['ghcr.io/goauthentik/server:2025.6', 'ghcr.io/goauthentik/server:2025.6.4']
        deployments[name] = deployment
        (directory / (name + '.json')).write_text(json.dumps(deployment))
    inspect = 'from authentik.root.celery import CELERY_APP\ni = CELERY_APP.control.inspect(timeout=3)\nactive=i.active(); reserved=i.reserved()\nassert active is not None and reserved is not None, "worker did not respond"\nassert not any(active.values()) and not any(reserved.values()), "worker still has work"\nprint("WORKER_DRAINED")'
    check = kube('exec','-i','deploy/authentik-server','--','ak','shell',data=('exec('+repr(inspect)+')\n').encode())
    assert b'WORKER_DRAINED' in check, 'Worker drain check failed'
    for name in deployments:
        kube('scale', 'deploy/' + name, '--replicas=0')
    for name in deployments:
        kube('wait', '--for=delete', 'pod', '-l', 'app=' + name, '--timeout=180s')
    (directory / 'authentik.dump').write_bytes(kube('exec','deploy/postgres','--','pg_dump','-U','blak','-d','authentik','-Fc'))
    print('Offline backup: ' + str(directory), flush=True)
    for version in VERSIONS:
        name = 'blak-id-upgrade-' + stamp + '-' + version.replace('.', '-')
        container = copy.deepcopy(deployments['authentik-server']['spec']['template']['spec']['containers'][0])
        container.update(name='migrate',image='ghcr.io/goauthentik/server:'+version,command=['python'],args=['-m','lifecycle.migrate'])
        for key in ['readinessProbe','livenessProbe','startupProbe','ports','volumeMounts']:
            container.pop(key,None)
        container['env'] = [e for e in container['env'] if not e['name'].startswith('AUTHENTIK_BOOTSTRAP_')]
        job = {'apiVersion':'batch/v1','kind':'Job','metadata':{'name':name},'spec':{'backoffLimit':0,'activeDeadlineSeconds':900,'template':{'spec':{'restartPolicy':'Never','containers':[container]}}}}
        kube('create','-f','-',data=json.dumps(job).encode())
        print('Migrating ' + version, flush=True)
        while True:
            status=json.loads(kube('get','job',name,'-o','json'))['status']
            if status.get('succeeded'): break
            if status.get('failed'):
                (directory/(version+'.log')).write_bytes(kube('logs','job/'+name))
                raise RuntimeError('Migration failed. Keep Authentik stopped; offline backup: '+str(directory))
            time.sleep(5)
        (directory/(version+'.log')).write_bytes(kube('logs','job/'+name))
        print('Passed ' + version, flush=True)
    for name, deployment in deployments.items():
        container=deployment['spec']['template']['spec']['containers'][0]
        container['image']='ghcr.io/goauthentik/server:'+VERSIONS[-1]
        container['env']=[e for e in container['env'] if not e['name'].startswith('AUTHENTIK_REDIS__')]
        container['env'] += [{'name':'AUTHENTIK_LISTEN__TRUSTED_PROXY_CIDRS','value':'127.0.0.0/8,10.42.0.0/16,::1/128'}, {'name':'AUTHENTIK_WEB__BASE_URL','value':args.id_origin}]
        patch={'spec':{'replicas':deployment['spec']['replicas'],'template':deployment['spec']['template']}}
        kube('patch','deploy',name,'--type=merge','--patch-file=/dev/stdin',data=json.dumps(patch).encode())
    for name in deployments:
        kube('rollout','status','deploy/'+name,'--timeout=300s')
        current=json.loads(kube('get','deploy',name,'-o','json'))
        expected=deployments[name]['spec']['replicas']
        assert expected > 0 and current['spec']['replicas'] == expected
        assert current['status'].get('readyReplicas',0) == expected, name + ' is not ready'
    (directory/'result.json').write_text(json.dumps({'status':'passed','version':VERSIONS[-1]}))
    print('LIVE_UPGRADE_PASSED '+str(directory),flush=True)


if __name__ == '__main__': main()
