#!/usr/bin/env python3
"""Encrypted, consistent single-node PVC backup and isolated database restore drill."""
import argparse, base64, contextlib, datetime, fcntl, hashlib, json, os, secrets, signal, shutil, sqlite3, subprocess, sys, tarfile, tempfile, time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import backup_places
NS='blak-micro'
PLACES=Path('/etc/blak-backup/places.json')
# The agent token must survive a restore, or the portal loses the agent.
KEEP_SECRETS={'blak-backup-agent'}
SKIP_SECRET_TYPES={'kubernetes.io/service-account-token','helm.sh/release.v1'}
RESTORE_LABEL='com.blakworkspace.restore-drill=true'
os.umask(0o077)
os.environ.setdefault('KUBECONFIG','/etc/rancher/k3s/k3s.yaml')
def run(*args, **kwargs):
    return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kwargs).stdout
def kube(*args,**kwargs):
    timeout='330s' if args[0]=='rollout' else '30s'
    return run('kubectl','--request-timeout='+timeout,'-n',NS,*args,**kwargs).decode()
def cleanup_restore():
    containers=run('docker','ps','-aq','--filter','label='+RESTORE_LABEL).decode().split()
    if containers:run('docker','rm','-f',*containers)
def secret_text(resources,name,key):
    resource=next(r for r in resources if r['kind']=='Secret' and r['metadata']['name']==name)
    return base64.b64decode(resource['data'][key]).decode()
def restore_database_plan(resources,volumes):
    plan=[('postgres','postgres-data','/var/lib/postgresql/data'),('frappe-db','frappe-db-data','/var/lib/mysql'),('mongo','mongo-data','/data/db')]
    smith=any(r['kind']=='Deployment' and r['metadata']['name']=='smith-postgres' for r in resources)
    if smith != ('smith-pgdata' in volumes):raise RuntimeError('Smith database inventory is incomplete')
    if smith:
        try:key=secret_text(resources,'blak-smith','kek')
        except (StopIteration,KeyError,ValueError):raise RuntimeError('Smith recovery key is missing') from None
        if not key:raise RuntimeError('Smith recovery key is missing')
        plan.append(('smith-postgres','smith-pgdata','/var/lib/postgresql'))
    return plan
def check_eyes_database(data,volumes):
    if 'eyes-data' not in volumes:return None
    db=data/'volumes/eyes-data/blakeyes.sqlite3'
    if not db.is_file():raise RuntimeError('Eyes database missing from restore')
    with sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True) as con:
        if con.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Eyes SQLite corruption')
        if con.execute('PRAGMA foreign_key_check').fetchone():raise RuntimeError('Eyes foreign key corruption')
    return 'integrity_check and foreign_key_check ok'
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
def progress(root,step):
    atomic(root/'progress.json',{'step':step,'at':int(time.time())})
def volume_paths():
    pvs=json.loads(run('kubectl','get','pv','-o','json'))['items']
    return {p['spec']['claimRef']['name']:p['spec'].get('hostPath',p['spec'].get('local',{})).get('path') for p in pvs if p['spec'].get('claimRef',{}).get('namespace')==NS}
def quiesce(root,items):
    """Record replica counts, then stop CronJobs and scale workloads to zero. recover() undoes it."""
    deploys=[r for r in items if r['kind']=='Deployment']
    replicas={d['metadata']['name']:d['spec'].get('replicas',1) for d in deploys if d['metadata']['name'] not in {'ollama','workspace-shell'}}
    crons={r['metadata']['name']:r['spec'].get('suspend',False) for r in items if r['kind']=='CronJob'}
    atomic(root/'resume.json',{'replicas':replicas,'crons':crons})
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
def recover(root):
    rollback_restore(root)
    journal=root/'resume.json'
    if not journal.exists():return
    state=json.loads(journal.read_text())
    # Start storage before clients. All original replica counts are restored.
    priority=['postgres','mongo','frappe-db','frappe-cache','forms-cache','valkey','hermes-sessions','crm-db','crm-cache','smith-postgres','smith-redis']
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
        volumes=volume_paths()
        if not volumes or any(not p or not Path(p).is_dir() for p in volumes.values()):raise RuntimeError('Volume inventory is incomplete')
        # Downloadable Ollama weights can be re-pulled. Every data PVC is captured.
        volumes.pop('ollama-data',None)
        snapshot_error=None
        try:
            progress(root,'Pausing apps')
            quiesce(root,resources['items'])
            progress(root,'Copying data')
            for name,path in volumes.items():run('cp','-a','--reflink=auto',path,str(stage/'volumes'/name))
        except Exception as error:snapshot_error=error
        finally:
            progress(root,'Starting apps again')
            recover_after_snapshot(root,snapshot_error)
        progress(root,'Encrypting the backup')
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
    send_to_places(root,output)
    return output

