# Drive renewal and Hermes document extraction

## Silent renewal

OpenCloud uses `/oidc-silent-redirect.html` in addition to its interactive
`/oidc-callback.html` callback. Both must be registered as strict redirect URIs
on the OpenCloud OAuth provider. `scripts/deploy/ak-oc.py` adds the silent URI
for each existing HTTPS Drive origin without replacing real origins or changing
subjects. An authorization 400 can surface as an iframe timeout and expired
access token. Keep Authentik frame protections enabled.

Operator regression: run `e2e/tests/drive-renewal.spec.js` with the existing
Playwright configuration and tailnet access. It expires only the test browser's
stored session metadata, verifies prompt=none authorization and token exchange,
and checks the file view stays accessible. Authentication traces are disabled.

## Native ODT extraction

The pinned Open WebUI image's Debian Pandoc lacks embedded DOCX support files
when used with `--sandbox`. Unstructured converts ODT to DOCX through that path,
so a successful Drive download can still fail during Hermes indexing.

The Hermes image installs checksum-pinned upstream Pandoc 3.11 with embedded
support data. `test_document_native.py` exercises Unstructured's actual ODT
loader during the image build. Do not enable `ALLOW_PANDOC_NO_SANDBOX`.

Build and import the Hermes image on the homelab, then update only the `webui`
container image in `deploy/hermes`. Keep public origins and secrets intact.
Run a sync job and verify both successful completion and owner-scoped extracted
content in the Drive knowledge collection. A source HTTP 200 alone is not proof
of indexing.

[Upstream sandbox behavior](https://pandoc.org/MANUAL.html#option--sandbox).
