"""BW-031: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_collab import chat_backend  # noqa: E402


class TestChat(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/collab/chat.md"))

    def test_policy(self):
        self.assertEqual(chat_backend(ROOT), 'element')


if __name__ == "__main__":
    unittest.main()
