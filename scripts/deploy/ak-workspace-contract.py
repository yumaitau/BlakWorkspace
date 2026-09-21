"""Execute through ak shell with BLAK_APPS injected from the portal contract.

Never changes client IDs, client secrets, redirect URIs, or existing subject links.
The frozen UUID-to-legacy-subject map belongs to the managed ScopeMapping, not to
user-editable attributes. New accounts use their immutable UUID from creation.
"""
import json
from django.db import transaction
from authentik.core.models import Application, Group, User
from authentik.flows.models import Flow, FlowStageBinding
from authentik.stages.user_logout.models import UserLogoutStage
from authentik.policies.models import PolicyBinding
from authentik.policies.expression.models import ExpressionPolicy
from authentik.providers.oauth2.models import ScopeMapping, RedirectURI, RedirectURIMatchingMode


with transaction.atomic():
    name = 'Blak Workspace stable subject'
    stable = ScopeMapping.objects.filter(name=name).first()
    if stable:
        # Preserve the original bindings across renames and repeated deployments.
        bindings = json.loads(stable.expression.splitlines()[0].removeprefix('# bindings: '))
    else:
        bindings = {str(u.uuid): u.username for u in User.objects.exclude(username='AnonymousUser')}
    expression = '# bindings: ' + json.dumps(bindings, sort_keys=True) + '\n'
    expression += 'legacy = ' + repr(bindings) + '\n'
    expression += 'return {"sub": legacy.get(str(user.uuid), str(user.uuid))}'
    stable, _ = ScopeMapping.objects.update_or_create(name=name, defaults={
        'scope_name': 'profile', 'expression': expression,
        'description': 'Immutable subject with preserved existing account links',
    })
    # Migrate existing portal-module grants once. Existing members keep writer
    # access; only existing directory operators receive app admin. Subsequent
    # role removals are authoritative and must never be re-seeded on deployment.
    for item in BLAK_APPS:
        names = item.get('roleGroups', [])
        for role_name in names:
            Group.objects.get_or_create(name=role_name)
        if not names or not item.get('group'):
            continue
        legacy_group, _ = Group.objects.get_or_create(name=item['group'])
        if legacy_group.attributes.get('blak_role_migration_completed'):
            continue
        writer = Group.objects.get(name=next(name for name in names if name.endswith('-writer')))
        admin = Group.objects.get(name=next(name for name in names if name.endswith('-admin')))
        for member in User.objects.exclude(username='AnonymousUser'):
            if member.all_groups().filter(name__in=names).exists():
                continue  # Preserve an explicitly assigned reader or writer role.
            if member.is_superuser:
                member.groups.add(admin)
            elif member.all_groups().filter(pk=legacy_group.pk).exists():
                member.groups.add(writer)
        legacy_group.attributes['blak_role_migration_completed'] = True
        legacy_group.save(update_fields=['attributes'])
    groups = {a['id']: a['group'] for a in BLAK_APPS if a.get('group') and not a.get('roleGroups')}
    for group in set(groups.values()):
        Group.objects.get_or_create(name=group)
    expression = 'groups = ' + repr(groups) + '\n'
    expression += 'grants = [key for key, group in groups.items() if user.is_superuser or ak_is_group_member(user, name=group)]\n'
    role_groups = {a['id']: a['roleGroups'] for a in BLAK_APPS if a.get('roleGroups')}
    expression += 'role_groups = ' + repr(role_groups) + '\n'
    expression += 'roles = {key: next((name.rsplit("-", 1)[-1] for name in reversed(names) if ak_is_group_member(user, name=name)), None) for key, names in role_groups.items()}\n'
    expression += 'roles = {key: role for key, role in roles.items() if role}\n'
    expression += 'grants += list(roles)\n'
    expression += 'if user.is_superuser:\n    grants.append("idp")\n'
    expression += 'return {"blak_id": str(user.uuid), "blak_apps": grants if user.is_active else [], "blak_roles": roles if user.is_active else {}, "blak_active": user.is_active}'
    access, _ = ScopeMapping.objects.update_or_create(name='Blak Workspace access', defaults={
        'scope_name': 'profile', 'description': 'Your workspace applications', 'expression': expression,
    })
    seen = set()
    for item in BLAK_APPS + [{'application': 'blak-portal'}]:
        slug = item.get('application')
        if not slug or slug in seen:
            continue
        seen.add(slug)
        app = Application.objects.select_related('provider').get(slug=slug)
        provider = app.provider.oauth2provider
        if provider.sub_mode == 'user_username':
            provider.property_mappings.add(stable)
        provider.property_mappings.add(access)
        if slug == 'blak-portal':
            flow, _ = Flow.objects.update_or_create(slug='blak-workspace-invalidation', defaults={
                'name': 'Blak Workspace logout', 'title': 'Signing out of Blak Workspace',
                'designation': 'invalidation',
            })
            stage, _ = UserLogoutStage.objects.get_or_create(name='blak-workspace-logout')
            FlowStageBinding.objects.update_or_create(target=flow, stage=stage, defaults={'order': 0})
            provider.invalidation_flow = flow
            provider.property_mappings.add(*ScopeMapping.objects.filter(scope_name='offline_access'))
            provider.logout_uri = 'http://portal.blak-micro.svc.cluster.local:3000/oidc/backchannel-logout'
            provider.logout_method = 'backchannel'
            root = globals().get('BLAK_PORTAL_URL', 'https://portal.workspace.example.com').rstrip('/') + '/'
            redirects = list(provider.redirect_uris)
            if not any(uri.url == root for uri in redirects):
                redirects.append(RedirectURI(matching_mode=RedirectURIMatchingMode.STRICT, url=root))
            provider.redirect_uris = redirects
            provider.save()
        if item.get('group'):
            policy, _ = ExpressionPolicy.objects.update_or_create(name='Blak access: ' + slug, defaults={
                'expression': 'return request.user.is_active and (request.user.is_superuser or ak_is_group_member(request.user, name=' + repr(item['group']) + '))',
            })
            PolicyBinding.objects.update_or_create(target=app, policy=policy, defaults={'order': 0, 'enabled': True})
            app.policy_engine_mode = 'all'
            app.save(update_fields=['policy_engine_mode'])
    print('BLAK_CONTRACT_OK ' + json.dumps({'applications': sorted(seen), 'preserved_subjects': len(bindings)}))
