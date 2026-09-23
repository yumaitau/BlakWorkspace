"""The Drive file checker installs without copying public addresses."""

from __future__ import annotations

import unittest

from repo import ROOT, read

import importlib.util

SPEC = importlib.util.spec_from_file_location("file_guard_deploy", ROOT / "scripts/deploy/file-guard.py")
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


class TestFileGuardDeploy(unittest.TestCase):
    def test_manifests_use_cluster_dns(self):
        text = "\n".join(read(path) for path in (
            "deploy/k3s/micro/98-clamav.yaml",
        ))
        sidecar = read("deploy/k3s/micro/50-opencloud.yaml").split("- name: file-guard", 1)[1]
        for banned in ("tailscale", "ts.net", "homelab", "100.95.", "8445"):
            self.assertNotIn(banned, text)
            self.assertNotIn(banned, sidecar)
        self.assertIn("image: blak-portal:micro", sidecar)
        self.assertIn("CLAMAV_HOST", sidecar)
        self.assertNotIn("ConfigMap", sidecar)
        self.assertIn("http://drive:8092", read("deploy/k3s/micro/30-portal.yaml"))
        self.assertIn("blak-file-guard", read("scripts/deploy/ensure-secrets.sh"))

    def test_install_keeps_public_urls(self):
        public = "https://files.customer.example/drive"
        drive = {"spec": {"template": {"spec": {"containers": [
            {"name": "opencloud", "image": "blak-drive:local", "env": [{"name": "OC_URL", "value": public}]},
        ], "volumes": [{"name": "data"}]}}}}
        updated = guard.install_checker(drive, "blak-portal:release")
        opencloud = updated["spec"]["template"]["spec"]["containers"][0]
        checker = updated["spec"]["template"]["spec"]["containers"][1]
        self.assertEqual(opencloud["env"][0]["value"], public)
        self.assertEqual(opencloud["image"], "blak-drive:local")
        self.assertEqual(checker["image"], "blak-portal:release")
        self.assertEqual(checker["env"][2]["value"], "clamav")
        self.assertNotIn("ts.net", str(updated))
        portal = {"spec": {"template": {"spec": {"containers": [
            {"name": "portal", "env": [{"name": "BLAK_APP_ORIGINS", "value": public}]},
        ]}}}}
        guard.install_portal(portal)
        names = [item["name"] for item in portal["spec"]["template"]["spec"]["containers"][0]["env"]]
        self.assertEqual(names, ["BLAK_APP_ORIGINS", "FILE_GUARD_URL", "FILE_GUARD_TOKEN"])
        self.assertEqual(portal["spec"]["template"]["spec"]["containers"][0]["env"][0]["value"], public)
        guard.remove_checker(updated)
        guard.remove_portal(portal)
        self.assertEqual([item["name"] for item in updated["spec"]["template"]["spec"]["containers"]], ["opencloud"])
        self.assertEqual(portal["spec"]["template"]["spec"]["containers"][0]["env"][0]["name"], "BLAK_APP_ORIGINS")


if __name__ == "__main__":
    unittest.main()
