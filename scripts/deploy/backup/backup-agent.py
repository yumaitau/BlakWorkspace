#!/usr/bin/env python3
"""Host agent that lets Blak Home show, start and restore workspace backups.

It runs as root beside workspace-backup.py and never does the work itself:
every job is a systemd unit, so a job keeps running and keeps its journal
when the agent or the portal restarts. Requests need the shared bearer token.
"""
import calendar, hmac, json, os, re, subprocess, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import backup_places

ROOT=Path(os.environ.get('BACKUP_ROOT','/var/backups/blak-workspace'))
PLACES=Path(os.environ.get('BACKUP_PLACES','/etc/blak-backup/places.json'))
TOKEN=Path(os.environ.get('BACKUP_AGENT_TOKEN_FILE','/etc/blak-backup/agent-token'))
KEY=Path(os.environ.get('BACKUP_KEY','/etc/blak-backup/key'))
UNITS={'backup':'blak-workspace-backup.service','check':'blak-workspace-restore.service','restore':'blak-workspace-full-restore.service'}
TIMERS={'backup':'blak-workspace-backup.timer','check':'blak-workspace-restore.timer'}
MAX_BODY=16*1024
os.umask(0o077)

class Refused(Exception):
    def __init__(self,status,message):super().__init__(message);self.status=status

def systemctl(*args):
    return subprocess.run(['systemctl',*args],check=False,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=15).stdout.decode()

def show(unit,*props,call=systemctl):
    out=call('show',unit,'--timestamp=unix','-p',','.join(props))
    return dict(line.split('=',1) for line in out.splitlines() if '=' in line)

def epoch(value):
    match=re.match(r'@(\d+)',value or '')
    return int(match.group(1)) if match else None

def read_json(path):
    try:return json.loads(Path(path).read_text())
    except (FileNotFoundError,ValueError):return None

def archives(root=ROOT):
    found=[]
    for path in sorted(root.glob('workspace-*.tar.gpg')):
        if backup_places.ARCHIVE_NAME.match(path.name):found.append({'name':path.name,'size':path.stat().st_size,'created':stamp_time(path.name)})
    return found

def stamp_time(name):
    return calendar.timegm(time.strptime(name[10:26],'%Y%m%dT%H%M%SZ')) if backup_places.ARCHIVE_NAME.match(name) else None

def status(root=ROOT,places_file=PLACES,call=systemctl):
    jobs={action:show(unit,'ActiveState','Result','InactiveEnterTimestamp',call=call) for action,unit in UNITS.items()}
    running=next((action for action,job in jobs.items() if job.get('ActiveState') in ('active','activating','deactivating')),None)
    progress=read_json(root/'progress.json') if running else None
    failed=[{'action':action,'at':epoch(job.get('InactiveEnterTimestamp'))} for action,job in jobs.items()
            if action!=running and job.get('Result') not in (None,'','success')]
    place_status=read_json(root/'places-status.json') or {}
    return {
        'running':{'action':running,'step':(progress or {}).get('step')} if running else None,
        'failed':failed,
        'backups':archives(root),
        'lastBackup':read_json(root/'last-backup.json'),
        'lastCheck':read_json(root/'last-restore-drill.json'),
        'lastRestore':read_json(root/'last-restore.json'),
        'next':{action:epoch(show(timer,'NextElapseUSecRealtime',call=call).get('NextElapseUSecRealtime')) for action,timer in TIMERS.items()},
        'places':[{**backup_places.public(p),'last':place_status.get(p['id'])} for p in backup_places.load(places_file)],
        'keyPresent':KEY.exists(),
    }

def start(action,request=None,root=ROOT,places_file=PLACES,call=systemctl):
    if action not in UNITS:raise Refused(404,'Unknown job')
    current=status(root,places_file,call)['running']
    if current:raise Refused(409,'Another backup job is running. Wait for it to finish.')
    if action=='restore':
        name=str((request or {}).get('archive') or '')
        place=(request or {}).get('place') or None
        if not backup_places.ARCHIVE_NAME.match(name):raise Refused(400,'Choose a backup to restore')
        if place is None and not (root/name).exists():raise Refused(404,'That backup is not on this server')
        if place is not None and not any(p['id']==place for p in backup_places.load(places_file)):raise Refused(404,'Backup place not found')
        (root/'restore-request.json').write_text(json.dumps({'archive':name,'place':place}))
    call('reset-failed',UNITS[action])
    call('start','--no-block',UNITS[action])
    return {'started':action}

