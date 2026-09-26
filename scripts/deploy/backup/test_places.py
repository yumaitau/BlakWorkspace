import datetime
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parent))
import backup_places
spec=importlib.util.spec_from_file_location('agent',Path(__file__).with_name('backup-agent.py'))
agent=importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)

class SigV4Tests(unittest.TestCase):
    def test_matches_the_published_aws_example(self):
        # GET Object example from the Amazon S3 SigV4 documentation.
        now=datetime.datetime(2013,5,24,tzinfo=datetime.timezone.utc)
        headers={'Host':'examplebucket.s3.amazonaws.com','Range':'bytes=0-9','x-amz-content-sha256':'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855','x-amz-date':'20130524T000000Z'}
        value=backup_places.sigv4('GET','examplebucket.s3.amazonaws.com','/test.txt',[],headers,headers['x-amz-content-sha256'],
                                  'AKIAIOSFODNN7'+'EXAMPLE','wJalrXUtnFEMI/K7MDENG/bPxRfiCY'+'EXAMPLEKEY','us-east-1',now)
        self.assertTrue(value.endswith('Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'))
        self.assertIn('SignedHeaders=host;range;x-amz-content-sha256;x-amz-date',value)

class ValidateTests(unittest.TestCase):
    def test_places_are_checked_before_they_are_saved(self):
        bad=[{'kind':'folder','name':'USB','path':'/var/lib/rancher'},
             {'kind':'folder','name':'USB','path':'/media/../etc'},
             {'kind':'smb','name':'NAS','share':'//nas/share,uid=0','username':'u','password':'p'},
             {'kind':'nfs','name':'NAS','export':'nas:/x,rw'},
             {'kind':'s3','name':'R2','endpoint':'http://example.com','bucket':'blak','access_key':'a','secret_key':'b'},
             {'kind':'s3','name':'R2','endpoint':'https://example.com/path','bucket':'blak','access_key':'a','secret_key':'b'},
             {'kind':'smb','name':'NAS','share':'//nas/share','username':'u','password':'p\nx'},
             {'kind':'smb','name':'NAS','share':'//nas/share','username':'u','password':'p','subdir':'../up'},
             {'kind':'folder','name':'USB','path':'/media/usb','keep':'0'},
             {'kind':'ftp','name':'x'}]
        for entry in bad:
            with self.subTest(entry=entry),self.assertRaises(backup_places.PlaceError):backup_places.validate(entry)

    def test_public_view_hides_credentials(self):
        place=backup_places.validate({'kind':'s3','name':'R2','endpoint':'https://acct.r2.cloudflarestorage.com','bucket':'blak-backups','access_key':'id','secret_key':'hidden'})
        self.assertEqual(place['region'],'auto')
        self.assertNotIn('secret_key',backup_places.public(place))
        self.assertEqual(backup_places.public(place)['access_key'],'id')

