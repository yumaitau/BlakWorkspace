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
3. Run `python scripts/validate-manifest.py` and `python -m unittest discover -s tests -v`.
4. Land through pull requests. Merge only when the GitHub Actions `validate` check is green. Do not push commits straight to `main`.
5. GitHub Actions must never run `terraform apply` or `helmfile apply`. Homelab apply is operator-only.
6. Playwright e2e (`e2e/`) targets homelab URLs with credentials from the environment, not git. It is not the CI merge gate.

## History rewrite (2026-09)

`main` was rewritten with `git filter-repo` to remove homelab OIDC and bootstrap
literals that had been committed in pull request 135. Re-clone, or
`git fetch origin && git reset --hard origin/main`. Do not rebase old local
branches onto the rewritten tip without fetching first.

## Security reports

See [SECURITY.md](SECURITY.md). Report vulnerabilities privately; do not file public exploit issues.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
