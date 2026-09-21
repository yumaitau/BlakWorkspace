"""Run through the provisioning runner, which supplies reconcile_provider."""
"""Run through the provisioning wrapper; captured stdout contains credentials."""
import json
import secrets
from authentik.core.models import Application, Group, User
from authentik.crypto.models import CertificateKeyPair
from authentik.flows.models import Flow
from authentik.providers.oauth2.models import OAuth2Provider, ScopeMapping, RedirectURI, RedirectURIMatchingMode

provider, _ = reconcile_provider(slug='blak-crm', name='Blak CRM', defaults={
    'authorization_flow': Flow.objects.get(slug='default-provider-authorization-implicit-consent'),
    'invalidation_flow': Flow.objects.get(slug='default-provider-invalidation-flow'),
    'client_type': 'confidential', 'client_id': 'blak-crm',
    'client_secret': secrets.token_urlsafe(48),
    'signing_key': CertificateKeyPair.objects.first(),
    'sub_mode': 'user_username', 'include_claims_in_id_token': True,
    'issuer_mode': 'per_provider',
    'redirect_uris': [RedirectURI(matching_mode=RedirectURIMatchingMode.STRICT,
        url='https://crm.workspace.example.com/api/method/frappe.integrations.oauth2_logins.custom/blak_id')],
})
provider.property_mappings.add(*ScopeMapping.objects.filter(scope_name__in=['openid', 'profile', 'email']).exclude(name__startswith='Blak Workspace '))
Application.objects.update_or_create(slug='blak-crm', defaults={
    'name': 'Blak CRM', 'provider': provider, 'meta_launch_url': 'https://crm.workspace.example.com/login?redirect-to=/crm',
    'open_in_new_tab': True,
})
group, created = Group.objects.get_or_create(name='Blak CRM users')
group.users.add(User.objects.get(username='akadmin'))
users = [{'email': u.email, 'name': u.name, 'manager': u.username == 'akadmin'}
         for u in group.users.filter(is_active=True) if u.email]
print('BLAK_CRM_CONFIG=' + json.dumps({
    'client-id': provider.client_id, 'oidc-secret': provider.client_secret,
    'users.json': json.dumps(users),
}))
