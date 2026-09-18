#!/usr/bin/env python3
"""CLI: validate backlog manifest and default deploy profiles."""

import sys

from blak_backlog import repo_root, validate_tree
from blak_profiles import validate_profiles


def main() -> int:
    root = repo_root()
    errors = validate_tree(root) + validate_profiles(root)
    if errors:
        for err in errors:
            print(f"ERROR: {err}", file=sys.stderr)
        return 1
    print("OK: manifest and profiles valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
