"""Run only through provision-workspace-apps.py; stdout contains a credential."""
import json
import secrets
from authentik.core.models import Application
from authentik.crypto.models import CertificateKeyPair
from authentik.flows.models import Flow
from authentik.providers.oauth2.models import (
    OAuth2Provider, ScopeMapping, RedirectURI, RedirectURIMatchingMode,
)

provider, created = OAuth2Provider.objects.get_or_create(
    name='Blak Forms',
    defaults={
        'authorization_flow': Flow.objects.get(slug='default-provider-authorization-implicit-consent'),
        'invalidation_flow': Flow.objects.get(slug='default-provider-invalidation-flow'),
        'client_type': 'confidential',
        'client_id': 'blak-forms',
        'client_secret': secrets.token_urlsafe(48),
        'redirect_uris': [RedirectURI(
            matching_mode=RedirectURIMatchingMode.STRICT,
            url='https://forms.homelab.local/connect/oidc/callback',
        )],
        'signing_key': CertificateKeyPair.objects.first(),
        'sub_mode': 'user_uuid',
        'include_claims_in_id_token': True,
        'issuer_mode': 'per_provider',
    },
)
provider.property_mappings.set(ScopeMapping.objects.filter(scope_name__in=['openid', 'profile', 'email']))
Application.objects.update_or_create(slug='blak-forms', defaults={
    'name': 'Blak Forms', 'provider': provider,
    'meta_launch_url': 'https://forms.homelab.local', 'open_in_new_tab': True,
})
print('BLAK_FORMS_CONFIG=' + json.dumps({
    'client-id': provider.client_id, 'oidc-secret': provider.client_secret,
}))
