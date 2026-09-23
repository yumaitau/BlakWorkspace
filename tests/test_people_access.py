"""People & access: rendered pages, reconciler role resolution and deploy guardrails."""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
import uuid
from unittest.mock import patch

from repo import ROOT, read

sys.path.insert(0, str(ROOT / 'services/app-roles'))
import access  # noqa: E402

_CACHE: dict = {}


def _fixture() -> dict:
    if not _CACHE:
        out = subprocess.check_output(['node', str(ROOT / 'apps' / 'portal' / 'render-fixture.js')], cwd=str(ROOT), text=True)
        _CACHE.update(json.loads(out))
    return _CACHE


class RenderedPages(unittest.TestCase):
    def test_nav_links_people_and_access_and_my_access(self):
        html = _fixture()['html']
        self.assertIn('href="/access"', html)
        self.assertIn('People &amp; access', html)
        self.assertIn('href="/access/me">My access', html)

    def test_explainer_covers_every_rule_with_a_diagram(self):
        html = _fixture()['access']['explainer']
        self.assertIn('class=accessflow', html)
        self.assertIn('<figcaption', html)
        for phrase in ('The highest role wins', 'No role means no access', 'App admin is not Blak ID admin',
                       'Workspace administrators', 'How long changes take', 'Team groups pass their role to every member',
                       'Private items stay private', 'Retired groups do nothing', 'Ask your workspace administrator'):
            self.assertIn(phrase, html)

    def test_my_access_names_role_meaning_and_group(self):
        html = _fixture()['access']['me']
        self.assertIn('Through the team group Rangers', html)
        self.assertIn('Given to you directly', html)
        self.assertIn('Send messages and files', html)
        self.assertIn('<th scope=col>How you got it</th>', html)

    def test_admin_area_refuses_members_and_renders_for_admins(self):
        data = _fixture()['access']
        self.assertEqual(data['memberAdmin']['status'], 403)
        self.assertIn('Only workspace administrators', data['memberAdmin']['body'])
        self.assertIn('Add an assignment', data['app'])
        self.assertIn('Give a team group a role', data['app'])
        self.assertIn('Retired: no effect', data['groups'])
        self.assertIn('Workspace administrators', data['groups'])
        self.assertIn('Create a team group', data['groups'])
        self.assertIn('Effective access', data['person'])

    def test_every_form_control_is_labelled_and_posts_carry_csrf(self):
        data = _fixture()['access']
        for name in ('app', 'group', 'person', 'groups'):
            html = data[name]
            self.assertEqual(html.count('<form method=post'), html.count('name="csrf"'), name)
            self.assertEqual(html.count('<select id='), html.count('<label for='), name)

    def test_review_states_the_effect_before_confirming(self):
        html = _fixture()['access']['review']
        self.assertIn('Jo Nguyen will be able to add and edit files in Blak Drive', html)
        self.assertIn('action="/access/admin/apply"', html)
        self.assertIn('Confirm change', html)


class TeamRoleResolution(unittest.TestCase):
    """Native reconcilers follow group parents, so team-group roles reach every app."""

    def resolve(self, groups):
        identity = str(uuid.uuid4())
        user = {'is_active': True, 'email': 'fixture@example.invalid', 'is_superuser': False, 'groups': groups}
        tree = [
            {'pk': 'rangers', 'name': 'Rangers', 'parents': ['drive-writer', 'chat-reader']},
            {'pk': 'drive-reader', 'name': 'blak-drive-reader', 'parents': []},
            {'pk': 'drive-writer', 'name': 'blak-drive-writer', 'parents': []},
            {'pk': 'chat-reader', 'name': 'blak-chat-reader', 'parents': []},
            {'pk': 'chat-admin', 'name': 'blak-chat-admin', 'parents': []},
        ]
        with patch.object(access, 'users', return_value={identity: user}):
            return access.snapshot(lambda *args: {'results': tree, 'pagination': {'next': 0}}, {})[identity]['roles']

    def test_direct_and_team_roles_resolve_to_the_highest(self):
        roles = self.resolve(['blak-drive-reader', 'Rangers', 'blak-chat-admin'])
        self.assertEqual(roles['drive'], 'writer')
        self.assertEqual(roles['docs'], 'writer')
        self.assertEqual(roles['chat'], 'admin')

    def test_leaving_the_team_leaves_the_direct_role(self):
        self.assertEqual(self.resolve(['blak-drive-reader'])['drive'], 'reader')

    def test_claim_expression_uses_inherited_membership(self):
        # ak_is_group_member follows User.all_groups(), which includes ancestors.
        text = read('scripts/deploy/ak-workspace-contract.py')
        self.assertIn('ak_is_group_member(user, name=name)', text)


class DeployGuardrails(unittest.TestCase):
    def test_service_account_has_exactly_membership_permissions(self):
        text = read('scripts/deploy/ak-access-admin.py')
        self.assertIn("PERMISSIONS = ['view_user', 'view_group', 'add_user_to_group', 'remove_user_from_group', 'add_group', 'change_group']", text)
        for forbidden in ('enable_group_superuser', 'delete_user', 'delete_group', 'change_user', 'change_role', 'is_superuser = True'):
            self.assertNotIn(forbidden + "'", text.replace('"', "'"))
        self.assertIn("'type': 'service_account'", text)
        self.assertIn('get_all_permissions()) != allowed', text)

    def test_token_goes_to_a_secret_that_is_never_printed_or_replaced(self):
        text = read('scripts/deploy/provision-access-admin.py')
        self.assertIn("ensure_secret('blak-portal-access', {})", text)
        self.assertNotIn('print(token', text)
        self.assertIn('python3 scripts/deploy/provision-access-admin.py', read('scripts/deploy/deploy-micro.sh'))
        manifest = read('deploy/k3s/micro/30-portal.yaml')
        self.assertIn('name: blak-portal-access, key: api-token, optional: true', manifest)

    def test_portal_image_ships_the_access_modules(self):
        dockerfile = read('apps/portal/Dockerfile')
        for name in ('access-catalog.js', 'access-model.js', 'access-guard.js', 'access-pages.js', 'blak-id-admin.js'):
            self.assertIn(name, dockerfile)
        self.assertNotIn('access-fixture.js', dockerfile)

    def test_group_descriptions_merge_and_delete_nothing(self):
        text = read('scripts/deploy/ak-workspace-contract.py')
        self.assertIn('BLAK_GROUP_NOTES', text)
        self.assertIn('group.attributes.update(note)', text)
        self.assertNotIn('.delete()', text)
        self.assertIn('BLAK_GROUP_NOTES=', read('scripts/deploy/provision-id.py'))


if __name__ == '__main__':
    unittest.main()
