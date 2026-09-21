"""Provision a directory reader with only user/group read permissions."""
import json
from django.contrib.auth.models import Permission
from authentik.core.models import Token, User

user, created = User.objects.get_or_create(username='blak-role-reader', defaults={
    'name': 'Blak app role directory reader', 'type': 'service_account', 'is_active': True,
    'path': 'service-accounts/blak-app-roles',
})
if user.type != 'service_account' or user.is_superuser or user.path != 'service-accounts/blak-app-roles':
    raise ValueError('Directory reader identity is not the expected unprivileged service account')
if created:
    user.set_unusable_password()
    user.save()
permissions = Permission.objects.filter(content_type__app_label='authentik_core',
    codename__in=['view_user', 'view_group'])
if permissions.count() != 2:
    raise ValueError('Required directory read permissions are unavailable')
user.assign_perms_to_managed_role(list(permissions))
allowed = {'authentik_core.view_user', 'authentik_core.view_group'}
if set(user.get_all_permissions()) != allowed:
    raise ValueError('Directory reader has permissions beyond user/group read access')
token, _ = Token.objects.get_or_create(identifier='blak-role-reader', defaults={
    'user': user, 'intent': 'api', 'expiring': False,
    'description': 'Read Blak ID membership for native app role reconciliation',
})
if token.user_id != user.pk or token.intent != 'api':
    raise ValueError('Directory reader token belongs to a different identity or purpose')
print('BLAK_ROLE_READER_CONFIG=' + json.dumps({
    'api-token': token.key, 'base-url': 'https://id.workspace.example.com',
}))
