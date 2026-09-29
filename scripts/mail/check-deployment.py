#!/usr/bin/env python3
"""Validate mail deployment intent. Not a cloud inventory or compliance attestation."""
import argparse
import json
import re
import sys
from pathlib import Path

REGIONS = frozenset(("ap-southeast-2", "ap-southeast-4"))
KINDS = frozenset(("compute", "mailbox", "database", "kms", "secret", "backup", "log", "registry"))
GATES = frozenset(("regional_features", "global_metadata_boundary", "ox_license",
                   "tenant_identity", "zero_loss_durability", "immutable_restore",
                   "outage_queue_recovery", "event_delivery", "fenced_failover", "siem_residency"))
ROOT_KEYS = frozenset(("schema_version", "smtp_hostname", "primary_region", "dr_region",
                       "resources", "outbound", "gates"))
ARN_SERVICES = {"kms": "kms", "secret": "secretsmanager", "log": "logs", "registry": "ecr"}


def validate(config):
    errors = []
    if not isinstance(config, dict):
        return ["deployment must be an object"]
    if set(config) != ROOT_KEYS:
        errors.append("deployment fields must exactly match schema version 1")
    if type(config.get("schema_version")) is not int or config["schema_version"] != 1:
        errors.append("schema_version must be 1")
    for field, expected in (("smtp_hostname", "smtp.blakworkspace.au"),
                            ("primary_region", "ap-southeast-2"),
                            ("dr_region", "ap-southeast-4")):
        if config.get(field) != expected:
            errors.append(field + " must be " + expected)

    resources = config.get("resources")
    coverage = set()
    ids, keys = set(), set()
    if not isinstance(resources, list) or not resources:
        errors.append("resources must be a non-empty list")
        resources = []
    for index, resource in enumerate(resources):
        label = "resources[{}]".format(index)
        if not isinstance(resource, dict) or set(resource) != {"id", "kind", "region", "arn"}:
            errors.append(label + " has invalid fields")
            continue
        identity, kind, region, arn = (resource[k] for k in ("id", "kind", "region", "arn"))
        if not isinstance(identity, str) or not re.fullmatch(r"[a-z][a-z0-9-]{2,63}", identity):
            errors.append(label + " requires an opaque resource id")
        elif identity in ids:
            errors.append(label + " duplicates a resource id")
        else:
            ids.add(identity)
        if not isinstance(region, str) or region not in REGIONS:
            errors.append(label + " uses a non-Australian region")
        if not isinstance(kind, str) or kind not in KINDS:
            errors.append(label + " uses an unsupported resource kind")
            continue
        if isinstance(region, str):
            coverage.add((region, kind))
        # ARN fields may be absent until planning, except key/secret/log/registry refs.
        # This validator cannot infer S3 bucket location from an ARN: inventory must.
        if not isinstance(arn, str):
            errors.append(label + " arn must be a string")
            continue
        if arn:
            parts = arn.split(":", 5)
            if len(parts) != 6 or parts[0:2] != ["arn", "aws"]:
                errors.append(label + " has an invalid AWS ARN")
            elif parts[3] and parts[3] != region:
                errors.append(label + " ARN region differs from declared region")
            elif kind in ARN_SERVICES and (parts[2] != ARN_SERVICES[kind] or parts[3] != region
                                           or not re.fullmatch(r"[0-9]{12}", parts[4])):
                errors.append(label + " has an invalid regional service ARN")
        elif kind in ARN_SERVICES:
            errors.append(label + " requires a regional ARN")
        if kind == "kms":
            if not re.fullmatch(r"arn:aws:kms:ap-southeast-[24]:[0-9]{12}:key/[0-9a-f-]{36}", arn):
                errors.append(label + " requires a single-region key UUID; aliases and mrk keys forbidden")
            if arn in keys:
                errors.append(label + " reuses a regional key")
            keys.add(arn)
    for region in sorted(REGIONS):
        for kind in sorted(KINDS):
            if (region, kind) not in coverage:
                errors.append("missing {} resource in {}".format(kind, region))

    outbound = config.get("outbound")
    if not isinstance(outbound, dict) or set(outbound) != REGIONS:
        errors.append("outbound must explicitly define both Australian regions")
    else:
        expected = {
            "ap-southeast-2": {"mode": "ses_smtp", "endpoint": "email-smtp.ap-southeast-2.amazonaws.com", "port": 587, "require_starttls": True, "on_unavailable": "hold"},
            "ap-southeast-4": {"mode": "queue_until_ses", "endpoint": "email-smtp.ap-southeast-2.amazonaws.com", "port": 587, "require_starttls": True, "on_unavailable": "hold"},
        }
        for region, route in expected.items():
            actual = outbound[region]
            if (actual != route or not isinstance(actual, dict)
                    or any(type(actual.get(key)) is not type(value) for key, value in route.items())):
                errors.append("outbound route is not approved for " + region)

    gates = config.get("gates")
    if not isinstance(gates, dict) or set(gates) != GATES:
        errors.append("all production readiness gates must be declared")
    else:
        for name in sorted(GATES):
            gate = gates[name]
            if (not isinstance(gate, dict) or set(gate) != {"status", "evidence_sha256"}
                    or gate.get("status") != "passed"
                    or not isinstance(gate.get("evidence_sha256"), str)
                    or not re.fullmatch(r"[0-9a-f]{64}", gate["evidence_sha256"])):
                errors.append("production gate unresolved: " + name)
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("config", type=Path)
    args = parser.parse_args()
    try:
        # Bounded input and strict duplicate-key rejection; never echo configuration values.
        if args.config.stat().st_size > 1048576:
            raise ValueError("input too large")
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError("duplicate field")
                result[key] = value
            return result
        config = json.loads(args.config.read_text(), object_pairs_hook=unique)
        errors = validate(config)
    except (OSError, ValueError, RecursionError):
        print("Invalid deployment JSON", file=sys.stderr)
        return 2
    for error in errors:
        print(error, file=sys.stderr)
    if errors:
        return 1
    print("Intent policy passed; verify evidence hashes and live inventory before deployment.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
