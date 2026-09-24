"""Run through the provisioning runner, which supplies reconcile_provider."""
import secrets
from urllib.parse import urlsplit
from authentik.core.models import Application
from authentik.crypto.models import CertificateKeyPair
from authentik.flows.models import Flow
from authentik.providers.oauth2.models import OAuth2Provider, ScopeMapping, RedirectURI, RedirectURIMatchingMode
REDIRECTS = [RedirectURI(matching_mode=RedirectURIMatchingMode.STRICT, url=u) for u in ["https://drive.workspace.example.com", "https://drive.workspace.example.com/", "https://drive.workspace.example.com/oidc-callback", "https://drive.workspace.example.com/oidc-callback.html", "https://drive.workspace.example.com/oidc-silent-redirect.html"]]
auth_flow = Flow.objects.get(slug="default-provider-authorization-implicit-consent")
inval_flow = Flow.objects.get(slug="default-provider-invalidation-flow")
key = CertificateKeyPair.objects.first()
mappings = list(ScopeMapping.objects.filter(scope_name__in=["openid", "profile", "email"]).exclude(name__startswith="Blak Workspace "))
assert key is not None, "no signing key"
assert len(mappings) == 3, "scope mappings missing"
provider, created = reconcile_provider(slug='opencloud', name="OpenCloud", defaults={"authorization_flow": auth_flow, "invalidation_flow": inval_flow, "client_type": "public", "client_id": "web", "redirect_uris": REDIRECTS, "signing_key": key, "sub_mode": "user_username", "include_claims_in_id_token": True, "issuer_mode": "per_provider"})
# Existing deployments keep their real origins, subjects and client settings.
# OpenCloud renews access tokens through this separate, strict callback.
redirects = list(provider.redirect_uris)
for redirect in list(redirects):
    origin = urlsplit(redirect.url)
    if (redirect.matching_mode == RedirectURIMatchingMode.STRICT
            and origin.scheme == 'https' and origin.netloc
            and origin.path in ('', '/', '/oidc-callback', '/oidc-callback.html')):
        silent = RedirectURI(matching_mode=RedirectURIMatchingMode.STRICT,
                             url=f'{origin.scheme}://{origin.netloc}/oidc-silent-redirect.html')
        if silent not in redirects:
            redirects.append(silent)
if redirects != provider.redirect_uris:
    provider.redirect_uris = redirects
    provider.save()

provider.property_mappings.add(*mappings)
app, _ = Application.objects.update_or_create(slug="opencloud", defaults={"name": "OpenCloud", "provider": provider, "open_in_new_tab": True})
print("PROV_OK created=" + str(created) + " client_id=" + provider.client_id)