def place_by_id(place_id,places_file=PLACES):
    place=next((p for p in backup_places.load(places_file) if p['id']==place_id),None)
    if not place:raise Refused(404,'Backup place not found')
    return place

def add_place(entry,places_file=PLACES):
    try:place=backup_places.validate(entry)
    except backup_places.PlaceError as error:raise Refused(400,str(error)) from None
    places=backup_places.load(places_file)
    if len(places)>=5:raise Refused(400,'Up to five places can hold copies')
    backup_places.save(places_file,places+[place])
    return backup_places.public(place)

def remove_place(place_id,places_file=PLACES):
    place_by_id(place_id,places_file)
    backup_places.save(places_file,[p for p in backup_places.load(places_file) if p['id']!=place_id])
    return {'removed':place_id}

def with_place(place_id,work,places_file=PLACES):
    try:
        with backup_places.open_place(place_by_id(place_id,places_file)) as place:return work(place)
    except backup_places.PlaceError as error:raise Refused(502,str(error)) from None

class Handler(BaseHTTPRequestHandler):
    server_version='blak-backup-agent'
    def log_message(self,*args):pass
    def reply(self,code,body):
        data=json.dumps(body).encode()
        self.send_response(code);self.send_header('content-type','application/json');self.send_header('cache-control','no-store')
        self.send_header('content-length',str(len(data)));self.end_headers();self.wfile.write(data)
    def authorised(self):
        try:expected=TOKEN.read_text().strip()
        except OSError:return False
        given=self.headers.get('authorization','')
        return bool(expected) and hmac.compare_digest(given.encode(),('Bearer '+expected).encode())
    def body(self):
        length=int(self.headers.get('content-length') or 0)
        if length>MAX_BODY:raise Refused(413,'Request too large')
        try:return json.loads(self.rfile.read(length) or b'{}')
        except ValueError:raise Refused(400,'Invalid request') from None
    def route(self,method):
        if not self.authorised():raise Refused(401,'Unauthorised')
        path=self.path.split('?',1)[0]
        if method=='GET' and path=='/status':return status()
        job=re.fullmatch(r'/jobs/(backup|check|restore)',path)
        if method=='POST' and job:return start(job.group(1),self.body())
        if method=='POST' and path=='/places':return add_place(self.body())
        place=re.fullmatch(r'/places/([a-f0-9]{8})/(backups|test|remove)',path)
        if place and method=='GET' and place.group(2)=='backups':
            return {'backups':[{**a,'created':stamp_time(a['name'])} for a in with_place(place.group(1),lambda p:p.list())]}
        if place and method=='POST' and place.group(2)=='test':
            with_place(place.group(1),lambda p:p.probe());return {'ok':True}
        if place and method=='POST' and place.group(2)=='remove':return remove_place(place.group(1))
        if method=='POST' and path=='/key':
            try:return {'key':KEY.read_text().strip()}
            except OSError:raise Refused(404,'No recovery key on this server') from None
        raise Refused(404,'Not found')
    def handle_method(self,method):
        try:self.reply(200,self.route(method))
        except Refused as error:self.reply(error.status,{'error':str(error)})
        except Exception as error:
            print('Agent request failed:',type(error).__name__,flush=True)
            self.reply(500,{'error':'The backup service hit a problem'})
    def do_GET(self):self.handle_method('GET')
    def do_POST(self):self.handle_method('POST')

def main():
    # Default to the k3s pod bridge so only this host and its pods can connect.
    host,port=os.environ.get('BACKUP_AGENT_BIND','10.42.0.1:8093').rsplit(':',1)
    ThreadingHTTPServer((host,int(port)),Handler).serve_forever()

if __name__=='__main__':main()