def send_to_places(root,output,places_file=PLACES):
    """Copy the finished archive to every extra place. One failing place never fails the backup."""
    results={}
    for place in backup_places.load(places_file):
        progress(root,'Copying to '+place['name'])
        try:
            with backup_places.open_place(place) as target:
                target.put(output);backup_places.prune(target,place.get('keep',7))
            results[place['id']]={'ok':True,'file':output.name,'at':int(time.time())}
        except Exception as error:
            # Place errors are written for admins. Anything else may hold host detail.
            message=str(error) if isinstance(error,backup_places.PlaceError) else 'Copy failed ('+type(error).__name__+')'
            results[place['id']]={'ok':False,'error':message,'at':int(time.time())}
            print('Copy to place failed:',place['id'],message,flush=True)
    atomic(root/'places-status.json',results)

def restorable_secrets(items):
    return {s['metadata']['name']:{'apiVersion':'v1','kind':'Secret','type':s.get('type','Opaque'),'metadata':{'name':s['metadata']['name'],'namespace':NS,'labels':s['metadata'].get('labels',{})},'data':s.get('data',{})}
            for s in items if s['kind']=='Secret' and s.get('type','Opaque') not in SKIP_SECRET_TYPES and s['metadata']['name'] not in KEEP_SECRETS}
def put_secrets(secrets_by_name):
    for secret in secrets_by_name.values():kube('replace','-f','-',input=json.dumps(secret).encode())
def move(source,target):
    try:os.rename(source,target)
    except OSError:
        run('cp','-a','--reflink=auto',str(source),str(target));shutil.rmtree(source)
def rollback_restore(root):
    """Undo an unfinished full restore: put the live data and secrets back as they were."""
    journal=root/'restore-journal.json'
    if not journal.exists():return
    state=json.loads(journal.read_text())
    for entry in reversed(state['swapped']):
        live,aside=Path(entry['path']),Path(entry['aside'])
        if not aside.exists():continue
        if live.exists():shutil.rmtree(live)
        os.rename(aside,live)
    if state.get('secrets_changed'):put_secrets(state['secrets'])
    journal.unlink()
    print('Unfinished restore rolled back to the data from before it started.',flush=True)
def fetch_archive(root,name,place_id,places_file=PLACES):
    place=next((p for p in backup_places.load(places_file) if p['id']==place_id),None)
    if not place:raise RuntimeError('Backup place not found')
    partial=root/(name+'.partial')
    with backup_places.open_place(place) as source:source.get(name,partial)
    partial.replace(root/name)
