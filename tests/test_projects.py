"""BW-035: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_collab import projects_backend  # noqa: E402


class TestProjects(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/collab/projects.md"))

    def test_policy(self):
        self.assertEqual(projects_backend(ROOT), 'openproject')


if __name__ == "__main__":
    unittest.main()
