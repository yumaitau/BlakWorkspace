"""BW-050: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_pilot import operator_docs  # noqa: E402


class TestOperatorDocs(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/ops/operator-index.md"))

    def test_policy(self):
        names = operator_docs(ROOT)
        self.assertEqual(names, ['secrets', 'backup-restore', 'hermes', 'notes-knowledge'])
        for name in names:
            self.assertTrue(exists(f'docs/runbooks/{name}.md'), name)


if __name__ == "__main__":
    unittest.main()
