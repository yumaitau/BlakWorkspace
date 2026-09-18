# Assumptions

Working defaults for the Blak Workspace seed. Change via ADR or decision issue.

1. **Tenancy:** One customer organisation per deployment.
2. **Platform:** Kubernetes with supported Helm and Helmfile tooling from upstream openDesk requirements.
3. **Baseline then overlay:** Deploy unbranded openDesk baseline, then apply Blak overlay.
4. **Profiles:** eval, staging, and prod intents exist; only eval is realistic without paid infra.
5. **Hosting:** Australian hosting intent; no paid infrastructure is provisioned in this seed run.
6. **Locale:** en-AU for human docs and default locale configuration intent.
7. **Identity:** Start with Nubus; optional Microsoft Entra investigation is not mandatory.
8. **Pilot:** Focus on a core pilot workflow across Drive/Docs and essential collaboration, not full suite parity.
9. **AI:** No AI processing of customer content by default; any future AI is explicit opt-in.
10. **Claims:** No invented sovereignty, PROTECTED, IRAP, or community endorsement claims.
11. **Blak Knowledge:** Docmost replaces XWiki for Blak defaults; do not enable both engines in the same default profile (BW-055).
