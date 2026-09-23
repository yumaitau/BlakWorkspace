"""Provision the portal's People & access service account (run through ak shell).

BLAK_ROLE_GROUPS is prepended by provision-access-admin.py from the portal contract.

Global permissions: view users, view groups, add groups. Nothing else.
Membership changes are object permissions, granted only on the
blak-*-reader|writer|admin role groups and on team groups marked
attributes.blak_team = true. change_group (needed to give a team a role by
setting its parents) is granted on team groups only, so role groups cannot be
renamed or re-parented. Groups the token creates get the same object
permissions at once through Authentik InitialPermissions, and every run of this
script re-grants them and revokes them from any group outside that set. So the
token cannot add to, remove from, rename or re-parent authentik Admins or any
other group, cannot make anyone a superuser, and cannot delete users or groups.
"""
import json
from django.contrib.auth.models import Permission
from django.contrib.contenttypes.models import ContentType
from django.db import transaction
from django.db.models import Q
from guardian.models import RoleModelPermission, RoleObjectPermission
from authentik.core.models import Group, Token, User
from authentik.rbac.models import InitialPermissions

GLOBAL = ['view_user', 'view_group', 'add_group']
MEMBERSHIP = ['add_user_to_group', 'remove_user_from_group']
OBJECT = MEMBERSHIP + ['change_group']


def perms(names):
    found = list(Permission.objects.filter(content_type__app_label='authentik_core', codename__in=names))
    if len(found) != len(names):
        raise ValueError('Required Blak ID permissions are unavailable')
    return found


def unsafe(group):
    # Superuser or permission-carrying ancestry, or a built-in group: never managed.
    lineage = Group.objects.filter(pk=group.pk).with_ancestors()
    return (group.name.lower().startswith('authentik ')
            or lineage.filter(Q(is_superuser=True) | Q(roles__isnull=False)).exists())


with transaction.atomic():
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
    role = user.get_managed_role(create=True)
    global_perms, object_perms, membership_perms = perms(GLOBAL), perms(OBJECT), perms(MEMBERSHIP)
    # Replace any wider global grant from an earlier version of this script.
    RoleModelPermission.objects.filter(role=role).exclude(permission__in=global_perms).delete()
    role.assign_perms(global_perms)

    # Groups this token creates get the object permissions immediately.
    initial, _ = InitialPermissions.objects.update_or_create(name='Blak Home team groups', defaults={'role': role})
    initial.permissions.set(object_perms)

    role_groups = [group for group in Group.objects.filter(name__in=BLAK_ROLE_GROUPS) if not unsafe(group)]
    teams = [group for group in Group.objects.filter(attributes__blak_team=True).exclude(name__in=BLAK_ROLE_GROUPS)
             if not unsafe(group)]
    grants = {str(group.pk): membership_perms for group in role_groups}
    grants.update({str(group.pk): object_perms for group in teams})
    for group in role_groups + teams:
        role.assign_perms(grants[str(group.pk)], group)
    group_type = ContentType.objects.get_for_model(Group)
    stale = RoleObjectPermission.objects.filter(role=role).exclude(content_type=group_type, object_pk__in=list(grants))
    stale = stale | RoleObjectPermission.objects.filter(role=role, content_type=group_type, object_pk__in=[
        str(group.pk) for group in role_groups], permission__codename='change_group')
    revoked = stale.delete()[0]
    managed = role_groups + teams

    allowed = {'authentik_core.' + name for name in GLOBAL}
    if set(user.get_all_permissions()) != allowed:
        raise ValueError('Access service account has global permissions beyond view and add group')
    for name in OBJECT:
        if user.has_perm('authentik_core.' + name):
            raise ValueError('Access service account must not change membership of every group')
    for group in Group.objects.all():
        can_change = any(user.has_perm('authentik_core.' + name, group) for name in OBJECT)
        if can_change and (unsafe(group) or str(group.pk) not in grants):
            raise ValueError('Access service account can change a protected group')
        if group.name in BLAK_ROLE_GROUPS and user.has_perm('authentik_core.change_group', group):
            raise ValueError('Access service account can rename or re-parent an app role group')
    token, _ = Token.objects.get_or_create(identifier='blak-portal-access', defaults={
        'user': user, 'intent': 'api', 'expiring': False,
        'description': 'Blak Home People & access: app role and team group membership only',
    })
    if token.user_id != user.pk or token.intent != 'api':
        raise ValueError('Access token belongs to a different identity or purpose')
print('BLAK_ACCESS_ADMIN_SUMMARY managed_groups=%d revoked=%d' % (len(managed), revoked))
print('BLAK_ACCESS_ADMIN_CONFIG=' + json.dumps({'api-token': token.key}))
