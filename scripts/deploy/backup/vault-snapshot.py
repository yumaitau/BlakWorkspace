#!/usr/bin/env python3
"""Quiesced Vault-only encrypted backup; never stops other workspace applications."""
import argparse
import datetime
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

spec=importlib.util.spec_from_file_location('workspace_backup',Path(__file__).with_name('workspace-backup.py'))
backup=importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


def snapshot(root,key):
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    if not key.is_file() or key.stat().st_mode & 0o077:
        raise ValueError('Private backup key required')
    lock=(root/'lock').open('w')
    fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    backup.recover(root)
    deployment=json.loads(backup.kube('get','deploy','vault','-o','json'))
    replicas=deployment['spec'].get('replicas',1)
    pvc=json.loads(backup.kube('get','pvc','vault-data','-o','json'))
    pv=json.loads(backup.run('kubectl','get','pv',pvc['spec']['volumeName'],'-o','json'))
    if pv['spec']['claimRef']['namespace']!=backup.NS or pv['spec']['claimRef']['name']!='vault-data':
        raise ValueError('Vault PVC binding changed')
    source=Path(pv['spec'].get('hostPath',pv['spec'].get('local',{}))['path'])
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    output=root/('vault-'+stamp+'.tar.gpg')
    with tempfile.TemporaryDirectory(prefix='vault-snapshot-',dir=root) as tmp:
        stage=Path(tmp);(stage/'volumes').mkdir()
        backup.atomic(root/'resume.json',{'replicas':{'vault':replicas},'crons':{}})
        error=None
        try:
            backup.kube('scale','deploy/vault','--replicas=0')
            deadline=time.monotonic()+120
            while json.loads(backup.kube('get','pods','-l','app=vault','-o','json'))['items']:
                if time.monotonic()>deadline:raise RuntimeError('Vault did not quiesce')
                time.sleep(1)
            backup.run('cp','-a','--reflink=auto',str(source),str(stage/'volumes/vault-data'))
        except Exception as exc:error=exc
        finally:backup.recover_after_snapshot(root,error)
        backup.atomic(stage/'manifest.json',{'created_at':stamp,'image':deployment['spec']['template']['spec']['containers'][0]['image'],
            'sha256':{str(p.relative_to(stage)):backup.digest(p) for p in stage.rglob('*') if p.is_file()}})
        tar=subprocess.Popen(['tar','-C',str(stage),'-cf','-','.'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
        try:backup.run('gpg','--batch','--yes','--pinentry-mode','loopback','--passphrase-file',str(key),'--symmetric','--cipher-algo','AES256','--output',str(output)+'.partial',stdin=tar.stdout)
        finally:tar.stdout.close()
        if tar.wait():raise RuntimeError('Vault archive failed')
        Path(str(output)+'.partial').replace(output)
    for old in sorted(root.glob('vault-*.tar.gpg'))[:-7]:
        old.unlink()
    print('Vault encrypted snapshot complete:',output.name)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=Path('/var/backups/blak-workspace'))
    parser.add_argument('--key',type=Path,default=Path('/etc/blak-backup/key'))
    args=parser.parse_args()
    try:snapshot(args.root,args.key)
    except Exception as error:
        print('Vault snapshot failed:',type(error).__name__)
        raise SystemExit(1)
