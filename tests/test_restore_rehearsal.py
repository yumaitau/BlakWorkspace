"""BW-045: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_ops import restore_rehearsal_status  # noqa: E402


class TestRestoreRehearsal(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/ops/restore-rehearsal.md"))

    def test_policy(self):
        self.assertEqual(restore_rehearsal_status(ROOT), 'not-run')


if __name__ == "__main__":
    unittest.main()