def restore(root,key,name,place_id=None):
    """Replace every workspace volume and secret with the ones in a backup."""
    if not backup_places.ARCHIVE_NAME.match(name or ''):raise RuntimeError('Invalid backup name')
    recover(root)
    archive=root/name
    if not archive.exists():
        if not place_id:raise RuntimeError('Backup not found on this server')
        progress(root,'Fetching the backup');fetch_archive(root,name,place_id)
    # Unpacked data is several times the compressed archive. Keep headroom for the host.
    if shutil.disk_usage(root).free<archive.stat().st_size*4+5*1024**3:raise RuntimeError('Not enough free disk space to restore')
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    with tempfile.TemporaryDirectory(prefix='full-restore-',dir=root) as tmp:
        data=Path(tmp)/'data';data.mkdir()
        progress(root,'Unpacking the backup')
        gpg=subprocess.Popen(['gpg','--batch','--pinentry-mode','loopback','--passphrase-file',str(key),'--decrypt',str(archive)],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        # Running as root: keep numeric owners so each database finds its own files.
        try:run('tar','-x','-p','--numeric-owner','-C',str(data),'-f','-',stdin=gpg.stdout)
        finally:gpg.stdout.close()
        if gpg.wait()!=0:raise RuntimeError('Backup could not be decrypted')
        progress(root,'Checking the backup')
        manifest=json.loads((data/'manifest.json').read_text())
        for path,expected in manifest['sha256'].items():
            if digest(data/path)!=expected:raise RuntimeError('Restore checksum mismatch')
        saved=restorable_secrets(json.loads((data/'resources.json').read_text())['items'])
        live=json.loads(kube('get','deploy,cronjob,secret','-o','json'))['items']
        current=restorable_secrets(live)
        paths=volume_paths()
        plan=[(volume,paths[volume]) for volume in manifest['volumes'] if paths.get(volume)]
        if not plan:raise RuntimeError('No volumes in this backup match the workspace')
        # Sessions from backup time must not sign anyone back in.
        with contextlib.suppress(FileNotFoundError):(data/'volumes/portal-flow-data/sessions.enc').unlink()
        changed={name:secret for name,secret in saved.items() if name in current and secret['data']!=current[name]['data']}
        restore_error=None
        try:
            progress(root,'Pausing apps')
            quiesce(root,live)
            state={'stamp':stamp,'archive':name,'swapped':[],'secrets':{n:current[n] for n in changed},'secrets_changed':False}
            atomic(root/'restore-journal.json',state)
            progress(root,'Putting data back')
            if changed:
                state['secrets_changed']=True;atomic(root/'restore-journal.json',state)
                put_secrets(changed)
            for volume,path in plan:
                aside=path+'.pre-restore-'+stamp
                os.rename(path,aside)
                state['swapped'].append({'path':path,'aside':aside});atomic(root/'restore-journal.json',state)
                move(data/'volumes'/volume,path)
            (root/'restore-journal.json').unlink()
        except Exception as error:restore_error=error
        finally:
            progress(root,'Starting apps again')
            recover_after_snapshot(root,restore_error)
    # Keep only the data from right before this restore, so an admin can still undo it.
    for path in paths.values():
        if not path:continue
        for old in Path(path).parent.glob(Path(path).name+'.pre-restore-*'):
            if old.name!=Path(path).name+'.pre-restore-'+stamp:shutil.rmtree(old)
    atomic(root/'last-restore.json',{'archive':name,'completed_at':int(time.time()),'volumes':len(plan),'secrets':len(changed),'previous_data_suffix':'.pre-restore-'+stamp})
    print('Restore complete:',name,'volumes:',len(plan),flush=True)

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
            for deployment,volume,mount in restore_database_plan(resources,manifest['volumes']):
                d=next(r for r in resources if r['kind']=='Deployment' and r['metadata']['name']==deployment)
                c=d['spec']['template']['spec']['containers'][0];name='blak-restore-'+deployment+'-'+secrets.token_hex(4);containers.append(name)
                # No network, no ports, copied volumes only. Never run application workers.
                # data_filter strips owners; entrypoints restore database ownership.
                # Parent mount must remain traversable after privilege drop.
                (data/'volumes'/volume).chmod(0o755)
                options=['-e','PGDATA=/var/lib/postgresql/data/pgdata'] if deployment=='postgres' else []
                # Images must be prepared locally. A drill must not silently depend on a registry.
                try:run('docker','image','inspect',c['image'])
                except subprocess.CalledProcessError:raise RuntimeError('Restore image missing locally: '+deployment) from None
                if deployment=='smith-postgres':
                    # PG18 has a private major-version parent above PGDATA. Safe tar
                    # extraction strips ownership; its entrypoint only fixes PGDATA.
                    # Repair ownership inside the isolated copy, never the live PVC.
                    run('docker','run','--rm','--pull=never','--network','none','--user','0','--entrypoint','chown','-v',str(data/'volumes'/volume)+':/restore',c['image'],'-R','postgres:postgres','/restore')
                run('docker','run','-d','--pull=never','--name',name,'--label',RESTORE_LABEL,'--network','none','--memory','768m','--cpus','1',*options,'-v',str(data/'volumes'/volume)+':'+mount,c['image'])
                if deployment=='postgres':
                    user=secret_text(resources,'blak-core','postgres-user')
                    command=['psql','-U',user,'-d','portal','-Atc',"SELECT count(*) FROM pg_database WHERE NOT datistemplate;"]
                elif deployment=='smith-postgres':
                    command=['psql','-U','blaksmith','-d','blaksmith','-Atc',"SELECT count(*) FROM public.nodes;"]
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
                        if not value.isdigit() or (deployment!='smith-postgres' and int(value)<1):raise RuntimeError('Restored database empty')
                        evidence['database_checks'][deployment]=int(value);break
                    except (subprocess.CalledProcessError,RuntimeError):
                        if run('docker','inspect','--format','{{.State.Running}}',name).strip()!=b'true':raise RuntimeError('Restored database stopped: '+deployment)
                        if time.monotonic()>deadline:raise RuntimeError('Isolated restored database validation failed: '+deployment)
                        time.sleep(2)
            db=data/'volumes/webui-data/webui.db'
            with sqlite3.connect(db) as con:
                if con.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Hermes SQLite corruption')
                evidence['database_checks']['hermes']='integrity_check ok'
            eyes=check_eyes_database(data,manifest['volumes'])
            if eyes:evidence['database_checks']['eyes']=eyes
            if 'vault-data' in manifest['volumes']:
                vault=data/'volumes/vault-data'
                if not (vault/'db.sqlite3').is_file():raise RuntimeError('Vault database missing from restore')
                with sqlite3.connect('file:'+str(vault/'db.sqlite3')+'?mode=ro',uri=True) as con:
                    if con.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise RuntimeError('Vault SQLite corruption')
                    if con.execute('PRAGMA foreign_key_check').fetchone():raise RuntimeError('Vault foreign key corruption')
                    attachments=con.execute('SELECT id,cipher_uuid FROM attachments').fetchall()
                    for attachment,cipher in attachments:
                        if not (vault/'attachments'/cipher/attachment).is_file():raise RuntimeError('Vault attachment missing from restore')
                evidence['database_checks']['vault']={'integrity':'ok','attachments':len(attachments)}
            for path in (data/'volumes/portal-flow-data').rglob('*.json'):json.loads(path.read_text())
            evidence.update(archive=archive.name,completed_at=int(time.time()),duration_seconds=round(time.time()-started),network='none')
            atomic(root/'last-restore-drill.json',evidence)
            print('Restore drill passed:',json.dumps(evidence),flush=True)
        finally:
            for name in containers:subprocess.run(['docker','rm','-f',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('action',choices=['snapshot','restore-drill','restore','recover','cleanup-restore']);parser.add_argument('--place');parser.add_argument('--root',type=Path,default=Path('/var/backups/blak-workspace'));parser.add_argument('--key',type=Path,default=Path('/etc/blak-backup/key'));parser.add_argument('--archive',type=Path)
    args=parser.parse_args();args.root.mkdir(parents=True,exist_ok=True,mode=0o700)
    if args.action=='cleanup-restore':cleanup_restore();return
    lock=open(args.root/'lock','w');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    if args.action=='recover':recover(args.root);return
    if not args.key.exists():raise RuntimeError('Backup key must be provisioned separately')
    if args.key.stat().st_mode & 0o077:raise RuntimeError('Backup key must be private')
    if args.action=='snapshot':snapshot(args.root,args.key)
    elif args.action=='restore':
        # The agent leaves a request file; a command-line archive name wins.
        request=args.root/'restore-request.json'
        wanted=json.loads(request.read_text()) if request.exists() else {}
        request.unlink(missing_ok=True)
        restore(args.root,args.key,args.archive.name if args.archive else wanted.get('archive'),args.place or wanted.get('place'))
    else:restore_drill(args.root,args.key,args.archive or sorted(args.root.glob('workspace-*.tar.gpg'))[-1])
if __name__=='__main__':
    def terminate(signum,frame):raise InterruptedError('Backup service stopped')
    signal.signal(signal.SIGTERM,terminate)
    try:main()
    except Exception as error:
        # Subprocess exceptions may include sensitive output: never print their details.
        print('Backup operation failed:',type(error).__name__,flush=True);raise SystemExit(1)
