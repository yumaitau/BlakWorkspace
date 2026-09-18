"""BW-025: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_drive import drive_quota_gb  # noqa: E402


class TestDriveQuotas(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/drive/quotas.md"))

    def test_policy(self):
        self.assertEqual(drive_quota_gb(ROOT), 10)


if __name__ == "__main__":
    unittest.main()
