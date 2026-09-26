"""SSO gate: unauthenticated Home/Flow go to Blak ID; live apps declare their authentication mode."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import time
import urllib.error
import urllib.request
import unittest

from repo import ROOT
from portal_fixture import portal_session


def _free_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class TestSsoGate(unittest.TestCase):
    proc = None
    port = 0
    secret = "sso-test-secret"

    @classmethod
    def setUpClass(cls):
        cls.port = _free_port()
        env = os.environ.copy()
        env["PORT"] = str(cls.port)
        env["HOST"] = "127.0.0.1"
        env["SESSION_SECRET"] = cls.secret
        env["OIDC_AUTH_URL"] = "http://id.example.test/application/o/authorize/"
        env["OIDC_CLIENT_ID"] = "blak-portal"
        env["FLOW_STORE"] = os.path.join(os.environ.get("TMPDIR", "/tmp"), f"blak-flow-sso-{cls.port}.json")
        cls.session_directory, cls.token = portal_session(env)
        cls.proc = subprocess.Popen(
            ["node", str(ROOT / "apps" / "portal" / "server.js")],
            cwd=str(ROOT),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        deadline = time.time() + 8
        last = None
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(f"http://127.0.0.1:{cls.port}/api/health", timeout=0.4) as resp:
                    if resp.status == 200:
                        return
            except Exception as exc:  # noqa: BLE001 — wait loop
                last = exc
                time.sleep(0.1)
        raise RuntimeError(f"portal did not start: {last}")

    @classmethod
    def tearDownClass(cls):
        if cls.proc:
            cls.proc.terminate()
            try:
                cls.proc.wait(timeout=3)
            except subprocess.TimeoutExpired:
                cls.proc.kill()

        cls.session_directory.cleanup()

    def _get(self, path: str, cookie: str | None = None, follow: bool = True):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}{path}")
        if cookie:
            req.add_header("Cookie", cookie)
        opener = urllib.request.build_opener() if follow else urllib.request.build_opener(
            urllib.request.HTTPRedirectHandler
        )
        if not follow:
            class _NoRedirect(urllib.request.HTTPRedirectHandler):
                def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: N803
                    return None

            opener = urllib.request.build_opener(_NoRedirect)
        try:
            return opener.open(req, timeout=3)
        except urllib.error.HTTPError as exc:
            return exc

    def _status(self, resp):
        return getattr(resp, "status", None) or getattr(resp, "code", None)

    def test_home_unauthenticated_is_signin_that_starts_oidc(self):
        resp = self._get("/")
        body = resp.read().decode("utf-8")
        self.assertEqual(self._status(resp), 200)
        self.assertIn("Sign in with Blak ID", body)
        self.assertIn('href="/login"', body)

    def test_login_redirects_to_blak_id_oidc(self):
        resp = self._get("/login", follow=False)
        self.assertEqual(self._status(resp), 302)
        location = resp.headers.get("Location") or ""
        self.assertIn("id.example.test", location)
        self.assertIn("client_id=blak-portal", location)
        self.assertIn("response_type=code", location)

    def test_flow_unauthenticated_redirects_to_oidc_start(self):
        resp = self._get("/flow", follow=False)
        self.assertEqual(self._status(resp), 302)
        location = resp.headers.get("Location") or ""
        self.assertTrue(location.endswith("/login") or location == "/login", location)

    def test_signed_in_flow_renders_builder_chrome(self):
        token = self.token
        resp = self._get("/flow", cookie=f"blak_session={token}")
        body = resp.read().decode("utf-8")
        self.assertEqual(self._status(resp), 200)
        self.assertIn("class=userchip", body)
        self.assertIn("Ada Example", body)
        self.assertIn("Blak Flow", body)
        self.assertIn("My flows", body)
        self.assertIn("Activity", body)

    def test_governance_and_ci_gate(self):
        for rel in ("LICENSE", "SECURITY.md", "CONTRIBUTING.md"):
            self.assertTrue((ROOT / rel).is_file(), rel)
        contrib = (ROOT / "CONTRIBUTING.md").read_text(encoding="utf-8")
        self.assertIn("pull request", contrib.lower())
        security = (ROOT / "SECURITY.md").read_text(encoding="utf-8")
        self.assertIn("privately", security.lower())
        workflow = (ROOT / ".github/workflows/validate.yml").read_text(encoding="utf-8")
        self.assertIn("unittest", workflow)
        self.assertNotIn("terraform apply", workflow)
        self.assertNotIn("helmfile apply", workflow)

    def test_live_apps_declare_sso(self):
        raw = subprocess.check_output(
            ["node", "-e", "console.log(JSON.stringify(require('./apps/portal/catalog.js').APPS))"],
            cwd=str(ROOT),
            text=True,
        )
        apps = json.loads(raw)
        live = [a for a in apps if a.get("status") == "live"]
        self.assertGreaterEqual(len(live), 6)
        crm = next(a for a in live if a["id"] == "crm")
        self.assertEqual(crm["oidcClient"], "blak-crm")
        self.assertIn("Frappe CRM", crm["backend"])
        missing = [a["id"] for a in live if not a.get("oidcClient") and a.get("authentication") != "external"]
        self.assertEqual(missing, [])
        # A hosted service outside the workspace must say so and must not be health-checked.
        for app in live:
            if app.get("authentication") == "external":
                self.assertFalse(app.get("oidcClient"), app["id"])
                self.assertIsNone(app.get("check"), app["id"])
                self.assertNotIn("Blak", app["name"], app["id"])
        flow = next(a for a in live if a["id"] == "flow")
        self.assertEqual(flow["oidcClient"], "blak-portal")


if __name__ == "__main__":
    unittest.main()
