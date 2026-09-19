import secrets
from authentik.core.models import Application
from authentik.crypto.models import CertificateKeyPair
from authentik.flows.models import Flow
from authentik.providers.oauth2.models import OAuth2Provider, ScopeMapping, RedirectURI, RedirectURIMatchingMode
REDIRECTS = [RedirectURI(matching_mode=RedirectURIMatchingMode.STRICT, url="http://hermes.homelab.local/oauth/oidc/callback")]
auth_flow = Flow.objects.get(slug="default-provider-authorization-implicit-consent")
inval_flow = Flow.objects.get(slug="default-provider-invalidation-flow")
key = CertificateKeyPair.objects.first()
mappings = list(ScopeMapping.objects.filter(scope_name__in=["openid", "profile", "email"]))
assert key is not None, "no signing key"
assert len(mappings) == 3, "scope mappings missing"
provider, created = OAuth2Provider.objects.update_or_create(name="Hermes", defaults={"authorization_flow": auth_flow, "invalidation_flow": inval_flow, "client_type": "confidential", "client_id": "openwebui", "redirect_uris": REDIRECTS, "signing_key": key, "sub_mode": "user_username", "include_claims_in_id_token": True, "issuer_mode": "per_provider"})
new_secret = secrets.token_urlsafe(32)
provider.client_secret = new_secret
provider.save()
provider.property_mappings.set(mappings)
app, _ = Application.objects.update_or_create(slug="hermes", defaults={"name": "Hermes", "provider": provider, "open_in_new_tab": True})
print("PROV_OK created=" + str(created) + " client_id=" + provider.client_id)
print("PROV_SECRET=" + new_secret)
