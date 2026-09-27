"""Run through provision-beszel.py; captured output contains OIDC credentials."""
import json
import os
import secrets
from authentik.core.models import Application, User
from authentik.crypto.models import CertificateKeyPair
from authentik.flows.models import Flow
from authentik.policies.expression.models import ExpressionPolicy
from authentik.policies.models import PolicyBinding
from authentik.providers.oauth2.models import ScopeMapping, RedirectURI, RedirectURIMatchingMode

origin = os.environ['BLAK_MONITORING_URL'].rstrip('/')
consent = Flow.objects.get(slug='default-provider-authorization-implicit-consent')
redirects = [RedirectURI(matching_mode=RedirectURIMatchingMode.STRICT, url=origin + path)
             for path in ['', '/', '/api/oauth2-redirect']]
provider, _ = reconcile_provider(name='Blak Monitoring', slug='beszel', defaults={
    'authorization_flow': consent,
    'invalidation_flow': Flow.objects.get(slug='default-provider-invalidation-flow'),
    'client_type': 'confidential', 'client_id': 'beszel', 'client_secret': secrets.token_urlsafe(48),
    'redirect_uris': redirects, 'signing_key': CertificateKeyPair.objects.first(),
    'sub_mode': 'user_uuid', 'include_claims_in_id_token': True, 'issuer_mode': 'per_provider',
})
provider.authorization_flow = consent
provider.redirect_uris = redirects
provider.grant_types = ['authorization_code']
provider.save()
provider.property_mappings.add(*ScopeMapping.objects.filter(scope_name__in=['openid', 'profile']).exclude(name__startswith='Blak Workspace '))
email, _ = ScopeMapping.objects.update_or_create(name='Blak Monitoring directory email', defaults={
    'scope_name': 'email', 'description': 'Verified email from the managed workspace directory',
    'expression': 'return {"email": request.user.email, "email_verified": True}',
})
provider.property_mappings.remove(*ScopeMapping.objects.filter(pk__in=provider.property_mappings.values('pk'), scope_name='email'))
provider.property_mappings.add(email)
app, _ = Application.objects.update_or_create(slug='beszel', defaults={
    'name': 'Blak Monitoring', 'provider': provider, 'meta_launch_url': origin + '/?blak_launch=1',
    'open_in_new_tab': True, 'policy_engine_mode': 'all',
})
policy, _ = ExpressionPolicy.objects.update_or_create(name='Blak access: beszel', defaults={
    'expression': "return request.user.is_active and bool(request.user.email) and (request.user.is_superuser or ak_is_group_member(request.user, name='blak-drive-admin'))",
})
PolicyBinding.objects.update_or_create(target=app, policy=policy, defaults={'order': 0, 'enabled': True})
operator_email = os.environ.get('BLAK_MONITORING_OPERATOR_EMAIL')
if not operator_email:
    operator = next((u for u in User.objects.filter(is_active=True).exclude(email='') if u.is_superuser), None)
    if operator is None:
        raise ValueError('An active workspace administrator with an email is required')
    operator_email = operator.email
print('BLAK_BESZEL_CONFIG=' + json.dumps({'client-id': provider.client_id, 'oidc-secret': provider.client_secret, 'operator-email': operator_email}))
