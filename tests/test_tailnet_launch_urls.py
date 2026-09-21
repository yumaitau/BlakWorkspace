"""Exercise the identity reconciliation embedded in the deployment script."""
import ast
import contextlib
import io
from pathlib import Path
from types import SimpleNamespace
import unittest


def reconcile(apps):
    tree = ast.parse(Path("scripts/deploy/publish-tailnet.py").read_text())
    source = next(node.value.value for node in ast.walk(tree)
                  if isinstance(node, ast.Assign)
                  and any(isinstance(t, ast.Name) and t.id == "source" for t in node.targets)
                  and isinstance(node.value, ast.Constant)
                  and "IDENTITY_LINK_BACKUP" in str(node.value.value))
    block = source[source.index("links=[]"):source.index("for provider in OAuth2Provider.objects.all():")]
    application = type("Application", (), {"objects": SimpleNamespace(all=lambda: apps),
                                         "_meta": SimpleNamespace(label="authentik_core.Application")})
    empty = type("Empty", (), {"objects": SimpleNamespace(all=lambda: [])})
    scope = {"Application": application, "Brand": empty, "Flow": empty,
             "origins": {"portal": "https://node.tail123.ts.net", "drive": "https://node.tail123.ts.net:8445"},
             "domain": "homelab.local", "json": __import__("json")}
    with contextlib.redirect_stdout(io.StringIO()):
        exec(block, scope)
    return scope["links"]


def app(explicit="", fallback=None):
    item = SimpleNamespace(meta_launch_url=explicit, meta_icon="", pk="example",
                           _meta=SimpleNamespace(label="authentik_core.Application"), saves=0)
    item.get_launch_url = lambda: explicit or fallback
    def save():
        item.saves += 1
    item.save = save
    return item


class TailnetLaunchTests(unittest.TestCase):
    def test_blank_launch_uses_provider_origin_and_preserves_rollback(self):
        item = app(fallback="http://portal.homelab.local")
        backup = reconcile([item])
        self.assertEqual(item.meta_launch_url, "https://node.tail123.ts.net")
        self.assertEqual(backup[0]["fields"], {"meta_launch_url": ""})
        self.assertEqual(reconcile([item]), [])

    def test_explicit_launch_preserves_path_and_query(self):
        item = app(explicit="https://drive.homelab.local/files?view=all")
        reconcile([item])
        self.assertEqual(item.meta_launch_url, "https://node.tail123.ts.net:8445/files?view=all")

    def test_unrelated_and_missing_provider_origins_remain_unchanged(self):
        items = [app(fallback=None), app(fallback="https://other.example/app"),
                 app(explicit="https://other.example/app")]
        self.assertEqual(reconcile(items), [])
        self.assertEqual([item.saves for item in items], [0, 0, 0])
