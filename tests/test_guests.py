"""BW-023: external collaborators default deny."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_identity import guest_default  # noqa: E402


class TestExternalCollaborators(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/identity/external-collaborators.md"))

    def test_guest_default_deny(self):
        self.assertEqual(guest_default(ROOT), "deny")


if __name__ == "__main__":
    unittest.main()
