"""ADR-013: Terraform/Helm/Helmfile planner drives shipped blak_deploy."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest

from repo import ROOT, exists, read

sys.path.insert(0, str(ROOT / "scripts"))

from blak_deploy import (  # noqa: E402
    CERT_MANAGER_CHART,
    DEFAULT_DOMAIN,
    INGRESS_NGINX_CHART,
    PIN_COMMIT,
    PIN_TAG,
    dump_yaml,
    helmfile_values,
    plan_deploy,
    validate_deploy,
)


class TestDeployPlanner(unittest.TestCase):
    def test_eval_k3s_plan_without_suite(self):
        plan = plan_deploy(
            ROOT,
            target="k3s",
            profile="eval",
            apply_suite=False,
            apply_sidecars=False,
            allow_paid_cloud=False,
            allow_prod=False,
            cluster_create=True,
            opendesk_checkout="",
        )
        self.assertEqual(plan["errors"], [])
        self.assertTrue(any("k3d" in s for s in plan["steps"]))
        self.assertTrue(any(INGRESS_NGINX_CHART in s for s in plan["steps"]))
        self.assertTrue(any(CERT_MANAGER_CHART in s for s in plan["steps"]))
        self.assertFalse(any("helmfile apply" in s for s in plan["steps"]))
        self.assertEqual(plan["pin_tag"], PIN_TAG)
        self.assertEqual(plan["pin_commit"], PIN_COMMIT)

    def test_prod_apply_rejected(self):
        plan = plan_deploy(
            ROOT,
            target="k3s",
            profile="prod",
            apply_suite=True,
            apply_sidecars=False,
            allow_paid_cloud=False,
            allow_prod=False,
            cluster_create=True,
            opendesk_checkout="/x",
            master_password="x",
        )
        self.assertTrue(any("prod apply" in e for e in plan["errors"]), plan["errors"])

    def test_eks_without_paid_flag_rejected(self):
        plan = plan_deploy(
            ROOT,
            target="eks",
            profile="eval",
            apply_suite=True,
            apply_sidecars=False,
            allow_paid_cloud=False,
            allow_prod=False,
            cluster_create=True,
            opendesk_checkout="/x",
            master_password="x",
        )
        self.assertTrue(any("allow_paid_cloud" in e for e in plan["errors"]), plan["errors"])

    def test_suite_needs_checkout_and_password(self):
        plan = plan_deploy(
            ROOT,
            target="k3s",
            profile="eval",
            apply_suite=True,
            apply_sidecars=False,
            allow_paid_cloud=False,
            allow_prod=False,
            cluster_create=False,
            opendesk_checkout="",
            master_password="",
        )
        text = " ".join(plan["errors"])
        self.assertIn("opendesk_checkout", text)
        self.assertIn("MASTER_PASSWORD", text)

    def test_sites_tbd_refuses_helm(self):
        plan = plan_deploy(
            ROOT,
            target="k3s",
            profile="eval",
            apply_suite=False,
            apply_sidecars=True,
            allow_paid_cloud=False,
            allow_prod=False,
            cluster_create=False,
            opendesk_checkout="",
        )
        self.assertTrue(any("TBD" in e for e in plan["errors"]), plan["errors"])
        self.assertFalse(plan["sites_install"])

    def test_helmfile_values_follow_overlays(self):
        values = helmfile_values(ROOT, "eval", DEFAULT_DOMAIN)
        self.assertFalse(values["apps"]["xwiki"]["enabled"])
        self.assertFalse(values["apps"]["oxAppSuite"]["enabled"])
        self.assertTrue(values["apps"]["nubus"]["enabled"])
        self.assertTrue(values["apps"]["nextcloud"]["enabled"])
        self.assertTrue(values["apps"]["collabora"]["enabled"])
        self.assertTrue(values["apps"]["element"]["enabled"])
        self.assertTrue(values["apps"]["jitsi"]["enabled"])
        self.assertEqual(values["ingress"]["ingressClassName"], "nginx")
        self.assertEqual(values["blak"]["identityProvider"], "nubus")
        committed = read("deploy/helmfile/opendesk-blak.yaml")
        self.assertEqual(committed, dump_yaml(values) + "\n")

    def test_validate_deploy_clean(self):
        self.assertEqual(validate_deploy(ROOT), [])

    def test_cli_plan_json(self):
        proc = subprocess.run(
            [sys.executable, str(ROOT / "scripts" / "blak_deploy.py"), "plan", "--target", "k3s", "--cluster-create"],
            check=False,
            capture_output=True,
            text=True,
            cwd=str(ROOT),
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        data = json.loads(proc.stdout)
        self.assertEqual(data["errors"], [])

    def test_terraform_layout_and_no_ci_apply(self):
        self.assertTrue(exists("deploy/terraform/examples/k3s.tfvars"))
        self.assertTrue(exists("deploy/terraform/eks/main.tf"))
        addons = read("deploy/terraform/addons.tf")
        self.assertIn(INGRESS_NGINX_CHART, addons)
        self.assertIn(CERT_MANAGER_CHART, addons)
        self.assertNotIn("sha256:", addons)
        workflow = read(".github/workflows/validate.yml")
        self.assertNotIn("terraform apply", workflow)
        self.assertNotIn("helmfile apply", workflow)
        k3s = read("deploy/terraform/k3s.tf")
        self.assertIn("k3d-up.sh", k3s)
        eks = read("deploy/terraform/eks/main.tf")
        self.assertIn("allow_paid_cloud", eks)
        self.assertIn("ap-southeast-2", read("deploy/terraform/eks/variables.tf"))

    def test_adr_and_runbook(self):
        adr = read("docs/adr/ADR-013.md")
        self.assertIn("Status: Accepted", adr)
        self.assertIn("k3d", adr)
        self.assertIn("Helmfile", adr)
        self.assertTrue(exists("docs/runbooks/cluster-standup.md"))
        self.assertTrue(exists("deploy/terraform/README.md"))


if __name__ == "__main__":
    unittest.main()
