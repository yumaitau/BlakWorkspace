"""BW-030: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_drive import drive_search_trims_acl  # noqa: E402


class TestDriveSearch(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/drive/search-export.md"))

    def test_policy(self):
        self.assertTrue(drive_search_trims_acl(ROOT))


if __name__ == "__main__":
    unittest.main()
