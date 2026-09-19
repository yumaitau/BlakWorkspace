"""BW-052: Blak Flow is a live engine — create, enable, trigger, activity."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest

from repo import ROOT, exists

sys.path.insert(0, str(ROOT / "scripts"))
from blak_flow import (  # noqa: E402
    FlowError,
    create_flow,
    create_store,
    default_connectors,
    list_runs,
    set_enabled,
    trigger,
)
from blak_pilot import blak_flow_status  # noqa: E402


def _sample_flow(store, owner="ada"):
    return create_flow(
        store,
        owner=owner,
        name="File to Sites",
        starter={"type": "event", "name": "drive.file_created"},
        steps=[
            {"connector": "drive", "action": "write_file", "params": {"path": "/flows/brief.txt"}},
            {"connector": "sites", "action": "create_page", "params": {"title": "Brief from Drive"}},
        ],
    )


class TestBlakFlow(unittest.TestCase):
    def test_doc_present(self):
        self.assertTrue(exists("docs/architecture/blak-flow.md"))
        text = (ROOT / "docs/architecture/blak-flow.md").read_text(encoding="utf-8")
        self.assertIn("live", text.lower())
        self.assertNotIn("not implemented", text.lower())

    def test_policy_live(self):
        self.assertEqual(blak_flow_status(ROOT), "live")

    def test_create_enable_trigger_persists_run_outcomes(self):
        store = create_store()
        connectors = default_connectors()
        flow = _sample_flow(store)
        self.assertFalse(flow["enabled"])
        self.assertGreaterEqual(len(flow["steps"]), 2)
        self.assertEqual(flow["starter"]["type"], "event")

        with self.assertRaises(FlowError):
            trigger(
                store,
                flow["id"],
                {
                    "type": "event",
                    "name": "drive.file_created",
                    "payload": {"path": "/inbox/brief.txt", "content": "hello from trigger"},
                },
                connectors,
            )

        set_enabled(store, flow["id"], True)
        event = {
            "type": "event",
            "name": "drive.file_created",
            "payload": {"path": "/inbox/brief.txt", "content": "hello from trigger"},
        }
        run = trigger(store, flow["id"], event, connectors)

        self.assertEqual(run["flowId"], flow["id"])
        self.assertEqual(run["status"], "ok")
        self.assertEqual(len(run["steps"]), 2)
        self.assertTrue(run["steps"][0]["outcome"]["ok"])
        self.assertTrue(run["steps"][1]["outcome"]["ok"])
        self.assertEqual(run["steps"][0]["connector"], "drive")
        self.assertEqual(run["steps"][1]["connector"], "sites")

        written = connectors["drive"].files.get("/flows/brief.txt")
        self.assertEqual(written, "hello from trigger")
        self.assertEqual(run["steps"][0]["outcome"]["path"], "/flows/brief.txt")
        self.assertEqual(run["steps"][0]["outcome"]["bytes"], len(written.encode("utf-8")))

        pages = connectors["sites"].pages
        self.assertEqual(len(pages), 1)
        self.assertEqual(pages[0]["title"], "Brief from Drive")
        self.assertEqual(pages[0]["body"], "hello from trigger")
        self.assertEqual(run["steps"][1]["outcome"]["pageId"], pages[0]["id"])

        history = list_runs(store, flow["id"])
        self.assertEqual(len(history), 1)
        self.assertEqual(history[0]["id"], run["id"])
        self.assertEqual(history[0]["steps"][0]["outcome"]["bytes"], run["steps"][0]["outcome"]["bytes"])

    def test_unmatched_starter_does_not_run_steps(self):
        store = create_store()
        connectors = default_connectors()
        flow = _sample_flow(store)
        set_enabled(store, flow["id"], True)
        with self.assertRaises(FlowError):
            trigger(
                store,
                flow["id"],
                {"type": "event", "name": "other.event", "payload": {"content": "nope"}},
                connectors,
            )
        self.assertEqual(connectors["drive"].files, {})
        self.assertEqual(connectors["sites"].pages, [])
        self.assertEqual(list_runs(store, flow["id"]), [])

    def test_js_engine_executes_same_path(self):
        out = subprocess.check_output(
            ["node", str(ROOT / "apps" / "portal" / "flow-engine.js")],
            cwd=str(ROOT),
            text=True,
        )
        data = json.loads(out)
        run = data["run"]
        self.assertEqual(run["status"], "ok")
        self.assertGreaterEqual(len(run["steps"]), 2)
        self.assertTrue(run["steps"][0]["outcome"]["ok"])
        self.assertTrue(run["steps"][1]["outcome"]["ok"])
        self.assertEqual(data["driveFiles"]["/flows/brief.txt"], "hello from trigger")
        self.assertEqual(data["sitePages"][0]["body"], "hello from trigger")
        self.assertEqual(data["sitePages"][0]["title"], "Brief from Drive")


if __name__ == "__main__":
    unittest.main()
