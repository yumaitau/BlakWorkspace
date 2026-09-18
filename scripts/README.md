# Seed tooling

Validate the backlog locally before any GitHub writes:

```bash
python scripts/validate-manifest.py
```

Dry-run (prints planned creates; does not write `docs/backlog/seed-map.json`):

```bash
python scripts/seed-github.py --dry-run
```

Apply creates **only missing** issues (skip when `<!-- blak-seed:BW-NNN -->` already exists). Real GitHub numbers are recorded in `docs/backlog/seed-map.json` only after apply:

```bash
python scripts/seed-github.py --apply
```

Resume after backlog edits:

```bash
python scripts/validate-manifest.py
python scripts/seed-github.py --dry-run
```

The seeder does not assign people and does not change repository visibility.
