#!/usr/bin/env python3
"""Encrypted, consistent single-node PVC backup and isolated database restore drill."""
import argparse, base64, datetime, fcntl, hashlib, json, os, secrets, signal, shutil, sqlite3, subprocess, tarfile, tempfile, time
from pathlib import Path
NS='blak-micro'
RESTORE_LABEL='com.blakworkspace.restore-drill=true'
os.umask(0o077)
os.environ.setdefault('KUBECONFIG','/etc/rancher/k3s/k3s.yaml')
def run(*args, **kwargs):
    return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kwargs).stdout
def kube(*args):
    timeout='330s' if args[0]=='rollout' else '30s'
    return run('kubectl','--request-timeout='+timeout,'-n',NS,*args).decode()
def cleanup_restore():
    containers=run('docker','ps','-aq','--filter','label='+RESTORE_LABEL).decode().split()
    if containers:run('docker','rm','-f',*containers)
def secret_text(resources,name,key):
    resource=next(r for r in resources if r['kind']=='Secret' and r['metadata']['name']==name)
    return base64.b64decode(resource['data'][key]).decode()
def recover_after_snapshot(root,error):
    try:recover(root)
    except Exception as recovery_error:
        if error is None:raise
        print('Recovery failed:',type(recovery_error).__name__,'Run workspace-backup.py recover.',flush=True)
    if error is not None:raise error
def digest(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def atomic(path,data):
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps(data,indent=2));temp.replace(path)
def recover(root):
    journal=root/'resume.json'
    if not journal.exists():return
    state=json.loads(journal.read_text())
    # Start storage before clients. All original replica counts are restored.
    priority=['postgres','mongo','frappe-db','frappe-cache','forms-cache','valkey','hermes-sessions','crm-db','crm-cache']
    for storage in (True,False):
        group={name:count for name,count in state['replicas'].items() if (name in priority)==storage}
        for name,count in group.items():kube('scale','deploy/'+name,'--replicas='+str(count))
        for name,count in group.items():
            if count:kube('rollout','status','deploy/'+name,'--timeout=300s')
    for name,suspended in state['crons'].items():kube('patch','cronjob',name,'--type=merge','-p',json.dumps({'spec':{'suspend':suspended}}))
    journal.unlink()
