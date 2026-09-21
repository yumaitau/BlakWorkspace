"""Reconcile native roles; credentials are mounted files, never command arguments."""
import json
import os
import time
from pathlib import Path
from directory import users
from http_client import API
from vault import VaultRoles
from vault_identity import native_accounts


def reconcile(session):
    config = json.loads(Path(os.environ['ROLE_CONFIG']).read_text())
    directory_api = API(Path(os.environ['BLAK_ID_BASE_FILE']).read_text().strip(),
                        Path(os.environ['BLAK_ID_TOKEN_FILE']).read_text().strip())
    snapshot = users(directory_api)
    if not snapshot:
        raise ValueError('Empty directory snapshot; refusing mass membership removal')
    vault = config['vault']
    if session.get('operator') is None or time.monotonic() >= session.get('until', 0):
        operator = API(vault['base'])
        operator.login_operator(Path(os.environ['VAULT_OPERATOR_TOKEN_FILE']).read_text().strip())
        session.update(operator=operator, until=time.monotonic() + 540)
    operator = session['operator']
    profiles, links = native_accounts(operator, vault['issuer'])
    # One immutable subject per native SSO user. An email change cannot relink it.
    for native_id, subject in links.items():
        if subject in snapshot:
            snapshot[subject]['native_email'] = profiles[native_id]['email']
    api = API(vault['base'])
    api.login_api_key(vault['client_id'], vault['client_secret'])
    profile = api('GET', '/api/accounts/profile')
    if profile['id'] != vault['controller_user_id']:
        raise ValueError('Vault role credential belongs to the wrong controller')
    roles = VaultRoles(api, vault['organization_id'], vault['collection_ids'], vault['controller_user_id'])
    result = roles.reconcile(snapshot, links)
    print('Vault roles reconciled ' + json.dumps(result, sort_keys=True), flush=True)


def main():
    session = {}
    while True:
        try:
            reconcile(session)
            Path('/tmp/roles-ready').touch()
        except Exception as error:
            Path('/tmp/roles-ready').unlink(missing_ok=True)
            print('Vault role reconciliation failed: ' + type(error).__name__, flush=True)
            if os.environ.get('ROLE_ONCE') == '1':
                raise SystemExit(1)
        if os.environ.get('ROLE_ONCE') == '1':
            return
        time.sleep(60)


if __name__ == '__main__':
    main()
