import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('tailnet',ROOT/'scripts/deploy/prepare-tailnet.py')
tailnet=importlib.util.module_from_spec(spec)
spec.loader.exec_module(tailnet)


class TailnetReleaseTests(unittest.TestCase):
    def test_rejects_unrelated_host_before_touching_release(self):
        with self.assertRaises(ValueError):tailnet.configure(Path('/missing'),'bad.example.net','100.64.0.1')

    def test_existing_crm_database_site_is_independent_of_public_dns(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'.deployment.json').write_text(json.dumps({'domain':'workspace.example.com','revision':'test'}))
            for relative in ('services/frappe/setup.py', 'services/frappe/enroll-roles.py',
                             'services/workspace-shell/nginx.conf', 'deploy/k3s/micro/95-crm.yaml'):
                path=root/relative
                path.parent.mkdir(parents=True,exist_ok=True)
                path.write_text((ROOT/relative).read_text())
            origins=tailnet.configure(root,'demo.tail123.ts.net','100.64.0.1','crm.original.internal')
            for relative in ('services/frappe/setup.py','services/frappe/enroll-roles.py'):
                self.assertIn("SITE = 'crm.original.internal'",(root/relative).read_text())
            self.assertIn(repr(origins['crm']),(root/'services/frappe/setup.py').read_text())
            deployment=next(doc for doc in tailnet.yaml.safe_load_all((root/'deploy/k3s/micro/95-crm.yaml').read_text())
                            if doc and doc.get('kind')=='Deployment' and doc['metadata']['name']=='frappe-crm')
            for container in deployment['spec']['template']['spec']['containers']:
                for env in container.get('env',[]):
                    if env['name']=='FRAPPE_SITE_NAME_HEADER':
                        self.assertEqual(env['value'],'crm.original.internal')
                for header in container.get('readinessProbe',{}).get('httpGet',{}).get('httpHeaders',[]):
                    if header['name']=='Host':self.assertEqual(header['value'],'crm.original.internal')
            self.assertEqual(json.loads((root/'.deployment.json').read_text())['crm_site'],'crm.original.internal')

    def test_origins_remain_distinct_and_preserve_site_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            (root/'.deployment.json').write_text(json.dumps({'domain':'workspace.example.com','revision':'test'}))
            (root/'deploy/k3s/micro').mkdir(parents=True)
            collabora=root/'deploy/k3s/micro/60-collabora.yaml'
            collabora.write_text(json.dumps({'kind':'Deployment','metadata':{'name':'collabora'},'spec':{'template':{'spec':{'containers':[{'name':'code','env':[{'name':'server_name','value':'docs.workspace.example.com'},{'name':'domain','value':'drive.workspace.example.com'}]}]}}}}))
            vault=root/'deploy/k3s/micro/96-vault.yaml'
            vault.write_text((ROOT/'deploy/k3s/micro/96-vault.yaml').read_text())
            (root/'services/workspace-shell').mkdir(parents=True)
            (root/'services/workspace-shell/nginx.conf').write_text((ROOT/'services/workspace-shell/nginx.conf').read_text())
            (root/'e2e').mkdir()
            fixture=root/'e2e/probe.js'
            fixture.write_text("u.hostname === 'crm.workspace.example.com'; u.hostname === \"forms.workspace.example.com\"; const url='https://crm.workspace.example.com'; Domain=workspace.example.com")
            site=root/'site.py';site.write_text("SITE='crm.workspace.example.com'\nURL='https://crm.workspace.example.com'")
            origins=tailnet.configure(root,'demo.tail123.ts.net','100.64.0.1')
            self.assertEqual(origins['portal'],'https://demo.tail123.ts.net')
            self.assertEqual(len(set(origins.values())),len(origins))
            self.assertNotIn(8443,tailnet.PORTS.values())
            self.assertIn("u.host === 'demo.tail123.ts.net:8450'",fixture.read_text())
            self.assertIn('u.host === "demo.tail123.ts.net:8449"',fixture.read_text())
            self.assertIn('Domain=demo.tail123.ts.net',fixture.read_text())
            self.assertIn("SITE='crm.workspace.example.com'",site.read_text())
            gateway=(root/'services/workspace-shell/nginx.conf').read_text()
            self.assertIn('map $http_host $blak_upstream',gateway)
            self.assertIn('demo.tail123.ts.net:8444 authentik-server.blak-micro.svc.cluster.local:9000;',gateway)
            self.assertIn('portal.workspace.example.com portal.blak-micro.svc.cluster.local:3000;',gateway)
            self.assertIn('demo.tail123.ts.net:8453 vault.blak-micro.svc.cluster.local:8080;',gateway)
            vault_docs=list(tailnet.yaml.safe_load_all(vault.read_text()))
            policy=next(d for d in vault_docs if d['kind']=='NetworkPolicy')
            self.assertEqual(policy['spec']['egress'][-1], {'to':[{'ipBlock':{'cidr':'100.64.0.1/32'}}], 'ports':[{'protocol':'TCP','port':8444}]})
            deployment=next(d for d in vault_docs if d['kind']=='Deployment')
            self.assertEqual(deployment['spec']['template']['spec']['hostAliases'],[{'ip':'100.64.0.1','hostnames':['demo.tail123.ts.net']}])
            document=tailnet.yaml.safe_load(collabora.read_text())
            env={item['name']:item['value'] for item in document['spec']['template']['spec']['containers'][0]['env']}
            self.assertEqual(env['server_name'],'demo.tail123.ts.net:8446')
            self.assertEqual(env['domain'],r'demo\.tail123\.ts\.net|drive')
            with self.assertRaises(ValueError):tailnet.configure(root,'demo.tail123.ts.net','100.64.0.1')
