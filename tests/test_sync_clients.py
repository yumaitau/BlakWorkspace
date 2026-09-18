"""BW-028: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_drive import sync_clients  # noqa: E402


class TestSyncClients(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/drive/sync-clients.md"))

    def test_policy(self):
        self.assertEqual(sync_clients(ROOT), ['desktop', 'mobile'])


if __name__ == "__main__":
    unittest.main()
