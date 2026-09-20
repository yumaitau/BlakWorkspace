"""Homelab k3s manifests must not commit OIDC or bootstrap secret literals."""

from __future__ import annotations

import unittest

from repo import ROOT, exists, read

BURNED = (
    "05S5Ak-qklrGDLSsArrVF7-D6q2HPvL0x1HeyohkmkU",
    "XFGVKvmDf0AqgGZUA_XH6FEW5mSoZUGT01NdICqxRwr42b4rVVidVQ",
    "Blak-1KBXzDQc8i4Hh2k-OhseYZeL",
    "FxL6Xtu4X_FZXvA9kFuZDC_f6alZHjlLuVQ-JSJWRlFE9b9rTZUI2hcrU0O2Eeo9",
    "b3pB2kyigMfo_nHqwU9WYYKC3ExKro1NFnNGMABAQ5o",
    "BJCEJrM7QB9C5h6d-AaoFEq1cMErPl1uYsy-rQpMDc8",
    "z0LsIW3Pyt7hnCNIVJS-qQWVwbOqs2-07Ahg0b8dLR4",
    "OcAdmin-ChangeMe-7f3a9c2e5b1d48",
    "CollabAdmin-ChangeMe-4d8f1a",
    "dbdead808a4fe5daaf2e06146bb0d958ec6987ae2fd6efa72eb1c4c720a4db64",
    "ad7359ab461ebb2fe55b9641e7fc4405020f89863dbcfef3d9ad53b3f4c11f5a",
    "op-SK-c9f2a1e47b3d4c5a8e6f7a1b3c5d9e2f4a6b8c1d3e5f7a9b1c3d5e7f9a2b4",
)

SECRET_FILES = (
    "deploy/k3s/micro/30-portal.yaml",
    "deploy/k3s/micro/40-authentik.yaml",
    "deploy/k3s/micro/50-opencloud.yaml",
    "deploy/k3s/micro/60-collabora.yaml",
    "deploy/k3s/micro/70-outline.yaml",
    "deploy/k3s/micro/90-rocketchat.yaml",
    "deploy/k3s/micro/91-kaneo.yaml",
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
