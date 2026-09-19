"""Homelab k3s manifests must not commit OIDC or bootstrap secret literals."""

from __future__ import annotations

import unittest

from repo import ROOT, exists, read

BURNED = (
    "REDACTED",
    "REDACTED",
    "REDACTED",
    "REDACTED",
    "REDACTED",
    "REDACTED",
    "REDACTED",
    "REDACTED",
    "REDACTED",
    "REDACTED",
    "REDACTED",
    "REDACTED",
)

SECRET_FILES = (
    "deploy/k3s/micro/30-portal.yaml",
    "deploy/k3s/micro/40-authentik.yaml",
    "deploy/k3s/micro/50-opencloud.yaml",
    "deploy/k3s/micro/60-collabora.yaml",
    "deploy/k3s/micro/70-outline.yaml",
    "deploy/k3s/micro/91-openproject.yaml",
    "deploy/k3s/micro/92-hermes.yaml",
    "deploy/k3s/micro/10-data-events.yaml",
)


class TestK3sSecrets(unittest.TestCase):
    def test_runbook_forbids_committed_oidc_secrets(self):
        text = read("docs/runbooks/secrets.md")
        self.assertIn("never committed", text.lower())
        self.assertIn("OIDC", text)

    def test_named_manifests_have_no_secret_stringdata(self):
        for rel in SECRET_FILES:
            self.assertTrue(exists(rel), rel)
            text = read(rel)
            self.assertNotIn("stringData:", text, rel)
            self.assertNotIn("kind: Secret", text, rel)

    def test_burned_literals_absent_from_tree(self):
        roots = [ROOT / "deploy", ROOT / "docs", ROOT / "scripts", ROOT / "apps", ROOT / "adapters"]
        for folder in roots:
            for path in folder.rglob("*"):
                if not path.is_file() or path.suffix in {".png", ".jpg", ".webp"}:
                    continue
                text = path.read_text(encoding="utf-8", errors="ignore")
                for frag in BURNED:
                    self.assertNotIn(frag, text, f"{path} still contains a burned secret")


if __name__ == "__main__":
    unittest.main()
