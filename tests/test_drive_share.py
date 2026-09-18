"""BW-026: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_drive import share_link_default  # noqa: E402


class TestDriveShare(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/drive/share-defaults.md"))

    def test_policy(self):
        self.assertEqual(share_link_default(ROOT), 'authenticated')


if __name__ == "__main__":
    unittest.main()
