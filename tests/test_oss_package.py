"""BW-051: shipped overlay policy."""

from __future__ import annotations

import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_pilot import oss_package_files  # noqa: E402


class TestOssPackage(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/release/oss-package.md"))

    def test_policy(self):
        files = oss_package_files(ROOT)
        self.assertEqual(files, ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md'])
        for rel in files:
            self.assertTrue(exists(rel), rel)


if __name__ == "__main__":
    unittest.main()
