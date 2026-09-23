#!/usr/bin/env python3
"""Install or remove the Drive file checker without changing public app URLs."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys

import yaml

NS = os.environ.get("NS", "blak-micro")
ROOT = Path(__file__).resolve().parents[2]
CHECKER_URL = "http://drive:8092"


def checker_container(image: str) -> dict:
    return {
        "name": "file-guard",
        "image": image,
        "imagePullPolicy": "IfNotPresent",
        "command": ["node", "/app/file-guard-run.js"],
        "env": [
            {"name": "SCAN_ROOT", "value": "/var/lib/opencloud/storage/users/users"},
            {"name": "FILE_GUARD_DIR", "value": "/var/lib/file-guard"},
            {"name": "CLAMAV_HOST", "value": "clamav"},
            {"name": "CLAMAV_PORT", "value": "3310"},
            {"name": "FILE_GUARD_PORT", "value": "8092"},
            {"name": "SCAN_EVERY_MS", "value": "300000"},
            {"name": "FILE_GUARD_TOKEN", "valueFrom": {"secretKeyRef": {"name": "blak-file-guard", "key": "token", "optional": True}}},
        ],
        "ports": [{"name": "guard", "containerPort": 8092}],
        "volumeMounts": [
            {"name": "data", "mountPath": "/var/lib/opencloud"},
            {"name": "file-guard-data", "mountPath": "/var/lib/file-guard"},
        ],
    }


def upsert_env(container: dict, item: dict) -> None:
    env = container.setdefault("env", [])
    for current in env:
        if current.get("name") == item["name"]:
            current.clear()
            current.update(item)
            return
    env.append(item)


def drop_env(container: dict, names: set[str]) -> None:
    container["env"] = [item for item in container.get("env", []) if item.get("name") not in names]


def install_checker(deployment: dict, image: str) -> dict:
    spec = deployment["spec"]["template"]["spec"]
    containers = spec["containers"]
    guard = checker_container(image)
    existing = next((container for container in containers if container.get("name") == "file-guard"), None)
    if existing:
        containers[containers.index(existing)] = guard
    else:
        containers.append(guard)
    volumes = spec.setdefault("volumes", [])
    if not any(volume.get("name") == "file-guard-data" for volume in volumes):
        volumes.append({"name": "file-guard-data", "persistentVolumeClaim": {"claimName": "file-guard-data"}})
    return deployment


def remove_checker(deployment: dict) -> dict:
    spec = deployment["spec"]["template"]["spec"]
    spec["containers"] = [container for container in spec["containers"] if container.get("name") != "file-guard"]
    spec["volumes"] = [volume for volume in spec.get("volumes", []) if volume.get("name") != "file-guard-data"]
    return deployment


def install_portal(deployment: dict) -> dict:
    portal = next(container for container in deployment["spec"]["template"]["spec"]["containers"] if container.get("name") == "portal")
    upsert_env(portal, {"name": "FILE_GUARD_URL", "value": CHECKER_URL})
    upsert_env(portal, {"name": "FILE_GUARD_TOKEN", "valueFrom": {"secretKeyRef": {"name": "blak-file-guard", "key": "token", "optional": True}}})
    return deployment


def remove_portal(deployment: dict) -> dict:
    portal = next(container for container in deployment["spec"]["template"]["spec"]["containers"] if container.get("name") == "portal")
    drop_env(portal, {"FILE_GUARD_URL", "FILE_GUARD_TOKEN"})
    return deployment


def service_ports(service: dict, present: bool) -> dict:
    ports = service["spec"].setdefault("ports", [])
    ports[:] = [port for port in ports if port.get("port") != 8092]
    if present:
        ports.append({"name": "guard", "port": 8092, "targetPort": 8092})
    return service


def kube(*args, data=None):
    return subprocess.check_output(["kubectl", "-n", NS, *args], input=data, text=True)


def apply_doc(document: dict) -> None:
    kube("apply", "-f", "-", data=yaml.safe_dump(document))


def up(image: str) -> None:
    subprocess.check_call(["bash", "scripts/deploy/ensure-secrets.sh"], env={**os.environ, "NS": NS})
    kube("apply", "-f", "deploy/k3s/micro/98-clamav.yaml")
    drive = json.loads(kube("get", "deploy", "opencloud", "-o", "json"))
    apply_doc(install_checker(drive, image))
    portal = json.loads(kube("get", "deploy", "portal", "-o", "json"))
    apply_doc(install_portal(portal))
    service = json.loads(kube("get", "svc", "drive", "-o", "json"))
    apply_doc(service_ports(service, True))


def down() -> None:
    if subprocess.call(["kubectl", "-n", NS, "get", "deploy", "opencloud"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0:
        drive = json.loads(kube("get", "deploy", "opencloud", "-o", "json"))
        apply_doc(remove_checker(drive))
    if subprocess.call(["kubectl", "-n", NS, "get", "deploy", "portal"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0:
        portal = json.loads(kube("get", "deploy", "portal", "-o", "json"))
        apply_doc(remove_portal(portal))
    if subprocess.call(["kubectl", "-n", NS, "get", "svc", "drive"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) == 0:
        service = json.loads(kube("get", "svc", "drive", "-o", "json"))
        apply_doc(service_ports(service, False))
    subprocess.call(["kubectl", "-n", NS, "delete", "deploy", "clamav", "--ignore-not-found"])


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else ""
    if action == "up":
        image = os.environ.get("PORTAL_IMAGE")
        if not image:
            raise SystemExit("PORTAL_IMAGE is required")
        up(image)
        return
    if action == "down":
        down()
        return
    raise SystemExit("Use: file-guard.py up|down")


if __name__ == "__main__":
    main()
