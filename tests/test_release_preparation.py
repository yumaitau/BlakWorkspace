import argparse
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('release',ROOT/'scripts/deploy/prepare-release.py')
release=importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleasePreparationTests(unittest.TestCase):
    def test_domain_rejects_urls_injection_and_example(self):
        example_domain='workspace.' + 'example.com'
        for value in ['https://work.acme.net', 'work.acme.net/path', 'work.acme.net:443', 'a;echo.net', example_domain, '-bad.acme.net', 'acme..net']:
            with self.subTest(value=value),self.assertRaises(argparse.ArgumentTypeError):
                release.domain_name(value)
        self.assertEqual(release.domain_name('Work.Acme.NET'),'work.acme.net')

    def test_domain_propagates_to_urls_cookies_and_regex_without_touching_binary(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            source=root/'settings.txt'
            source.write_text('https://id.workspace.example.com/callback\nDomain=workspace.example.com\n'+r'portal\.workspace\.example\.com'+ '\n'+r'portal\\.workspace\\.example\\.com')
            binary=root/'image.png';binary.write_bytes(b'\xff\xfe')
            release.configure_tree(root,'work.acme.net')
            text=source.read_text()
            self.assertIn('https://id.work.acme.net/callback',text)
            self.assertIn('Domain=work.acme.net',text)
            self.assertIn(r'portal\.work\.acme\.net',text)
            self.assertIn(r'portal\\.work\\.acme\\.net',text)
            self.assertEqual(binary.read_bytes(),b'\xff\xfe')

    def test_deploy_refuses_unprepared_source_before_cluster_access(self):
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            script=Path(tmp)/'scripts/deploy/deploy-micro.sh'
            script.parent.mkdir(parents=True)
            script.write_text((ROOT/'scripts/deploy/deploy-micro.sh').read_text())
            result=subprocess.run(['bash',str(script)],capture_output=True,text=True)
        self.assertNotEqual(result.returncode,0)
        self.assertIn('prepare-release.py first',result.stdout)