def snapshot(root,key):
    recover(root)
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output=root/('workspace-'+stamp+'.tar.gpg')
    with tempfile.TemporaryDirectory(prefix='snapshot-',dir=root) as tmp:
        stage=Path(tmp);(stage/'volumes').mkdir()
        resources=json.loads(kube('get','deploy,service,configmap,secret,pvc,cronjob,ingressroute,middleware','-o','json'))
        atomic(stage/'resources.json',resources)
        pvs=json.loads(run('kubectl','get','pv','-o','json'))['items']
        volumes={p['spec']['claimRef']['name']:p['spec'].get('hostPath',p['spec'].get('local',{})).get('path') for p in pvs if p['spec'].get('claimRef',{}).get('namespace')==NS}
        if not volumes or any(not p or not Path(p).is_dir() for p in volumes.values()):raise RuntimeError('Volume inventory is incomplete')
        # Downloadable Ollama weights can be re-pulled. Every data PVC is captured.
        volumes.pop('ollama-data',None)
        deploys=[r for r in resources['items'] if r['kind']=='Deployment']
        replicas={d['metadata']['name']:d['spec'].get('replicas',1) for d in deploys if d['metadata']['name'] not in {'ollama','workspace-shell'}}
        crons={r['metadata']['name']:r['spec'].get('suspend',False) for r in resources['items'] if r['kind']=='CronJob'}
        atomic(root/'resume.json',{'replicas':replicas,'crons':crons})
        snapshot_error=None
        try:
            for name in crons:kube('patch','cronjob',name,'--type=merge','-p','{"spec":{"suspend":true}}')
            deadline=time.monotonic()+900
            while any(j.get('status',{}).get('active',0) for j in json.loads(kube('get','jobs','-o','json'))['items']):
                if time.monotonic()>deadline:raise RuntimeError('Active jobs did not finish')
                time.sleep(2)
            for name in replicas:kube('scale','deploy/'+name,'--replicas=0')
            deadline=time.monotonic()+180
            while any(p['metadata'].get('labels',{}).get('app') in replicas and p['status']['phase'] not in {'Succeeded','Failed'} for p in json.loads(kube('get','pods','-o','json'))['items']):
                if time.monotonic()>deadline:raise RuntimeError('Workloads did not quiesce')
                time.sleep(2)
            for name,path in volumes.items():run('cp','-a','--reflink=auto',path,str(stage/'volumes'/name))
        except Exception as error:snapshot_error=error
        finally:recover_after_snapshot(root,snapshot_error)
        checks={str(p.relative_to(stage)):digest(p) for p in stage.rglob('*') if p.is_file() and not p.is_symlink()}
        atomic(stage/'manifest.json',{'created_at':stamp,'namespace':NS,'volumes':sorted(volumes),'excluded':{'ollama-data':'Downloadable model weights; re-pull after restore'},'sha256':checks})
        tar=subprocess.Popen(['tar','-C',str(stage),'-cf','-','.'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        try:run('gpg','--batch','--yes','--pinentry-mode','loopback','--passphrase-file',str(key),'--symmetric','--cipher-algo','AES256','--output',str(output)+'.partial',stdin=tar.stdout)
        finally:tar.stdout.close()
        if tar.wait()!=0:raise RuntimeError('Archive creation failed')
        Path(str(output)+'.partial').replace(output)
    atomic(root/'last-backup.json',{'file':output.name,'sha256':digest(output),'completed_at':int(time.time()),'volumes':len(volumes)})
    # Retain at least seven complete snapshots; incomplete files never count.
    for old in sorted(root.glob('workspace-*.tar.gpg'))[:-7]:old.unlink()
    print('Backup complete:',output.name,'volumes:',len(volumes),flush=True)
    return output

def restore_drill(root,key,archive):
    started=time.time();containers=[]
    with tempfile.TemporaryDirectory(prefix='restore-',dir=root) as tmp:
        stage=Path(tmp);plain=stage/'backup.tar'
        run('gpg','--batch','--pinentry-mode','loopback','--passphrase-file',str(key),'--decrypt','--output',str(plain),str(archive))
        # Runtime asset symlinks may point outside a PVC. Keep them archived,
        # but do not materialize external links in the isolated data drill.
        def data_filter(member, destination):
            try:return tarfile.data_filter(member, destination)
            except (tarfile.AbsoluteLinkError, tarfile.LinkOutsideDestinationError):return None
        with tarfile.open(plain) as tar:tar.extractall(stage/'data',filter=data_filter)
        plain.unlink();data=stage/'data';manifest=json.loads((data/'manifest.json').read_text())
        for path,expected in manifest['sha256'].items():
            if digest(data/path)!=expected:raise RuntimeError('Restore checksum mismatch')
        resources=json.loads((data/'resources.json').read_text())['items']
        evidence={'files_verified':len(manifest['sha256']),'volumes_verified':len(manifest['volumes']),'database_checks':{}}
        try:
            for deployment,volume,mount in [('postgres','postgres-data','/var/lib/postgresql/data'),('frappe-db','frappe-db-data','/var/lib/mysql'),('mongo','mongo-data','/data/db')]:
                d=next(r for r in resources if r['kind']=='Deployment' and r['metadata']['name']==deployment)
                c=d['spec']['template']['spec']['containers'][0];name='blak-restore-'+deployment+'-'+secrets.token_hex(4);containers.append(name)
                # No network, no ports, copied volumes only. Never run application workers.
                # data_filter strips owners; entrypoints restore database ownership.
                # Parent mount must remain traversable after privilege drop.
                (data/'volumes'/volume).chmod(0o755)
                options=['-e','PGDATA=/var/lib/postgresql/data/pgdata'] if deployment=='postgres' else []
                run('docker','run','-d','--name',name,'--label',RESTORE_LABEL,'--network','none','--memory','768m','--cpus','1',*options,'-v',str(data/'volumes'/volume)+':'+mount,c['image'])
                if deployment=='postgres':
                    user=secret_text(resources,'blak-core','postgres-user')
                    command=['psql','-U',user,'-d','portal','-Atc',"SELECT count(*) FROM pg_database WHERE NOT datistemplate;"]
                elif deployment=='frappe-db':
                    # Password through stdin, never command line or logs.
                    command=['sh','-c','read -r MYSQL_PWD; export MYSQL_PWD; mariadb -u root -N -e "SELECT COUNT(*) FROM information_schema.tables WHERE TABLE_SCHEMA NOT IN (\'mysql\',\'information_schema\',\'performance_schema\',\'sys\');"']
                else:command=['mongosh','--quiet','--eval','db.adminCommand({listDatabases:1}).databases.length']
                deadline=time.monotonic()+120
                while True:
                    try:
                        password=secret_text(resources,'blak-frappe','database-password') if deployment=='frappe-db' else None
                        args=['docker','exec']+(['-i'] if deployment=='frappe-db' else [])+[name,*command]
                        value=run(*args,input=(password+'\n').encode() if deployment=='frappe-db' and password else None).decode().strip()
                        if not value.isdigit() or int(value)<1:raise RuntimeError('Restored database empty')
                        evidence['database_checks'][deployment]=int(value);break
                    except (subprocess.CalledProcessError,RuntimeError):
                        if run('docker','inspect','--format','{{.State.Running}}',name).strip()!=b'true':raise RuntimeError('Restored database stopped: '+deployment)
                        if time.monotonic()>deadline:raise RuntimeError('Isolated restored database validation failed: '+deployment)
                        time.sleep(2)
            db=data/'volumes/webui-data/webui.db'
            with sqlite3.connect(db) as con:
                if con.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Hermes SQLite corruption')
                evidence['database_checks']['hermes']='integrity_check ok'
            for path in (data/'volumes/portal-flow-data').rglob('*.json'):json.loads(path.read_text())
            evidence.update(archive=archive.name,completed_at=int(time.time()),duration_seconds=round(time.time()-started),network='none')
            atomic(root/'last-restore-drill.json',evidence)
            print('Restore drill passed:',json.dumps(evidence),flush=True)
        finally:
            for name in containers:subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['snapshot','restore-drill','recover','cleanup-restore']);parser.add_argument('--root',type=Path,default=Path('/var/backups/blak-workspace'));parser.add_argument('--key',type=Path,default=Path('/etc/blak-backup/key'));parser.add_argument('--archive',type=Path)
    args=parser.parse_args();args.root.mkdir(parents=True,exist_ok=True,mode=0o700)
    if args.action=='cleanup-restore':cleanup_restore();return
    lock=open(args.root/'lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if args.action=='recover':recover(args.root);return
    if not args.key.exists():raise RuntimeError('Backup key must be provisioned separately')
    if args.key.stat().st_mode & 0o077:raise RuntimeError('Backup key must be private')
    if args.action=='snapshot':snapshot(args.root,args.key)
    else:restore_drill(args.root,args.key,args.archive or sorted(args.root.glob('workspace-*.tar.gpg'))[-1])
if __name__=='__main__':
    def terminate(signum,frame):raise InterruptedError('Backup service stopped')
    signal.signal(signal.SIGTERM,terminate)
    try:main()
    except Exception as error:
        # Subprocess exceptions may include sensitive output: never print their details.
        print('Backup operation failed:',type(error).__name__,flush=True);raise SystemExit(1)
