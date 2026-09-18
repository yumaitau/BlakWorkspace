# Indigenous governance review process

Status: **proposed**. Label `blocked:decision` remains until owners accept this process. This document does not claim community endorsement, IRAP, PROTECTED status, or cultural authority.

## Purpose

Stop invented cultural assets, motifs, and community claims from entering the Blak Workspace overlay, Drive content guidance, or Docmost Knowledge (BW-055).

## When `needs:cultural-review` is required

Apply the label, and do not merge until review, when a change:

- Adds or alters brand marks, colours, or motifs that could be read as Indigenous cultural material
- Quotes or paraphrases community positions, Country acknowledgements, or cultural protocols
- Adds artwork, photography of people and Country, language words, or story content
- Claims endorsement, partnership, or certification involving Aboriginal or Torres Strait Islander organisations

Ordinary code, Helm values, and non-cultural copy do not need the label.

## Who can approve

Until owners name a standing reviewer, cultural copy and assets stay out of the tree. A named owner (product + cultural delegate) must record approval in [docs/governance/decision-log.md](decision-log.md) with date, artefact path, and provenance link. No single engineer self-approves cultural assets.

## Escalation

Disputed claims pause the pull request. Do not merge with `needs:cultural-review` open. If provenance is missing, revert the asset rather than invent a story. Security or licence issues follow [SECURITY.md](../../SECURITY.md) and `needs:licence-review`.

## Related

- Label usage: [CONTRIBUTING.md](../../CONTRIBUTING.md)
- ADR-007: [docs/adr/ADR-007.md](../adr/ADR-007.md)
- Brand provenance: [brand/PROVENANCE.md](../../brand/PROVENANCE.md)