class DirPlaceTests(unittest.TestCase):
    def test_copy_list_fetch_and_keep_newest(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp=Path(tmp);place=backup_places.DirPlace(tmp/'dest')
            for day in ('21','22','23'):
                local=tmp/('workspace-202609%sT173000Z.tar.gpg'%day);local.write_bytes(day.encode())
                place.put(local)
            (tmp/'dest/notes.txt').write_text('left alone')
            backup_places.prune(place,2)
            self.assertEqual([a['name'] for a in place.list()],['workspace-20260922T173000Z.tar.gpg','workspace-20260923T173000Z.tar.gpg'])
            self.assertTrue((tmp/'dest/notes.txt').exists())
            place.get('workspace-20260923T173000Z.tar.gpg',tmp/'back')
            self.assertEqual((tmp/'back').read_bytes(),b'23')

class FakeResponse:
    def __init__(self,status,body=b'',headers=None):self.status=status;self.body=io.BytesIO(body);self.headers=headers or {}
    def read(self,size=-1):return self.body.read(size)
    def getheader(self,name):return self.headers.get(name)

class FakeConnection:
    def __init__(self,log,replies):self.log=log;self.replies=replies
    def request(self,method,path,body=b'',headers=None):self.log.append((method,path,len(body),headers))
    def getresponse(self):return self.replies.pop(0)
    def close(self):pass

S3={'kind':'s3','name':'R2','endpoint':'https://acct.example.com','region':'auto','bucket':'blak','prefix':'home','access_key':'id','secret_key':'key'}

class S3PlaceTests(unittest.TestCase):
    def client(self,replies):
        log=[];return backup_places.S3Place(S3,connect=lambda:FakeConnection(log,replies)),log

    def test_listing_follows_pages_and_ignores_other_objects(self):
        ns='xmlns="http://s3.amazonaws.com/doc/2006-03-01/"'
        page1=('<ListBucketResult %s><IsTruncated>true</IsTruncated><NextContinuationToken>t/1</NextContinuationToken>'
               '<Contents><Key>home/workspace-20260925T173000Z.tar.gpg</Key><Size>10</Size></Contents>'
               '<Contents><Key>home/workspace-junk.tar.gpg</Key><Size>1</Size></Contents></ListBucketResult>'%ns).encode()
        page2=('<ListBucketResult %s><IsTruncated>false</IsTruncated><Contents><Key>home/workspace-20260924T173000Z.tar.gpg</Key><Size>9</Size></Contents></ListBucketResult>'%ns).encode()
        client,log=self.client([FakeResponse(200,page1),FakeResponse(200,page2)])
        self.assertEqual(client.list(),[{'name':'workspace-20260924T173000Z.tar.gpg','size':9},{'name':'workspace-20260925T173000Z.tar.gpg','size':10}])
        self.assertIn('continuation-token=t%2F1',log[1][1])
        self.assertTrue(log[0][3]['authorization'].startswith('AWS4-HMAC-SHA256 Credential=id/'))

    def test_failed_upload_is_aborted(self):
        with tempfile.TemporaryDirectory() as tmp:
            local=Path(tmp)/'workspace-20260925T173000Z.tar.gpg';local.write_bytes(b'x'*10)
            client,log=self.client([FakeResponse(200,b'<InitiateMultipartUploadResult><UploadId>u1</UploadId></InitiateMultipartUploadResult>'),FakeResponse(500),FakeResponse(204)])
            with self.assertRaises(backup_places.PlaceError):client.put(local)
        self.assertEqual([entry[0] for entry in log],['POST','PUT','DELETE'])
        self.assertTrue(log[0][1].startswith('/blak/home/workspace-20260925T173000Z.tar.gpg?uploads='))
        self.assertIn('uploadId=u1',log[2][1])

    def test_multipart_upload_completes_with_part_tags(self):
        with tempfile.TemporaryDirectory() as tmp:
            local=Path(tmp)/'workspace-20260925T173000Z.tar.gpg';local.write_bytes(b'abcde')
            client,log=self.client([FakeResponse(200,b'<X><UploadId>u1</UploadId></X>'),FakeResponse(200,b'',{'ETag':'"e1"'}),FakeResponse(200,b'<CompleteMultipartUploadResult/>')])
            with patch.object(backup_places,'PART_BYTES',5):client.put(local)
        self.assertEqual([entry[0] for entry in log],['POST','PUT','POST'])
        self.assertIn('partNumber=1',log[1][1])

class FakeSystemd:
    def __init__(self,active=None,result='success'):self.active=active;self.result=result;self.calls=[]
    def __call__(self,*args):
        self.calls.append(args)
        if args[0]!='show':return ''
        unit=args[1]
        if unit.endswith('.timer'):return 'NextElapseUSecRealtime=@1790443800\n'
        state='active' if self.active==unit else 'inactive'
        result=self.result if unit=='blak-workspace-restore.service' else 'success'
        return 'ActiveState=%s\nResult=%s\nInactiveEnterTimestamp=@1790357692\n'%(state,result)

class AgentTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.places=self.root/'places.json'
        (self.root/'workspace-20260925T173000Z.tar.gpg').write_bytes(b'x')
        (self.root/'workspace-20260925T173000Z.tar.gpg.partial').write_bytes(b'x')
    def tearDown(self):self.tmp.cleanup()

    def test_status_reports_backups_progress_and_failures(self):
        (self.root/'progress.json').write_text(json.dumps({'step':'Copying data'}))
        systemd=FakeSystemd(active='blak-workspace-backup.service',result='exit-code')
        state=agent.status(self.root,self.places,systemd)
        self.assertEqual(state['running'],{'action':'backup','step':'Copying data'})
        self.assertEqual(state['failed'],[{'action':'check','at':1790357692}])
        self.assertEqual(state['backups'],[{'name':'workspace-20260925T173000Z.tar.gpg','size':1,'created':agent.stamp_time('workspace-20260925T173000Z.tar.gpg')}])
        self.assertEqual(state['next']['backup'],1790443800)

    def test_archive_names_are_utc(self):
        self.assertEqual(agent.stamp_time('workspace-19700101T000100Z.tar.gpg'),60)

    def test_one_job_at_a_time(self):
        with self.assertRaises(agent.Refused) as refused:agent.start('backup',{},self.root,self.places,FakeSystemd(active='blak-workspace-full-restore.service'))
        self.assertEqual(refused.exception.status,409)

    def test_restore_request_is_checked_then_handed_to_systemd(self):
        systemd=FakeSystemd()
        for request in ({'archive':'../../etc/shadow'},{'archive':'workspace-20260101T000000Z.tar.gpg'},{'archive':'workspace-20260925T173000Z.tar.gpg','place':'nope'}):
            with self.subTest(request=request),self.assertRaises(agent.Refused):agent.start('restore',request,self.root,self.places,systemd)
        self.assertFalse(any(call[0]=='start' for call in systemd.calls))
        agent.start('restore',{'archive':'workspace-20260925T173000Z.tar.gpg'},self.root,self.places,systemd)
        self.assertEqual(json.loads((self.root/'restore-request.json').read_text()),{'archive':'workspace-20260925T173000Z.tar.gpg','place':None})
        self.assertIn(('start','--no-block','blak-workspace-full-restore.service'),systemd.calls)

    def test_places_are_saved_privately_and_listed_without_secrets(self):
        added=agent.add_place({'kind':'smb','name':'Office NAS','share':'//nas/backups','username':'blak','password':'hidden'},self.places)
        self.assertNotIn('password',added)
        self.assertEqual(self.places.stat().st_mode&0o777,0o600)
        listed=agent.status(self.root,self.places,FakeSystemd())['places']
        self.assertEqual(listed[0]['name'],'Office NAS');self.assertNotIn('password',listed[0])
        agent.remove_place(added['id'],self.places)
        self.assertEqual(backup_places.load(self.places),[])

if __name__=='__main__':unittest.main()
