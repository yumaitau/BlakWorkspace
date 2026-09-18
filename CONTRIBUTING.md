# Contributing

Thanks for your interest in Blak Workspace.

## Language and tone

Use Australian English in human-readable docs. Avoid em dashes. Avoid hype and unverifiable claims.

## What to contribute

- Documentation fixes and ADRs
- Overlay configuration that preserves upstream upgrades
- Tests for manifest/validation tooling
- Issues using the templates under `.github/ISSUE_TEMPLATE/`

## Cultural and licence review

- Apply `needs:cultural-review` for cultural content, community claims, or brand assets with cultural significance. Process: [docs/governance/indigenous-governance.md](docs/governance/indigenous-governance.md).
- Apply `needs:licence-review` when changing licence notices, adding redistributed binaries, or enabling AGPL/GPL-heavy optional stacks.
- Do not invent community endorsements or cultural assets.

## Development flow

1. Open an issue before large changes.
2. Keep overlay changes upgrade-safe (prefer configuration over patches).
3. Run `python scripts/validate-manifest.py` when touching backlog files.
4. Prefer small pull requests.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
