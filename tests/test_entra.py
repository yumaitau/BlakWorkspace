"""BW-021: Entra federation stays off in the identity overlay."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_identity import entra_federation_enabled  # noqa: E402


class TestEntraFederation(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/identity/entra-federation.md"))

    def test_entra_off(self):
        self.assertFalse(entra_federation_enabled(ROOT))


if __name__ == "__main__":
    unittest.main()
