# Friendly workspace errors

Browser navigation gets a branded recovery page with a useful next step and the original HTTP error status. The portal covers missing pages, sign-in, access, validation and service failures. Raw upstream errors never belong in portal messages. For an uncertain write, tell the person to check the result before retrying; do not claim that nothing changed.

`apps/portal/error-pages.js` owns the standalone page and safe default copy. It uses the existing palette and logo, works without JavaScript or an app connection, and follows the browser's light/dark preference. Run `node scripts/brand/generate.js` after changing it to regenerate the gateway pages.

The gateway intercepts HTTP 404 and 5xx responses only for document navigation. Fetch metadata takes precedence over Accept; API calls, assets, streams and WebSockets keep their upstream responses. Named-location routing preserves the original method/body and sends a request once. Portal responses keep their more specific recovery copy. Their `X-Blak-Error-Page` response header also suppresses the shared app stylesheet and script, so app theme overrides cannot break standalone error-page contrast. Native app pages that return HTTP 200, including SPA routes, remain owned by that app.

Checks:

```sh
node --test apps/portal/test/*.test.js
BLAK_NGINX_BIN=/path/to/nginx node --test apps/portal/test/gateway-errors.test.js
node scripts/brand/generate.js --check
```

The gateway integration check uses temporary ports, a mock upstream and temporary files. It covers browser/API negotiation, outage pages, hidden Vault administration, Cloud sign-in, HEAD and a single POST delivery. Browser checks should also cover dark/light/mobile layouts, keyboard links and axe accessibility.

New images include the shared module and generated assets. When updating the homelab's ConfigMap overlays, add the new portal module before restarting the portal, mount the generated `errors/` directory at `/usr/share/nginx/html/_blak/errors`, and merge the gateway error routing into the live nginx ConfigMap. Preserve the live host map, OIDC rewrite, Cloud guard and public origins. Resolve the error pages' Home URL to the deployment's portal origin. Check `nginx -t` before rolling the gateway. Do not apply the example-domain portal or gateway configuration over the live tailnet configuration.
