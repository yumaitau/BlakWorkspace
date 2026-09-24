# Blak Flow engine assessment

Checked 2026-09-24. Assessment only; no service migration.

## Current implementation

The portal uses `apps/portal/flow-engine.js`. `connectorsFor()` in `server.js`
creates per-owner in-memory Drive and Sites adapters. They write JavaScript
objects and arrays, not OpenCloud files or Outline pages. Definitions and run
history persist to `FLOW_STORE`; connector output does not survive a restart.
The Run action supplies a representative event. This is a workflow prototype,
not a general integration engine or proof of scheduled delivery.

## Options

| Engine | Blak ID fit | Main tradeoff |
| --- | --- | --- |
| n8n | Native OIDC is Enterprise-only | Strong visual builder; free Community omits SSO, projects and workflow/credential sharing. Customer-facing workflow editing also needs appropriate commercial terms. |
| Activepieces | SSO is paid | Business-friendly builder, but free edition does not satisfy our SSO requirement. |
| Windmill | OIDC is Enterprise-only | Good fit for code-driven jobs, but the free edition does not meet native Blak ID requirements. |
| Node-RED | Editor supports OAuth/OpenID through Passport strategies and automatic login | Best free candidate for an operator automation service. Authentik integration and user isolation still need proof; one shared editor is not a private workspace for each user. |

Recommendation: keep Flow migration separate from the current incident fixes.
Prototype Node-RED if free native Blak ID remains mandatory. If a paid edition
is acceptable, evaluate n8n Enterprise first for the visual builder. Do not
replace native SSO with a proxy login or modify licence gates.

## Acceptance before replacement

- One Blak ID session opens Flow without a second login; revoked users lose access.
- Owner-scoped credentials and workflow access; no cross-owner editing or execution.
- Real OpenCloud WebDAV and Outline API connectors; verify resulting file/page in those apps.
- Durable jobs, bounded retries, duplicate prevention, visible failures and retained run history.
- Schedule survives restart; exported workflows, encryption keys and backups restore cleanly.
- Home navigation, branding, keyboard use and contrast verified in Playwright.
- Import existing flow definitions explicitly; retain old history and a rollback path.

## Official sources

- [n8n editions](https://docs.n8n.io/deploy/host-n8n/community-edition-features)
- [n8n OIDC availability](https://docs.n8n.io/administer/manage-users-and-access/verify-user-identity/use-oidc)
- [n8n licence FAQ](https://docs.n8n.io/n8n-community-license/community-license/license-faq)
- [Activepieces SSO](https://www.activepieces.com/docs/admin-guide/guides/sso)
- [Windmill editions](https://www.windmill.dev/docs/misc/community_vs_enterprise)
- [Node-RED editor authentication](https://nodered.org/docs/user-guide/runtime/securing-node-red)

These feature and licence statements describe the vendor documentation at the
check date. Recheck the selected edition before procurement or distribution.
