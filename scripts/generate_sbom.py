#!/usr/bin/env python3
"""Build a CycloneDX skeleton from THIRD_PARTY_NOTICES.md."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from blak_backlog import repo_root


def generate_sbom(root: Path, out: Path) -> Path:
    text = (root / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8")
    components = []
    for line in text.splitlines():
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 2:
            continue
        name = cells[0]
        if not name or name.lower() in {"component", "function"} or name.startswith("-"):
            continue
        components.append({"type": "library", "name": name})
    if not components:
        raise ValueError("THIRD_PARTY_NOTICES.md produced no components")
    doc = {"bomFormat": "CycloneDX", "specVersion": "1.5", "components": components}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    return out


def main() -> int:
    root = repo_root()
    out = generate_sbom(root, root / "sbom" / "cyclonedx.json")
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
