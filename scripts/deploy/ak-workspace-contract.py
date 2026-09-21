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
    groups = {a['id']: a['group'] for a in BLAK_APPS if a.get('group')}
    for group in set(groups.values()):
        Group.objects.get_or_create(name=group)
    expression = 'groups = ' + repr(groups) + '\n'
    expression += 'grants = [key for key, group in groups.items() if user.is_superuser or ak_is_group_member(user, name=group)]\n'
    expression += 'if user.is_superuser:\n    grants.append("idp")\n'
    expression += 'return {"blak_id": str(user.uuid), "blak_apps": grants if user.is_active else [], "blak_active": user.is_active}'
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
