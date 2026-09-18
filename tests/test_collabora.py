"""BW-027: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_drive import collabora_enabled  # noqa: E402


class TestCollabora(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/drive/collabora.md"))

    def test_policy(self):
        self.assertTrue(collabora_enabled(ROOT))


if __name__ == "__main__":
    unittest.main()
