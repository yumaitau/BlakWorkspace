"""BW-029: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_drive import drive_migration  # noqa: E402


class TestDriveMigration(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/drive/migration.md"))

    def test_policy(self):
        self.assertEqual(drive_migration(ROOT), 'copy-then-cutover')


if __name__ == "__main__":
    unittest.main()
