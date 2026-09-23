"""Every launchable catalog app has a native entry in the integration contract.

A portal that mounts a newer catalog.js over an older image can still lack an
entry. server.js then falls back to the catalog URL instead of failing.
"""

import json
import subprocess
import unittest

from repo import ROOT, read


class TestPortalLaunchIntegration(unittest.TestCase):
    def test_live_catalog_apps_have_integrations(self):
        source = """
const {APPS}=require('./apps/portal/catalog.js');
const {INTEGRATIONS}=require('./apps/portal/integration.js');
process.stdout.write(JSON.stringify(APPS.filter(a=>a.status==='live'&&a.url&&!INTEGRATIONS[a.id]).map(a=>a.id)));
"""
        missing = json.loads(subprocess.check_output(['node', '-e', source], cwd=ROOT, text=True))
        self.assertEqual(missing, [])

    def test_launch_tolerates_missing_integration(self):
        self.assertIn('const integration = INTEGRATIONS[app.id] || {};', read('apps/portal/server.js'))


if __name__ == '__main__':
    unittest.main()
