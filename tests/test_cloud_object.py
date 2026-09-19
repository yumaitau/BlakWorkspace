"""Blak Cloud object PUT writes and DELETE removes via the shipped portal handler."""

from __future__ import annotations

import json
import os
import socket
import subprocess
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest

from repo import ROOT


def _free_port() -> int:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


class _FakeS3(BaseHTTPRequestHandler):
    store: dict[str, bytes] = {}

    def log_message(self, format, *args):  # noqa: A003
        return

    def _path(self) -> str:
        return self.path.split("?", 1)[0]

    def do_PUT(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(n) if n else b""
        self.store[self._path()] = body
        self.send_response(200)
        self.end_headers()

    def do_DELETE(self):
        self.store.pop(self._path(), None)
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        body = self.store.get(self._path())
        if body is None:
            self.send_response(404)
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("content-type", "application/octet-stream")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class TestCloudObject(unittest.TestCase):
    portal = None
    s3httpd = None
    portal_port = 0
    s3_port = 0
    secret = "cloud-test-secret"

    @classmethod
    def setUpClass(cls):
        cls.s3_port = _free_port()
        _FakeS3.store = {}
        cls.s3httpd = ThreadingHTTPServer(("127.0.0.1", cls.s3_port), _FakeS3)
        threading.Thread(target=cls.s3httpd.serve_forever, daemon=True).start()
        cls.portal_port = _free_port()
        env = os.environ.copy()
        env.update({
            "PORT": str(cls.portal_port),
            "HOST": "127.0.0.1",
            "SESSION_SECRET": cls.secret,
            "FLOCI_HOST": "127.0.0.1",
            "FLOCI_PORT": str(cls.s3_port),
            "FLOCI_KEY": "test",
            "FLOCI_SECRET": "test",
            "OIDC_AUTH_URL": "http://id.example.test/application/o/authorize/",
        })
        cls.portal = subprocess.Popen(
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
                with urllib.request.urlopen(f"http://127.0.0.1:{cls.portal_port}/api/health", timeout=0.4) as resp:
                    if resp.status == 200:
                        return
            except Exception as exc:  # noqa: BLE001
                last = exc
                time.sleep(0.1)
        raise RuntimeError(f"portal did not start: {last}")

    @classmethod
    def tearDownClass(cls):
        if cls.portal:
            cls.portal.terminate()
            try:
                cls.portal.wait(timeout=3)
            except subprocess.TimeoutExpired:
                cls.portal.kill()
        if cls.s3httpd:
            cls.s3httpd.shutdown()

    def _cookie(self) -> str:
        token = subprocess.check_output(
            [
                "node",
                "-e",
                "const s=require('./apps/portal/server.js');"
                "process.stdout.write(s.sign({sub:'ada',name:'Ada',email:'ada@example.test',exp:Date.now()+3600000}));",
            ],
            cwd=str(ROOT),
            env={**os.environ, "SESSION_SECRET": self.secret},
            text=True,
        )
        return f"blak_session={token}"

    def _request(self, method: str, path: str, data: bytes | None = None, cookie: str | None = None):
        req = urllib.request.Request(
            f"http://127.0.0.1:{self.portal_port}{path}",
            data=data,
            method=method,
        )
        if cookie:
            req.add_header("Cookie", cookie)
        if data is not None:
            req.add_header("Content-Type", "application/octet-stream")
        try:
            return urllib.request.urlopen(req, timeout=5)
        except urllib.error.HTTPError as exc:
            return exc

    def test_dispatch_put_then_delete_removes(self):
        raw = subprocess.check_output(
            ["node", str(ROOT / "apps" / "portal" / "cloud-object.js")],
            cwd=str(ROOT),
            text=True,
        )
        data = json.loads(raw)
        self.assertTrue(data["putOk"])
        self.assertEqual(data["got"], "hello-cloud")
        self.assertTrue(data["delOk"])
        self.assertEqual(data["goneStatus"], 404)

    def test_http_put_writes_delete_removes(self):
        cookie = self._cookie()
        path = "/cloud/object?bucket=demo&key=note.txt"
        payload = b"hello-from-portal"
        put = self._request("PUT", path, data=payload, cookie=cookie)
        self.assertEqual(getattr(put, "status", None) or put.code, 200)
        put_body = json.loads(put.read().decode())
        self.assertTrue(put_body["ok"], put_body)

        got = self._request("GET", path, cookie=cookie)
        self.assertEqual(getattr(got, "status", None) or got.code, 200)
        self.assertEqual(got.read(), payload)

        deleted = self._request("DELETE", path, cookie=cookie)
        self.assertEqual(getattr(deleted, "status", None) or deleted.code, 200)
        del_body = json.loads(deleted.read().decode())
        self.assertTrue(del_body["ok"], del_body)

        missing = self._request("GET", path, cookie=cookie)
        self.assertEqual(getattr(missing, "status", None) or missing.code, 404)

    def test_unauthenticated_delete_is_401(self):
        resp = self._request("DELETE", "/cloud/object?bucket=demo&key=note.txt")
        self.assertEqual(getattr(resp, "status", None) or resp.code, 401)


if __name__ == "__main__":
    unittest.main()
