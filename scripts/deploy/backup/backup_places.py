"""Extra places that hold a copy of each encrypted workspace backup.

Archives are already GPG-encrypted before they leave the host. A place only
stores opaque files named workspace-<stamp>.tar.gpg.
"""
import contextlib, datetime, hashlib, hmac, http.client, json, os, re, secrets, shutil, subprocess, tempfile, urllib.parse
import xml.etree.ElementTree as ET
from pathlib import Path

ARCHIVE_NAME=re.compile(r'^workspace-\d{8}T\d{6}Z\.tar\.gpg$')
KINDS={'folder','smb','nfs','s3'}
SECRET_FIELDS={'password','secret_key'}
PART_BYTES=64*1024*1024

class PlaceError(Exception):
    """Failure whose message is safe to show an admin."""

def load(path):
    try:return json.loads(Path(path).read_text()).get('places',[])
    except FileNotFoundError:return []

def save(path,places):
    path=Path(path);temp=path.with_suffix('.tmp')
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:json.dump({'places':places},f,indent=2)
    temp.replace(path)

def public(place):
    """Place config without credentials."""
    return {k:v for k,v in place.items() if k not in SECRET_FIELDS}

def validate(entry):
    """Return a clean place from untrusted input, or raise PlaceError."""
    def text(name,required=True,limit=300):
        value=str(entry.get(name) or '').strip()
        if required and not value:raise PlaceError('Missing '+name.replace('_',' '))
        if len(value)>limit or any(c in value for c in '\0\n\r'):raise PlaceError('Invalid '+name.replace('_',' '))
        return value
    kind=text('kind')
    if kind not in KINDS:raise PlaceError('Unknown kind of place')
    try:keep=int(entry.get('keep') or 7)
    except ValueError:raise PlaceError('Keep must be a number') from None
    if not 1<=keep<=90:raise PlaceError('Keep between 1 and 90 backups')
    place={'id':secrets.token_hex(4),'kind':kind,'name':text('name',limit=60),'keep':keep}
    subdir=text('subdir',required=False)
    if subdir and (subdir.startswith('/') or '..' in Path(subdir).parts):raise PlaceError('Folder inside the share must be a relative path')
    if kind=='folder':
        path=text('path')
        # Removable and network disks mount here. Anything else is host territory.
        if not re.match(r'^/(media|mnt)/[^/]',path) or '..' in Path(path).parts:raise PlaceError('Folder must be on a drive under /media or /mnt, such as /media/usb/blak')
        place['path']=path
    elif kind=='smb':
        share=text('share')
        if not re.fullmatch(r'//[A-Za-z0-9.\-]+/[^/\s,]+',share):raise PlaceError('Share must look like //server/share')
        place.update(share=share,username=text('username'),password=text('password'),subdir=subdir)
    elif kind=='nfs':
        export=text('export')
        if not re.fullmatch(r'[A-Za-z0-9.\-]+:/[^\s,]*',export):raise PlaceError('Export must look like server:/path')
        place.update(export=export,subdir=subdir)
    else:
        endpoint=text('endpoint').rstrip('/')
        parsed=urllib.parse.urlparse(endpoint)
        if parsed.scheme!='https' or not parsed.hostname or parsed.path not in ('',):raise PlaceError('Endpoint must be an https:// address with no path')
        bucket=text('bucket')
        if not re.fullmatch(r'[a-z0-9][a-z0-9.\-]{1,61}[a-z0-9]',bucket):raise PlaceError('Invalid bucket name')
        prefix=text('prefix',required=False).strip('/')
        place.update(endpoint=endpoint,region=text('region',required=False) or 'auto',bucket=bucket,prefix=prefix,access_key=text('access_key'),secret_key=text('secret_key'))
    return place

