"""BW-043: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_ops import sbom_required  # noqa: E402


class TestSbom(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/ops/sbom.md"))

    def test_policy(self):
        self.assertTrue(sbom_required(ROOT))
        from generate_sbom import generate_sbom
        import tempfile
        from pathlib import Path as P
        out = P(tempfile.mkdtemp()) / 'sbom.json'
        generate_sbom(ROOT, out)
        self.assertTrue(out.is_file())
        self.assertGreater(out.stat().st_size, 20)


if __name__ == "__main__":
    unittest.main()
