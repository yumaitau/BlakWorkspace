"""BW-002: shipped upstream pin with tag, commit, date, gaps, ADR-001 cite."""

from __future__ import annotations

import unittest
import urllib.error
import urllib.request

from repo import exists, read

PIN_TAG = "v1.18.2"
PIN_COMMIT = "eab2ee774187308f82307f0daaf1471dfe560f34"
PIN_DATE = "2026-09-11"
URLS = [
    "https://gitlab.opencode.de/bmi/opendesk/deployment/opendesk",
    "https://docs.opendesk.eu/operations/",
]


class TestUpstreamBaseline(unittest.TestCase):
    def test_baseline_file_exists(self):
        self.assertTrue(exists("docs/upstream-baseline.md"))

    def test_lists_tag_commit_date(self):
        text = read("docs/upstream-baseline.md")
        self.assertIn(PIN_TAG, text)
        self.assertIn(PIN_COMMIT, text)
        self.assertIn(PIN_DATE, text)

    def test_gaps_called_out(self):
        text = read("docs/upstream-baseline.md").lower()
        self.assertIn("gaps", text)
        self.assertIn("digest", text)
        self.assertIn("invent", text)

    def test_urls_present(self):
        text = read("docs/upstream-baseline.md")
        for url in URLS:
            self.assertIn(url, text)

    def test_links_resolve(self):
        for url in URLS:
            req = urllib.request.Request(url, method="HEAD")
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    status = getattr(resp, "status", 200)
            except urllib.error.HTTPError as err:
                # Some hosts reject HEAD; fall back to GET.
                if err.code >= 500:
                    raise
                req = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(req, timeout=15) as resp:
                    status = getattr(resp, "status", 200)
            self.assertLess(status, 400, f"{url} status {status}")

    def test_adr_001_references_pin(self):
        adr = read("docs/adr/ADR-001.md")
        self.assertIn(PIN_TAG, adr)
        self.assertIn(PIN_COMMIT, adr)
        self.assertIn("upstream-baseline.md", adr)


if __name__ == "__main__":
    unittest.main()