class DirPlace:
    def __init__(self,root):self.root=Path(root)
    def list(self):
        return sorted(({'name':p.name,'size':p.stat().st_size} for p in self.root.glob('workspace-*.tar.gpg') if ARCHIVE_NAME.match(p.name)),key=lambda a:a['name'])
    def put(self,local):
        self.root.mkdir(parents=True,exist_ok=True)
        partial=self.root/(local.name+'.partial')
        shutil.copyfile(local,partial);partial.replace(self.root/local.name)
    def get(self,name,dest):
        shutil.copyfile(self.root/name,dest)
    def delete(self,name):(self.root/name).unlink()
    def probe(self):
        self.root.mkdir(parents=True,exist_ok=True)
        test=self.root/('.blak-write-test-'+secrets.token_hex(4));test.write_bytes(b'ok');test.unlink()

def prune(place,keep):
    for old in [a['name'] for a in place.list()][:-keep]:place.delete(old)

def _separate_disk(path):
    """A folder place must not sit on the system disk, or an unplugged drive fills it."""
    probe=Path(path)
    while not probe.exists():probe=probe.parent
    return os.stat(probe).st_dev!=os.stat('/').st_dev

@contextlib.contextmanager
def _mounted(kind,source,options):
    Path('/run/blak-backup').mkdir(mode=0o700,exist_ok=True)
    point=tempfile.mkdtemp(prefix='place-',dir='/run/blak-backup')
    try:
        try:subprocess.run(['mount','-t',kind,*options,source,point],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=60)
        except FileNotFoundError:raise PlaceError('This server cannot mount '+kind+' shares. Run install.sh again.') from None
        except (subprocess.CalledProcessError,subprocess.TimeoutExpired):raise PlaceError('Could not connect to the share') from None
        try:yield point
        finally:subprocess.run(['umount',point],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    finally:
        with contextlib.suppress(OSError):os.rmdir(point)

@contextlib.contextmanager
def open_place(place):
    kind=place['kind']
    if kind=='folder':
        if not _separate_disk(place['path']):raise PlaceError('That folder is on the system disk. Plug in the drive and try again.')
        yield DirPlace(place['path'])
    elif kind=='smb':
        # Credentials go through a private file, never the command line.
        with tempfile.NamedTemporaryFile('w',prefix='cred-',dir='/run') as cred:
            os.chmod(cred.name,0o600)
            cred.write('username='+place['username']+'\npassword='+place['password']+'\n');cred.flush()
            with _mounted('cifs',place['share'],['-o','credentials='+cred.name+',vers=3.0,seal,nosuid,nodev,noexec']) as point:
                yield DirPlace(Path(point)/place.get('subdir',''))
    elif kind=='nfs':
        with _mounted('nfs',place['export'],['-o','nosuid,nodev,noexec,soft,timeo=150']) as point:
            yield DirPlace(Path(point)/place.get('subdir',''))
    else:yield S3Place(place)

def sigv4(method,host,uri,query,headers,payload_hash,access_key,secret_key,region,now,service='s3'):
    """AWS Signature Version 4. Returns the Authorization header value."""
    amz_date=now.strftime('%Y%m%dT%H%M%SZ');day=amz_date[:8]
    q=lambda v:urllib.parse.quote(str(v),safe='-_.~')
    canonical_query='&'.join(q(k)+'='+q(v) for k,v in sorted(query))
    names=sorted(k.lower() for k in headers)
    lower={k.lower():' '.join(str(v).split()) for k,v in headers.items()}
    canonical='\n'.join([method,uri,canonical_query,''.join(n+':'+lower[n]+'\n' for n in names),';'.join(names),payload_hash])
    scope='/'.join([day,region,service,'aws4_request'])
    to_sign='\n'.join(['AWS4-HMAC-SHA256',amz_date,scope,hashlib.sha256(canonical.encode()).hexdigest()])
    key=('AWS4'+secret_key).encode()
    for part in (day,region,service,'aws4_request'):key=hmac.new(key,part.encode(),hashlib.sha256).digest()
    signature=hmac.new(key,to_sign.encode(),hashlib.sha256).hexdigest()
    return 'AWS4-HMAC-SHA256 Credential='+access_key+'/'+scope+', SignedHeaders='+';'.join(names)+', Signature='+signature

def _plain(root):
    """Drop XML namespaces so S3, R2 and MinIO replies parse the same way."""
    for element in root.iter():element.tag=element.tag.rsplit('}',1)[-1]
    return root

class S3Place:
    """Path-style S3 client for S3, R2, B2 and MinIO. Standard library only."""
    def __init__(self,place,connect=None):
        self.place=place;self.host=urllib.parse.urlparse(place['endpoint']).netloc
        self.connect=connect or (lambda:http.client.HTTPSConnection(self.host,timeout=120))
    def _key(self,name):return (self.place['prefix']+'/' if self.place.get('prefix') else '')+name
    def _call(self,method,key='',query=(),body=b'',expect=(200,),stream_to=None):
        uri='/'+urllib.parse.quote(self.place['bucket'])+('/'+urllib.parse.quote(key,safe='/-_.~') if key else '')
        now=datetime.datetime.now(datetime.timezone.utc)
        headers={'host':self.host,'x-amz-date':now.strftime('%Y%m%dT%H%M%SZ'),'x-amz-content-sha256':'UNSIGNED-PAYLOAD'}
        headers['authorization']=sigv4(method,self.host,uri,list(query),{k:v for k,v in headers.items()},'UNSIGNED-PAYLOAD',self.place['access_key'],self.place['secret_key'],self.place.get('region') or 'auto',now)
        path=uri+('?'+urllib.parse.urlencode(list(query),quote_via=urllib.parse.quote) if query else '')
        conn=self.connect()
        try:
            try:
                conn.request(method,path,body=body,headers={**headers,'content-length':str(len(body))})
                res=conn.getresponse()
            except OSError:raise PlaceError('Could not reach the storage endpoint') from None
            if res.status not in expect:
                res.read()
                raise PlaceError({403:'Storage refused the access key',404:'Bucket not found'}.get(res.status,'Storage returned an error ('+str(res.status)+')'))
            if stream_to is not None:
                for block in iter(lambda:res.read(1024*1024),b''):stream_to.write(block)
                return res,b''
            return res,res.read()
        finally:conn.close()
    def list(self):
        found=[];token=None
        prefix=(self.place['prefix']+'/') if self.place.get('prefix') else ''
        while True:
            query=[('list-type','2'),('prefix',prefix+'workspace-')]+([('continuation-token',token)] if token else [])
            _,body=self._call('GET',query=query)
            root=_plain(ET.fromstring(body))
            for item in root.findall('Contents'):
                name=item.findtext('Key','')[len(prefix):]
                if ARCHIVE_NAME.match(name):found.append({'name':name,'size':int(item.findtext('Size','0'))})
            if root.findtext('IsTruncated')!='true':break
            token=root.findtext('NextContinuationToken')
        return sorted(found,key=lambda a:a['name'])
    def put(self,local):
        key=self._key(local.name)
        _,body=self._call('POST',key,[('uploads','')])
        upload=_plain(ET.fromstring(body)).findtext('UploadId')
        if not upload:raise PlaceError('Storage did not start the upload')
        parts=[]
        try:
            with open(local,'rb') as f:
                for number,chunk in enumerate(iter(lambda:f.read(PART_BYTES),b''),1):
                    res,_=self._call('PUT',key,[('partNumber',str(number)),('uploadId',upload)],chunk)
                    parts.append((number,res.getheader('ETag')))
            done='<CompleteMultipartUpload>'+''.join('<Part><PartNumber>%d</PartNumber><ETag>%s</ETag></Part>'%(n,e) for n,e in parts)+'</CompleteMultipartUpload>'
            _,body=self._call('POST',key,[('uploadId',upload)],done.encode())
            if b'<Error>' in body:raise PlaceError('Storage did not accept the upload')
        except BaseException:
            with contextlib.suppress(Exception):self._call('DELETE',key,[('uploadId',upload)],expect=(204,200))
            raise
    def get(self,name,dest):
        with open(dest,'wb') as f:self._call('GET',self._key(name),stream_to=f)
    def delete(self,name):self._call('DELETE',self._key(name),expect=(204,200))
    def probe(self):
        name='.blak-write-test-'+secrets.token_hex(4)
        self._call('PUT',self._key(name),body=b'ok')
        self._call('DELETE',self._key(name),expect=(204,200))
