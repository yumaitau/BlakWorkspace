#!/usr/bin/env python3
"""Push Blak ID membership into BlakSmith and BlakEyes.

Both products sign a person in only after this directory account exists.
externalId is the Authentik user UUID, which is also the OIDC subject.
Each product receives one group whose external id is reader, writer, or admin.
A person in more than one role group keeps the highest role. Membership through a
team group counts, because Authentik's all_groups() includes parent groups.
Workspace administrators (Blak ID superusers) are admin in both products.

    python3 scripts/deploy/sync-directory.py --from-file people.json
    SMITH_SCIM_URL=http://127.0.0.1:3000/api/auth/scim/v2 \\
    EYES_SCIM_URL=http://127.0.0.1:8765/scim/v2 \\
    python3 scripts/deploy/sync-directory.py --from-cluster --push

--push reads bearers from secrets blak-smith and blak-eyes and does not print them.
Port-forward both services before --push from a laptop. --from-cluster lists users
through ak shell and prints only ids, emails, names, and the role group names.
"""
import argparse
import base64
import json
import subprocess
import urllib.error
import urllib.parse
import urllib.request

PRODUCTS = {
    'smith': ('blak-smith-admin', 'blak-smith-writer', 'blak-smith-reader'),
    'eyes': ('blak-eyes-admin', 'blak-eyes-writer', 'blak-eyes-reader'),
}
PRIORITY = ('admin', 'writer', 'reader')
LISTING = r"""
import json
from authentik.core.models import User
wanted = ('blak-smith-', 'blak-eyes-')
people = []
for user in User.objects.all().iterator():
    if user.username in {'AnonymousUser'} or getattr(user, 'type', '') == 'internal_service_account':
        continue
    groups = [name for name in user.all_groups().values_list('name', flat=True) if name.startswith(wanted)]
    if not groups and not user.is_superuser and not user.email:
        continue
    people.append({
        'id': str(user.uuid),
        'email': user.email or '',
        'name': user.name or '',
        'active': bool(user.is_active),
        'groups': groups,
        'superuser': bool(user.is_superuser),
    })
print('DIRECTORY_JSON=' + json.dumps(people))
"""


def role_for(groups, names):
    mapping = {name: name.rsplit('-', 1)[-1] for name in names}
    for role in PRIORITY:
        if any(mapping.get(group) == role for group in groups):
            return role
    return None


def plan(people):
    products = {}
    skipped = []
    seen_skip = set()
    for product, names in PRODUCTS.items():
        users = []
        buckets = {role: [] for role in PRIORITY}
        for person in people:
            email = (person.get('email') or '').strip().lower()
            if not email:
                if person.get('id') not in seen_skip:
                    skipped.append(person.get('id'))
                    seen_skip.add(person.get('id'))
                continue
            role = 'admin' if person.get('superuser') else role_for(person.get('groups') or [], names)
            if role is None:
                continue
            users.append({
                'schemas': ['urn:ietf:params:scim:schemas:core:2.0:User'],
                'externalId': person['id'],
                'userName': email,
                'displayName': person.get('name') or email,
                'active': bool(person.get('active', True)),
            })
            buckets[role].append(person['id'])
        products[product] = {
            'users': users,
            'groups': [
                {
                    'schemas': ['urn:ietf:params:scim:schemas:core:2.0:Group'],
                    'externalId': role,
                    'displayName': role,
                    'members': [{'value': member} for member in buckets[role]],
                }
                for role in PRIORITY
            ],
        }
    return {'products': products, 'skipped': skipped}


def _match(resources, key, value):
    return [item for item in resources if item.get(key) == value]


def apply_product(send, product_plan, user_filter='externalId'):
    for user in product_plan['users']:
        value = user[user_filter]
        found = send('GET', '/Users?filter=' + urllib.parse.quote(f'{user_filter} eq "{value}"'))
        resources = _match(found.get('Resources') or [], user_filter, value)
        if resources:
            send('PUT', '/Users/' + resources[0]['id'], user)
        else:
            send('POST', '/Users', user)
    for group in product_plan['groups']:
        found = send('GET', '/Groups?filter=' + urllib.parse.quote(f'externalId eq "{group["externalId"]}"'))
        resources = _match(found.get('Resources') or [], 'externalId', group['externalId'])
        if resources:
            send('PUT', '/Groups/' + resources[0]['id'], group)
        else:
            send('POST', '/Groups', group)


def _secret(kubectl, name, key):
    raw = subprocess.check_output(kubectl + ['get', 'secret', name, '-o', f'jsonpath={{.data.{key}}}'])
    return base64.b64decode(raw).decode()


def _http(base, bearer):
    def send(method, path, body=None):
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            base.rstrip('/') + path,
            data=data,
            method=method,
            headers={'Authorization': 'Bearer ' + bearer, 'Content-Type': 'application/scim+json'},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read()
        except urllib.error.HTTPError as exc:
            raise SystemExit(f'{method} {path} failed: {exc.code}') from exc
        if not payload:
            return {}
        return json.loads(payload)

    return send


def _cluster_people(kubectl):
    result = subprocess.run(
        kubectl + ['exec', '-i', 'deploy/authentik-server', '--', 'ak', 'shell'],
        input=('exec(' + repr(LISTING) + ')\n').encode(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )
    marker = b'DIRECTORY_JSON='
    line = next(item for item in result.stdout.splitlines() if item.startswith(marker))
    return json.loads(line[len(marker):])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--from-file', type=argparse.FileType())
    parser.add_argument('--from-cluster', action='store_true')
    parser.add_argument('--push', action='store_true')
    parser.add_argument('--namespace', default='blak-micro')
    args = parser.parse_args()
    if args.from_file and args.from_cluster:
        raise SystemExit('Choose one directory source')
    if args.from_cluster:
        people = _cluster_people(['kubectl', '-n', args.namespace])
    elif args.from_file:
        people = json.load(args.from_file)
    else:
        people = json.load(__import__('sys').stdin)
    directory = plan(people)
    if not args.push:
        print(json.dumps(directory, indent=2))
        return
    import os
    kubectl = ['kubectl', '-n', args.namespace]
    targets = {
        'smith': (
            os.environ.get('SMITH_SCIM_URL', 'http://127.0.0.1:3000/api/auth/scim/v2'),
            f"blak-id-scim.{_secret(kubectl, 'blak-smith', 'organization-id')}.{_secret(kubectl, 'blak-smith', 'scim-secret')}",
        ),
        'eyes': (
            os.environ.get('EYES_SCIM_URL', 'http://127.0.0.1:8765/scim/v2'),
            f"blak-id-scim.{_secret(kubectl, 'blak-eyes', 'organization-id')}.{_secret(kubectl, 'blak-eyes', 'scim-secret')}",
        ),
    }
    user_filters = {'smith': 'userName', 'eyes': 'externalId'}
    for product, (url, bearer) in targets.items():
        apply_product(_http(url, bearer), directory['products'][product], user_filters[product])
    print('Directory pushed to BlakSmith and BlakEyes')


if __name__ == '__main__':
    main()
