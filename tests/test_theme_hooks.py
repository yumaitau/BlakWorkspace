"""BW-014: theme hook inventory, YAML overlay stubs, limitations, ADR-006."""

from __future__ import annotations

import unittest

from repo import exists, read


def _yaml_stub_ok(text: str) -> None:
    for i, line in enumerate(text.splitlines(), 1):
        if "\t" in line:
            raise AssertionError(f"tab indent on line {i}")
        stripped = line.split("#", 1)[0].rstrip()
        if not stripped:
            continue
        if ":" not in stripped and not stripped.lstrip().startswith("-"):
            raise AssertionError(f"not YAML mapping/list on line {i}: {line!r}")


class TestThemeHooks(unittest.TestCase):
    def test_hook_inventory_complete(self):
        self.assertTrue(exists("docs/brand/theme-hooks.md"))
        text = read("docs/brand/theme-hooks.md")
        for hook in (
            "theme.yaml.gotmpl",
            "helmfile/files/theme",
            "portalStylesheets.css",
            "functional.portal",
        ):
            self.assertIn(hook, text, hook)

    def test_overlay_stub_is_valid_yaml_shape(self):
        self.assertTrue(exists("deploy/overlays/blak/theme-values.example.yaml"))
        text = read("deploy/overlays/blak/theme-values.example.yaml")
        _yaml_stub_ok(text)
        self.assertIn("productName", text)
        self.assertIn("primaryColor: null", text)

    def test_limitations_documented(self):
        text = read("docs/brand/theme-hooks.md")
        self.assertIn("## Limitations", text)
        self.assertIn("Upgrade", text)
        self.assertIn("do not invent", text.lower())

    def test_adr_006_cites_hooks(self):
        adr = read("docs/adr/ADR-006.md")
        self.assertIn("theme.yaml.gotmpl", adr)
        self.assertIn("theme-hooks.md", adr)


if __name__ == "__main__":
    unittest.main()
