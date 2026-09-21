# Generated from services/app-roles/access.py. Do not edit.
"""Resolve app grants from complete directory data and frozen OIDC subjects."""
import json
from pathlib import Path
import uuid
from directory import users

CONTRACT = json.loads(Path(__file__).with_name('app-grants.json').read_text())


def group_memberships(api):
    groups, page, seen = {}, 1, set()
    while page:
        if type(page) is not int or page in seen:
            raise ValueError('Invalid group pagination')
        seen.add(page)
        response = api('GET', '/api/v3/core/groups/?page_size=100&page=' + str(page))
        for group in response['results']:
            key = group['pk']
            if key in groups or not isinstance(group['name'], str):
                raise ValueError('Duplicate or invalid directory group')
            groups[key] = group
        page = response['pagination']['next']
    by_name = {}
    def ancestors(key, trail):
        if key in trail or key not in groups:
            raise ValueError('Incomplete or cyclic group ancestry')
        group = groups[key]
        result = {group['name']}
        for parent in group['parents']:
            result.update(ancestors(parent, trail | {key}))
        return result
    for key, group in groups.items():
        if group['name'] in by_name:
            raise ValueError('Ambiguous directory group name')
        by_name[group['name']] = ancestors(key, set())
    return by_name


def snapshot(api, aliases):
    # Aliases come from the operator-owned frozen ScopeMapping, never user input.
    if not isinstance(aliases, dict):
        raise ValueError('Invalid immutable subject bindings')
    aliases = {str(uuid.UUID(key)): value for key, value in aliases.items()}
    if any(not isinstance(value, str) or not value for value in aliases.values()):
        raise ValueError('Invalid immutable subject alias')
    members = users(api)
    if not members:
        raise ValueError('Empty directory snapshot')
    ancestry = group_memberships(api)
    subjects = {}
    for identity, member in members.items():
        groups = set()
        for name in member['groups']:
            if name not in ancestry:
                raise ValueError('User refers to an unknown group')
            groups.update(ancestry[name])
        roles, apps = {}, []
        if member['is_active']:
            for app, contract in CONTRACT.items():
                if contract.get('roleGroups'):
                    role = next((name.rsplit('-', 1)[-1] for name in reversed(contract['roleGroups']) if name in groups), None)
                    if role:
                        roles[app] = role
                        apps.append(app)
                elif contract.get('group') and (member['is_superuser'] or contract['group'] in groups):
                    apps.append(app)
        subject = aliases.get(identity, identity)
        if subject in subjects:
            raise ValueError('Ambiguous immutable OIDC subject')
        member.update(identity=identity, subject=subject, groups=sorted(groups), apps=apps, roles=roles)
        subjects[subject] = member
    return subjects
