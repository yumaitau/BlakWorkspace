#!/usr/bin/env python3
"""CLI: dry-run or apply GitHub issue seeding from the backlog manifest."""

from blak_seed import main_seed

if __name__ == "__main__":
    raise SystemExit(main_seed())
