"""BW-019: Nubus is the baseline IdP via shipped identity overlay."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_identity import REQUIRED_IDP, baseline_idp, idp_failures  # noqa: E402


class TestNubusIdp(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/identity/nubus-signin.md"))
        self.assertTrue(exists("deploy/overlays/blak/identity.yaml"))

    def test_baseline_is_nubus_oidc(self):
        self.assertEqual(baseline_idp(ROOT), REQUIRED_IDP)
        self.assertEqual(idp_failures(ROOT), [])


if __name__ == "__main__":
    unittest.main()
