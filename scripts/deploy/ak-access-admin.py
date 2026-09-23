"""Provision the portal's People & access service account (run through ak shell).

Least privilege: view users and groups, add/remove group members, add groups and
change groups. It cannot make anyone a superuser: Authentik refuses superuser
groups, superuser parents and role grants without enable_group_superuser or
change_role, which this account never receives. It cannot delete users or groups.
"""
import json
from django.contrib.auth.models import Permission
from authentik.core.models import Token, User

PERMISSIONS = ['view_user', 'view_group', 'add_user_to_group', 'remove_user_from_group', 'add_group', 'change_group']
user, created = User.objects.get_or_create(username='blak-portal-access', defaults={
    'name': 'Blak Home People & access', 'type': 'service_account', 'is_active': True,
    'path': 'service-accounts/blak-portal',
})
if user.type != 'service_account' or user.is_superuser or user.path != 'service-accounts/blak-portal':
    raise ValueError('Access service account is not the expected unprivileged service account')
if user.groups.exists():
    raise ValueError('Access service account must not belong to any group')
if created:
    user.set_unusable_password()
    user.save()
permissions = Permission.objects.filter(content_type__app_label='authentik_core', codename__in=PERMISSIONS)
if permissions.count() != len(PERMISSIONS):
    raise ValueError('Required group membership permissions are unavailable')
user.assign_perms_to_managed_role(list(permissions))
allowed = {'authentik_core.' + name for name in PERMISSIONS}
if set(user.get_all_permissions()) != allowed:
    raise ValueError('Access service account has permissions beyond group membership management')
token, _ = Token.objects.get_or_create(identifier='blak-portal-access', defaults={
    'user': user, 'intent': 'api', 'expiring': False,
    'description': 'Blak Home People & access: app role and team group membership only',
})
if token.user_id != user.pk or token.intent != 'api':
    raise ValueError('Access token belongs to a different identity or purpose')
print('BLAK_ACCESS_ADMIN_CONFIG=' + json.dumps({'api-token': token.key}))
