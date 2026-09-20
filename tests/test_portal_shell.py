"""Portal chrome: waffle, search, account chip, grouped nav, Home, Admin, Flow live."""

from __future__ import annotations

import json
import subprocess
import unittest

from repo import ROOT, exists, read


def _fixture() -> dict:
    out = subprocess.check_output(
        ["node", str(ROOT / "apps" / "portal" / "render-fixture.js")],
        cwd=str(ROOT),
        text=True,
    )
    return json.loads(out)


class TestPortalShell(unittest.TestCase):
    def test_shell_has_gws_m365_controls(self):
        data = _fixture()
        html = data["html"]
        self.assertIn('aria-label="App launcher"', html)
        self.assertIn('id=wbtn', html)
        self.assertIn("class=waffle", html)
        self.assertIn("class=search", html)
        self.assertIn("Search apps and workspace", html)
        self.assertIn("class=userchip", html)
        self.assertIn("Ada Example", html)
        self.assertIn("class=avatar", html)
        self.assertIn("Blak Home", html)
        self.assertIn("Blak Admin", html)
        self.assertIn("Blak Flow", html)
        self.assertIn('href="/flow"', html)
        self.assertIn("class=nav-sec", html)
        self.assertIn("Workspace", data["nav"])
        self.assertIn("Organise", data["nav"])
        self.assertIn("Platform", data["nav"])

    def test_flow_is_live_not_soon(self):
        data = _fixture()
        flow = next(a for a in data["apps"] if a["id"] == "flow")
        self.assertEqual(flow["status"], "live")
        self.assertEqual(flow["url"], "/flow")
        self.assertEqual(flow["oidcClient"], "blak-portal")
        self.assertNotIn('class="appitem soon"', _flow_waffle_item(data["html"]))
        admin = next(a for a in data["apps"] if a["id"] == "idp")
        self.assertEqual(admin["status"], "live")
        self.assertTrue(admin["url"])

    def test_playwright_targets_homelab_portal(self):
        self.assertTrue(exists("e2e/playwright.config.js"))
        self.assertTrue(exists("e2e/tests/homelab.spec.js"))
        cfg = read("e2e/playwright.config.js")
        spec = read("e2e/tests/homelab.spec.js")
        self.assertIn("portal.homelab.local", cfg)
        self.assertIn("ignoreHTTPSErrors", cfg)
        self.assertIn("Sign in with Blak ID", spec)
        self.assertIn("data-testid=\"waffle\"", spec)
        self.assertIn("data-app=\"flow\"", spec)
        self.assertIn("/flow", spec)
        self.assertIn("run-row", spec)
        self.assertIn("chat.homelab.local", spec)
        self.assertIn("projects.homelab.local", spec)

    def test_chat_and_projects_are_live_oidc(self):
        data = _fixture()
        chat = next(a for a in data["apps"] if a["id"] == "chat")
        projects = next(a for a in data["apps"] if a["id"] == "projects")
        self.assertEqual(chat["status"], "live")
        self.assertEqual(chat["url"], "https://chat.homelab.local")
        self.assertEqual(chat["oidcClient"], "rocketchat")
        self.assertEqual(projects["status"], "live")
        self.assertEqual(projects["url"], "https://projects.homelab.local")
        self.assertEqual(projects["oidcClient"], "kaneo")


def _flow_waffle_item(html: str) -> str:
    marker = "Blak Flow"
    i = html.find(marker)
    if i < 0:
        return ""
    start = html.rfind("<", 0, i)
    end = html.find("</a>", i)
    if end < 0:
        end = html.find("</span>", i)
    return html[start:end + 4]


if __name__ == "__main__":
    unittest.main()
