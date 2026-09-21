"""Run through the provisioning runner, which supplies reconcile_provider."""
import secrets
from authentik.core.models import Application
from authentik.crypto.models import CertificateKeyPair
from authentik.flows.models import Flow
from authentik.providers.oauth2.models import OAuth2Provider, ScopeMapping, RedirectURI, RedirectURIMatchingMode
REDIRECTS = [
    RedirectURI(matching_mode=RedirectURIMatchingMode.STRICT, url="https://projects.workspace.example.com/api/auth/oauth2/callback/custom"),
]
auth_flow = Flow.objects.get(slug="default-provider-authorization-implicit-consent")
inval_flow = Flow.objects.get(slug="default-provider-invalidation-flow")
key = CertificateKeyPair.objects.first()
mappings = list(ScopeMapping.objects.filter(scope_name__in=["openid", "profile", "email"]).exclude(name__startswith="Blak Workspace "))
assert key is not None, "no signing key"
assert len(mappings) == 3, "scope mappings missing"
provider, created = reconcile_provider(slug='kaneo',
    name="Kaneo",
    defaults={
        "authorization_flow": auth_flow,
        "invalidation_flow": inval_flow,
        "client_type": "confidential",
        "client_id": "kaneo",
        "redirect_uris": REDIRECTS,
        "signing_key": key,
        "sub_mode": "user_username",
        "include_claims_in_id_token": True,
        "issuer_mode": "per_provider",
    },
)
if created:
    provider.client_secret = secrets.token_urlsafe(48)
    provider.save(update_fields=["client_secret"])
new_secret = provider.client_secret
provider.property_mappings.add(*mappings)
Application.objects.update_or_create(
    slug="kaneo",
    defaults={"name": "Blak Projects", "provider": provider, "open_in_new_tab": True},
)
print("PROV_OK created=" + str(created) + " client_id=" + provider.client_id)
print("PROV_SECRET=" + new_secret)
