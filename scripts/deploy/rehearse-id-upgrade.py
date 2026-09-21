"""Rehearse sequential Blak ID migrations against an isolated database copy."""
import copy
import json
import os
from pathlib import Path
import subprocess
import time

VERSIONS = ['2025.8.6', '2025.10.4', '2025.12.6', '2026.2.7', '2026.5.7', '2026.8.3']
KUBE = ['kubectl', '-n', 'blak-micro']

def kube(*args, data=None):
    return subprocess.check_output(KUBE + list(args), input=data, stderr=subprocess.PIPE)

def sql(statement):
    return kube('exec', '-i', 'deploy/postgres', '--', 'psql', '-U', 'blak', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At', data=statement.encode())

def main():
    os.umask(0o077)
    stamp = str(int(time.time()))
    directory = Path('/tmp/blak-id-upgrade-' + stamp)
    directory.mkdir(mode=0o700)
    database = 'blak_id_trial_' + stamp
    deployment = json.loads(kube('get', 'deploy', 'authentik-server', '-o', 'json'))
    (directory / 'server.json').write_text(json.dumps(deployment))
    (directory / 'worker.json').write_bytes(kube('get', 'deploy', 'authentik-worker', '-o', 'json'))
    dump = kube('exec', 'deploy/postgres', '--', 'pg_dump', '-U', 'blak', '-d', 'authentik', '-Fc')
    (directory / 'authentik.dump').write_bytes(dump)
    sql('CREATE DATABASE ' + database + ';')
    kube('exec', '-i', 'deploy/postgres', '--', 'pg_restore', '-U', 'blak', '-d', database, '--exit-on-error', data=dump)
    print('Backup and isolated database ready: ' + str(directory), flush=True)
    policy = {'apiVersion':'networking.k8s.io/v1','kind':'NetworkPolicy','metadata':{'name':'blak-id-trial-'+stamp},'spec':{'podSelector':{'matchLabels':{'blak-id-trial':stamp}},'policyTypes':['Ingress','Egress'],'ingress':[],'egress':[{'to':[{'podSelector':{'matchLabels':{'app':'postgres'}}}],'ports':[{'port':5432}]},{'to':[{'podSelector':{'matchLabels':{'app':'valkey'}}}],'ports':[{'port':6379}]},{'to':[{'namespaceSelector':{'matchLabels':{'kubernetes.io/metadata.name':'kube-system'}}}],'ports':[{'port':53,'protocol':'UDP'},{'port':53,'protocol':'TCP'}]}]}}
    kube('apply','-f','-',data=json.dumps(policy).encode())
    for version in VERSIONS:
        name = 'blak-id-trial-' + stamp + '-' + version.replace('.', '-')
        container = copy.deepcopy(deployment['spec']['template']['spec']['containers'][0])
        container.update(name='migrate',image='ghcr.io/goauthentik/server:'+version,command=['python'],args=['-m','lifecycle.migrate'],resources={'requests':{'cpu':'250m','memory':'512Mi'},'limits':{'cpu':'2','memory':'2Gi'}})
        for key in ['readinessProbe','livenessProbe','startupProbe','ports','volumeMounts']:
            container.pop(key,None)
        container['env'] = [e for e in container['env'] if not e['name'].startswith('AUTHENTIK_BOOTSTRAP_')]
        for env in container['env']:
            if env['name'] == 'AUTHENTIK_POSTGRESQL__NAME': env['value'] = database
        job = {'apiVersion':'batch/v1','kind':'Job','metadata':{'name':name},'spec':{'backoffLimit':0,'activeDeadlineSeconds':900,'template':{'metadata':{'labels':{'blak-id-trial':stamp}},'spec':{'restartPolicy':'Never','containers':[container]}}}}
        kube('create','-f','-',data=json.dumps(job).encode())
        print('Rehearsing ' + version, flush=True)
        while True:
            status = json.loads(kube('get','job',name,'-o','json'))['status']
            if status.get('succeeded'): break
            if status.get('failed'):
                (directory / (version+'.log')).write_bytes(kube('logs','job/'+name))
                raise RuntimeError('Migration failed; private log: '+str(directory/(version+'.log')))
            time.sleep(5)
        (directory / (version+'.log')).write_bytes(kube('logs','job/'+name))
        print('Passed ' + version, flush=True)
    # Django migrations alone cannot prove that the runtime can start. Exercise
    # the real entrypoint and HTTP readiness against the isolated database too.
    container.pop('command', None)
    container['args'] = ['server']
    container['name'] = 'server'
    container['readinessProbe'] = {'httpGet': {'path': '/-/health/ready/', 'port': 9000}, 'periodSeconds': 5}
    pod_name = 'blak-id-trial-' + stamp + '-server'
    pod = {'apiVersion': 'v1', 'kind': 'Pod', 'metadata': {'name': pod_name, 'labels': {'blak-id-trial': stamp}}, 'spec': {'restartPolicy': 'Never', 'containers': [container]}}
    kube('create', '-f', '-', data=json.dumps(pod).encode())
    kube('wait', '--for=condition=Ready', 'pod/' + pod_name, '--timeout=240s')
    print('Passed real server startup and HTTP readiness', flush=True)
    kube('delete', 'pod', pod_name, '--wait=false')
    (directory/'result.json').write_text(json.dumps({'database':database,'versions':VERSIONS,'status':'passed','policy':policy['metadata']['name']}))
    print('REHEARSAL_PASSED '+str(directory), flush=True)

if __name__ == '__main__': main()
