"""Run through the provisioning runner; stdout contains OIDC credentials."""
import json
import secrets
from authentik.core.models import Application, Group, User
from authentik.crypto.models import CertificateKeyPair
from authentik.flows.models import Flow, FlowStageBinding
from authentik.policies.expression.models import ExpressionPolicy
from authentik.policies.models import PolicyBinding
from authentik.providers.oauth2.models import ScopeMapping, RedirectURI, RedirectURIMatchingMode
from authentik.stages.authenticator_totp.models import AuthenticatorTOTPStage
from authentik.stages.authenticator_validate.models import AuthenticatorValidateStage
from authentik.stages.authenticator_webauthn.models import AuthenticatorWebAuthnStage


def copy_binding(binding, target, order):
    fields = ['policy_engine_mode', 'evaluate_on_plan', 're_evaluate_policies', 'invalid_response_action']
    copied, _ = FlowStageBinding.objects.update_or_create(target=target, stage=binding.stage,
        defaults={**{field: getattr(binding, field) for field in fields}, 'order': order})
    for policy in PolicyBinding.objects.filter(target=binding):
        fields = ['expires', 'enabled', 'expiring', 'negate', 'timeout', 'failure_result']
        PolicyBinding.objects.update_or_create(target=copied, policy=policy.policy,
            group=policy.group, user=policy.user, order=policy.order,
            defaults={field: getattr(policy, field) for field in fields})


# Native password/identification stages are reused. MFA is enforced exactly once
# by Vault's authorization flow, including when an existing Blak ID session is used.
authentication, _ = Flow.objects.update_or_create(slug='blak-vault-authentication', defaults={
    'name': 'Blak Vault sign-in', 'title': 'Welcome to Blak ID', 'designation': 'authentication',
})
for binding in FlowStageBinding.objects.filter(target__slug='default-authentication-flow'):
    if not isinstance(binding.stage, AuthenticatorValidateStage):
        copy_binding(binding, authentication, binding.order)

flow, _ = Flow.objects.update_or_create(slug='blak-vault-authorization', defaults={
    'name': 'Blak Vault verification', 'title': 'Verify your identity for Blak Vault',
    'designation': 'authorization', 'authentication': 'require_authenticated',
})
totp, _ = AuthenticatorTOTPStage.objects.update_or_create(
    name='blak-vault-totp-setup', defaults={'digits': 6, 'friendly_name': 'Authenticator app'})
webauthn, _ = AuthenticatorWebAuthnStage.objects.update_or_create(
    name='blak-vault-passkey-setup', defaults={'user_verification': 'required', 'friendly_name': 'Passkey'})
mfa, _ = AuthenticatorValidateStage.objects.update_or_create(name='blak-vault-mfa', defaults={
    'not_configured_action': 'configure', 'device_classes': ['totp', 'webauthn', 'static'],
    'last_auth_threshold': 'minutes=15', 'webauthn_user_verification': 'required',
})
mfa.configuration_stages.set([totp, webauthn])
FlowStageBinding.objects.update_or_create(target=flow, stage=mfa, defaults={'order': 0})
standard = Flow.objects.get(slug='default-provider-authorization-implicit-consent')
for binding in FlowStageBinding.objects.filter(target=standard):
    copy_binding(binding, flow, binding.order + 100)
provider, _ = reconcile_provider(slug='blak-vault', name='Blak Vault', defaults={
    'authorization_flow': flow,
    'invalidation_flow': Flow.objects.get(slug='default-provider-invalidation-flow'),
    'client_type': 'confidential', 'client_id': 'blak-vault',
    'client_secret': secrets.token_urlsafe(48),
    'redirect_uris': [RedirectURI(matching_mode=RedirectURIMatchingMode.STRICT,
        url='https://vault.workspace.example.com/identity/connect/oidc-signin')],
    'signing_key': CertificateKeyPair.objects.first(), 'sub_mode': 'user_uuid',
    'include_claims_in_id_token': True, 'issuer_mode': 'per_provider',
})
provider.authorization_flow = flow
provider.authentication_flow = authentication
provider.grant_types = ['authorization_code', 'refresh_token']
provider.access_token_validity = 'minutes=10'
provider.refresh_token_validity = 'days=7'
provider.save()
provider.property_mappings.add(*ScopeMapping.objects.filter(
    scope_name__in=['openid', 'profile', 'offline_access']
).exclude(name__startswith='Blak Workspace '))
# Authentik's documented Vaultwarden integration treats this managed directory as
# the email authority. Keep this assertion app-local; native email auto-linking is
# disabled, and the immutable UUID is the account binding, never the email.
email, _ = ScopeMapping.objects.update_or_create(name='Blak Vault directory email', defaults={
    'scope_name': 'email', 'description': 'Directory-managed email for Blak Vault',
    'expression': 'return {"email": request.user.email, "email_verified": True}',
})
provider.property_mappings.remove(*ScopeMapping.objects.filter(
    pk__in=provider.property_mappings.values('pk'), scope_name='email'))
provider.property_mappings.add(email)
app, _ = Application.objects.update_or_create(slug='blak-vault', defaults={
    'name': 'Blak Vault', 'provider': provider, 'open_in_new_tab': True,
    'meta_launch_url': 'https://vault.workspace.example.com/#/sso?identifier=blak',
    'meta_icon': 'https://vault.workspace.example.com/images/blak-logo.svg',
    'policy_engine_mode': 'all',
})
groups = ['blak-vault-' + role for role in ['reader', 'writer', 'admin']]
for name in groups:
    Group.objects.get_or_create(name=name)
policy, _ = ExpressionPolicy.objects.update_or_create(name='Blak access: blak-vault', defaults={
    'expression': 'return request.user.is_active and (request.user.is_superuser or any(ak_is_group_member(request.user, name=g) for g in ' + repr(groups) + '))',
})
PolicyBinding.objects.update_or_create(target=app, policy=policy, defaults={'order': 0, 'enabled': True})
owners = [u.email for u in User.objects.filter(is_active=True).exclude(email='') if u.is_superuser]
if not owners:
    raise ValueError('Vault requires an active operator with an email address for organization setup')
print('BLAK_VAULT_CONFIG=' + json.dumps({
    'client-id': provider.client_id, 'oidc-secret': provider.client_secret,
    'org-creation-users': ','.join(owners),
}))
