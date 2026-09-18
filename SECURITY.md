# Security policy

## Reporting

Please report suspected security issues privately to the Yuma IT maintainers responsible for this repository. Do not file public issues for active exploits.

## Scope

This repository currently contains seed documentation, configuration stubs, and tooling. It does not operate a production Blak Workspace service by itself.

## Expectations

- No production secrets in git
- CI workflows must not deploy production infrastructure
- Overlay changes should not weaken default share or authentication controls without an explicit decision

## Preferred process

1. Contact maintainers privately with reproduction details.
2. Allow reasonable time for assessment.
3. Coordinate disclosure if a fix is required in public overlays.
