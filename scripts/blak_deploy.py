"""Terraform/Helm/Helmfile deploy planner. Never applies a cluster itself."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from blak_collab import chat_backend, meet_backend, notes_backend, ox_enabled, projects_backend
from blak_drive import drive_config
from blak_profiles import load_profile
from blak_sites import CHART_VALUES_REL, FILE_PROVIDER, SSO_IDP

PIN_TAG = "v1.18.2"
PIN_COMMIT = "eab2ee774187308f82307f0daaf1471dfe560f34"
OPENDESK_GIT = "https://gitlab.opencode.de/bmi/opendesk/deployment/opendesk.git"
TARGETS = ("k3s", "eks", "external")
PROFILES = ("eval", "staging", "prod")
DEFAULT_NAMESPACE = "blak-eval"
DEFAULT_DOMAIN = "eval.blak.local"
DEFAULT_CLUSTER = "blak-eval"
INGRESS_NGINX_CHART = "4.11.5"
CERT_MANAGER_CHART = "v1.16.2"

REQUIRED_RELATIVE = (
    "deploy/terraform/versions.tf",
    "deploy/terraform/variables.tf",
    "deploy/terraform/main.tf",
    "deploy/terraform/k3s.tf",
    "deploy/terraform/addons.tf",
    "deploy/terraform/suite.tf",
    "deploy/terraform/sidecars.tf",
    "deploy/terraform/examples/k3s.tfvars",
    "deploy/terraform/examples/external.tfvars",
    "deploy/terraform/scripts/k3d-up.sh",
    "deploy/terraform/scripts/fetch-opendesk.sh",
    "deploy/terraform/README.md",
    "deploy/terraform/eks/main.tf",
    "deploy/helmfile/opendesk-blak.yaml",
    "docs/runbooks/cluster-standup.md",
    "docs/adr/ADR-013.md",
)


def dump_yaml(obj: Any, indent: int = 0) -> str:
    pad = "  " * indent
    if isinstance(obj, dict):
        lines = []
        for key, val in obj.items():
            if isinstance(val, dict):
                lines.append(f"{pad}{key}:")
                lines.append(dump_yaml(val, indent + 1))
            elif isinstance(val, list):
                if not val:
                    lines.append(f"{pad}{key}: []")
                else:
                    lines.append(f"{pad}{key}:")
                    for item in val:
                        lines.append(f"{pad}  - {item}")
            elif isinstance(val, bool):
                lines.append(f"{pad}{key}: {'true' if val else 'false'}")
            elif val is None:
                lines.append(f"{pad}{key}: null")
            else:
                lines.append(f"{pad}{key}: {val}")
        return "\n".join(lines)
    return f"{pad}{obj}"


def chart_image_tag(root: Path, rel: str, section: str | None = None) -> str:
    data = load_profile(root / rel)
    if section:
        nested = data.get(section) or {}
        if isinstance(nested, dict) and nested.get("imageTag"):
            return str(nested.get("imageTag") or "")
    return str(data.get("imageTag") or "")


def sites_image_tag(root: Path) -> str:
    return chart_image_tag(root, CHART_VALUES_REL)


def hermes_image_tag(root: Path) -> str:
    return chart_image_tag(root, "deploy/overlays/blak/hermes-values.example.yaml", "hermes")


def helmfile_values(root: Path, profile: str, domain: str) -> dict:
    """Map Blak overlay flags onto openDesk helmfile keys (apps.*, ingress)."""
    flags = load_profile(root / "deploy" / "profiles" / profile / "values.yaml")
    knowledge = flags.get("knowledge") or {}
    optional = flags.get("optional") or {}
    drive = drive_config(root)
    xwiki = bool(knowledge.get("xwiki"))
    ox = bool(optional.get("oxMailCalendar")) or ox_enabled(root)
    collabora = bool(drive.get("collabora"))
    return {
        "global": {"domain": domain},
        "ingress": {"ingressClassName": "nginx"},
        "cluster": {
            "service": {"type": "NodePort"},
            "container": {"engine": "containerd"},
        },
        "persistence": {"storageClassNames": {"RWO": "local-path"}},
        "apps": {
            "xwiki": {"enabled": xwiki},
            "oxAppSuite": {"enabled": ox},
            "collabora": {"enabled": collabora},
            "nextcloud": {"enabled": True},
            "element": {"enabled": chat_backend(root) == "element"},
            "jitsi": {"enabled": meet_backend(root) == "jitsi"},
            "notes": {"enabled": notes_backend(root) == "notes"},
            "openproject": {"enabled": projects_backend(root) == "openproject"},
            "nubus": {"enabled": True},
            "dovecot": {"enabled": ox},
        },
        "blak": {
            "profile": profile,
            "identityProvider": SSO_IDP,
            "fileProvider": FILE_PROVIDER,
            "pin": PIN_TAG,
        },
    }


def plan_deploy(
    root: Path,
    *,
    target: str,
    profile: str,
    apply_suite: bool,
    apply_sidecars: bool,
    allow_paid_cloud: bool,
    allow_prod: bool,
    cluster_create: bool,
    opendesk_checkout: str,
    domain: str = DEFAULT_DOMAIN,
    namespace: str = DEFAULT_NAMESPACE,
    master_password: str = "",
    install_addons: bool = True,
) -> dict:
    errors: list[str] = []
    steps: list[str] = []
    if target not in TARGETS:
        errors.append(f"target must be one of {TARGETS}")
    if profile not in PROFILES:
        errors.append(f"profile must be one of {PROFILES}")
    if profile == "prod" and (apply_suite or cluster_create or apply_sidecars) and not allow_prod:
        errors.append("prod apply is forbidden unless allow_prod is true")
    if target == "eks" and (cluster_create or apply_suite) and not allow_paid_cloud:
        errors.append("EKS create/suite requires allow_paid_cloud")
    if apply_suite and not str(opendesk_checkout or "").strip():
        errors.append(f"apply_suite requires opendesk_checkout at pin {PIN_TAG}")
    if apply_suite and not str(master_password or "").strip():
        errors.append("apply_suite requires MASTER_PASSWORD from the environment, never git")
    checkout = Path(opendesk_checkout) if opendesk_checkout else None
    if apply_suite and checkout is not None and checkout.exists():
        pin_file = checkout / "helmfile.yaml.gotmpl"
        if not pin_file.is_file():
            errors.append("opendesk_checkout is missing helmfile.yaml.gotmpl")

    sites_tag = sites_image_tag(root)
    hermes_tag = hermes_image_tag(root)
    sites_install = apply_sidecars and sites_tag not in {"", "TBD"}
    if apply_sidecars and not sites_install:
        errors.append("Sites helm install refused: imageTag is TBD (do not invent a digest)")
    if apply_sidecars and hermes_tag in {"", "TBD"}:
        # Hermes has no chart in this repo; calling out TBD is enough.
        pass

    if target == "k3s" and cluster_create:
        steps.append("k3d cluster create (k3s-in-docker), traefik disabled")
    elif target == "eks" and cluster_create:
        steps.append("terraform/eks: VPC + EKS (paid)")
    else:
        steps.append("use existing kubeconfig")
    if install_addons:
        steps.append(f"helm ingress-nginx {INGRESS_NGINX_CHART}")
        steps.append(f"helm cert-manager {CERT_MANAGER_CHART}")
    if apply_suite:
        steps.append(
            f"helmfile apply -e dev -n {namespace} in opendesk {PIN_TAG} ({PIN_COMMIT[:8]})"
        )
    if sites_install:
        steps.append("helm upgrade blak-sites deploy/sites/chart")

    values = helmfile_values(root, profile if profile in PROFILES else "eval", domain)
    return {
        "target": target,
        "profile": profile,
        "apply_suite": apply_suite,
        "apply_sidecars": apply_sidecars,
        "sites_install": sites_install,
        "sites_image_tag": sites_tag,
        "hermes_image_tag": hermes_tag,
        "pin_tag": PIN_TAG,
        "pin_commit": PIN_COMMIT,
        "opendesk_git": OPENDESK_GIT,
        "domain": domain,
        "namespace": namespace,
        "errors": errors,
        "steps": steps,
        "helmfile_values": values,
    }


def validate_deploy(root: Path) -> list[str]:
    errors: list[str] = []
    for rel in REQUIRED_RELATIVE:
        if not (root / rel).is_file():
            errors.append(f"missing {rel}")
    ok = plan_deploy(
        root,
        target="k3s",
        profile="eval",
        apply_suite=False,
        apply_sidecars=False,
        allow_paid_cloud=False,
        allow_prod=False,
        cluster_create=True,
        opendesk_checkout="",
    )
    errors.extend(ok["errors"])
    prod = plan_deploy(
        root,
        target="k3s",
        profile="prod",
        apply_suite=True,
        apply_sidecars=False,
        allow_paid_cloud=False,
        allow_prod=False,
        cluster_create=True,
        opendesk_checkout="/tmp/opendesk",
    )
    if not any("prod apply" in e for e in prod["errors"]):
        errors.append("prod apply must be rejected by the planner")
    eks = plan_deploy(
        root,
        target="eks",
        profile="eval",
        apply_suite=True,
        apply_sidecars=False,
        allow_paid_cloud=False,
        allow_prod=False,
        cluster_create=True,
        opendesk_checkout="/tmp/opendesk",
    )
    if not any("allow_paid_cloud" in e for e in eks["errors"]):
        errors.append("EKS suite without allow_paid_cloud must be rejected")
    sidecar = plan_deploy(
        root,
        target="k3s",
        profile="eval",
        apply_suite=False,
        apply_sidecars=True,
        allow_paid_cloud=False,
        allow_prod=False,
        cluster_create=False,
        opendesk_checkout="",
    )
    if not any("TBD" in e for e in sidecar["errors"]):
        errors.append("Sites TBD image must refuse helm install")
    committed = (root / "deploy/helmfile/opendesk-blak.yaml").read_text(encoding="utf-8")
    expected = dump_yaml(helmfile_values(root, "eval", DEFAULT_DOMAIN)) + "\n"
    if committed != expected:
        errors.append("deploy/helmfile/opendesk-blak.yaml is stale vs helmfile_values()")
    tf = (root / "deploy/terraform/addons.tf").read_text(encoding="utf-8")
    if "sha256:" in tf:
        errors.append("do not invent image digests in terraform addons")
    if INGRESS_NGINX_CHART not in tf:
        errors.append("addons.tf must pin ingress-nginx chart from openDesk requirements")
    workflow = (root / ".github/workflows/validate.yml").read_text(encoding="utf-8")
    if "terraform apply" in workflow or "helmfile apply" in workflow:
        errors.append("CI must not apply terraform or helmfile")
    return errors


def _bool(raw: str) -> bool:
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _from_query(root: Path, query: dict) -> dict:
    plan = plan_deploy(
        root,
        target=str(query.get("target") or "k3s"),
        profile=str(query.get("profile") or "eval"),
        apply_suite=_bool(query.get("apply_suite") or ""),
        apply_sidecars=_bool(query.get("apply_sidecars") or ""),
        allow_paid_cloud=_bool(query.get("allow_paid_cloud") or ""),
        allow_prod=_bool(query.get("allow_prod") or ""),
        cluster_create=_bool(query.get("cluster_create") or ""),
        install_addons=_bool(query.get("install_addons") or "true"),
        opendesk_checkout=str(query.get("opendesk_checkout") or ""),
        domain=str(query.get("domain") or DEFAULT_DOMAIN),
        namespace=str(query.get("namespace") or DEFAULT_NAMESPACE),
        master_password=str(query.get("master_password") or ""),
    )
    return {
        "ok": "false" if plan["errors"] else "true",
        "errors": "; ".join(plan["errors"]),
        "sites_install": "true" if plan["sites_install"] else "false",
        "pin_tag": plan["pin_tag"],
        "helmfile_values": dump_yaml(plan["helmfile_values"]),
        "steps": " | ".join(plan["steps"]),
    }


def main(argv: list[str] | None = None) -> int:
    from blak_backlog import repo_root

    root = repo_root()
    parser = argparse.ArgumentParser(description="Plan Blak Terraform/Helm/Helmfile deploy")
    parser.add_argument("command", nargs="?", default="plan", choices=("plan", "values", "json", "validate"))
    parser.add_argument("--target", default="k3s")
    parser.add_argument("--profile", default="eval")
    parser.add_argument("--domain", default=DEFAULT_DOMAIN)
    parser.add_argument("--namespace", default=DEFAULT_NAMESPACE)
    parser.add_argument("--opendesk-checkout", default="")
    parser.add_argument("--apply-suite", action="store_true")
    parser.add_argument("--apply-sidecars", action="store_true")
    parser.add_argument("--allow-paid-cloud", action="store_true")
    parser.add_argument("--allow-prod", action="store_true")
    parser.add_argument("--cluster-create", action="store_true")
    parser.add_argument("--master-password", default="")
    args = parser.parse_args(argv)

    if args.command == "json":
        query = json.load(sys.stdin)
        json.dump(_from_query(root, query), sys.stdout)
        sys.stdout.write("\n")
        return 0
    if args.command == "validate":
        errors = validate_deploy(root)
        if errors:
            for err in errors:
                print(f"ERROR: {err}", file=sys.stderr)
            return 1
        print("OK: deploy planner valid")
        return 0
    if args.command == "values":
        print(dump_yaml(helmfile_values(root, args.profile, args.domain)))
        return 0
    plan = plan_deploy(
        root,
        target=args.target,
        profile=args.profile,
        apply_suite=args.apply_suite,
        apply_sidecars=args.apply_sidecars,
        allow_paid_cloud=args.allow_paid_cloud,
        allow_prod=args.allow_prod,
        cluster_create=args.cluster_create,
        opendesk_checkout=args.opendesk_checkout,
        domain=args.domain,
        namespace=args.namespace,
        master_password=args.master_password,
    )
    print(json.dumps({k: v for k, v in plan.items() if k != "helmfile_values"}, indent=2))
    if plan["errors"]:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
