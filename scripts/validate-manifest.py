#!/usr/bin/env python3
"""CLI: validate backlog manifest, profiles, and Hermes control plane."""

import json
import sys

from blak_backlog import repo_root, validate_tree
from blak_deploy import validate_deploy
from blak_hermes import load_control_plane, validate_control_plane
from blak_profiles import validate_profiles


def main() -> int:
    root = repo_root()
    errors = validate_tree(root) + validate_profiles(root) + validate_deploy(root)
    try:
        errors.extend(validate_control_plane(load_control_plane(root)))
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        errors.append(f"control plane: {exc}")
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1
    print("OK: manifest and profiles valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
