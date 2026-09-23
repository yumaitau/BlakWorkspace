"""Run only through provision-smith.py; stdout contains a credential."""
import json
import os
import secrets
from authentik.core.models import Application, Group
from authentik.crypto.models import CertificateKeyPair
from authentik.flows.models import Flow
from authentik.policies.expression.models import ExpressionPolicy
from authentik.policies.models import PolicyBinding
from authentik.providers.oauth2.models import (
    OAuth2Provider, ScopeMapping, RedirectURI, RedirectURIMatchingMode,
)

SMITH_ORIGIN = os.environ.get('BLAK_SMITH_PUBLIC_ORIGIN', 'https://smith.workspace.example.com').rstrip('/')
REDIRECTS = [RedirectURI(
    matching_mode=RedirectURIMatchingMode.STRICT,
    url=SMITH_ORIGIN + '/api/auth/sso/callback/blak-id',
)]
ROLE = """role = None
if ak_is_group_member(user, name='blak-smith-admin'):
    role = 'admin'
elif ak_is_group_member(user, name='blak-smith-writer'):
    role = 'writer'
elif ak_is_group_member(user, name='blak-smith-reader'):
    role = 'reader'
if role is None:
    return {}
return {'blaksmith_role': role, 'blaksmith_clearance': 'internal'}
"""
for name in ('blak-smith-reader', 'blak-smith-writer', 'blak-smith-admin'):
    Group.objects.get_or_create(name=name)
scope, _ = ScopeMapping.objects.update_or_create(name='BlakSmith role', defaults={
    'scope_name': 'blaksmith',
    'description': 'BlakSmith workspace role and clearance',
    'expression': ROLE,
})
provider, created = reconcile_provider(slug='blaksmith',
    name='BlakSmith',
    defaults={
        'authorization_flow': Flow.objects.get(slug='default-provider-authorization-implicit-consent'),
        'invalidation_flow': Flow.objects.get(slug='default-provider-invalidation-flow'),
        'client_type': 'confidential',
        'client_id': 'blaksmith',
        'client_secret': secrets.token_urlsafe(48),
        'redirect_uris': REDIRECTS,
        'grant_types': ['authorization_code'],
        'signing_key': CertificateKeyPair.objects.first(),
        'sub_mode': 'user_uuid',
        'include_claims_in_id_token': True,
        'issuer_mode': 'per_provider',
    },
)
provider.redirect_uris = REDIRECTS
provider.grant_types = ['authorization_code']
provider.save()
provider.property_mappings.add(*ScopeMapping.objects.filter(
    scope_name__in=['openid', 'profile', 'email']).exclude(name__startswith='Blak Workspace '))
provider.property_mappings.add(scope)
app, _ = Application.objects.update_or_create(slug='blaksmith', defaults={
    'name': 'BlakSmith', 'provider': provider,
    'meta_launch_url': SMITH_ORIGIN + '/login', 'open_in_new_tab': True,
})
policy, _ = ExpressionPolicy.objects.update_or_create(name='Blak access: blaksmith', defaults={
    'expression': "return request.user.is_active and any(ak_is_group_member(request.user, name=name) for name in ['blak-smith-reader', 'blak-smith-writer', 'blak-smith-admin'])",
})
PolicyBinding.objects.update_or_create(target=app, policy=policy, defaults={'order': 0, 'enabled': True})
app.policy_engine_mode = 'all'
app.save(update_fields=['policy_engine_mode'])
print('BLAK_SMITH_CONFIG=' + json.dumps({'oidc-secret': provider.client_secret}))
