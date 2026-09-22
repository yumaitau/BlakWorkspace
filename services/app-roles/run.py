"""Reconcile native roles; credentials are mounted files, never command arguments."""
import json
import os
import time
from pathlib import Path
from access import snapshot as directory_snapshot
from hermes import HermesRoles
from knowledge import KnowledgeRoles
import hermes_copies
import projects
import crm
import forms
import chat
from http_client import API
from vault import VaultRoles
from vault_identity import native_accounts


def reconcile_vault(vault, snapshot, session):
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
    if session.get('api') is None or time.monotonic() >= session.get('api_until', 0):
        api = API(vault['base'])
        api.login_api_key(vault['client_id'], vault['client_secret'])
        session.update(api=api, api_until=time.monotonic() + 300)
    api = session['api']
    profile = api('GET', '/api/accounts/profile')
    if profile['id'] != vault['controller_user_id']:
        raise ValueError('Vault role credential belongs to the wrong controller')
    roles = VaultRoles(api, vault['organization_id'], vault['collection_ids'], vault['controller_user_id'])
    result = roles.reconcile(snapshot, links)
    print('Vault roles reconciled ' + json.dumps(result, sort_keys=True), flush=True)


def reconcile(session):
    config = json.loads(Path(os.environ['ROLE_CONFIG']).read_text())
    api = API(Path(os.environ['BLAK_ID_BASE_FILE']).read_text().strip(),
              Path(os.environ['BLAK_ID_TOKEN_FILE']).read_text().strip())
    aliases = json.loads(Path(os.environ['BLAK_ID_SUBJECTS_FILE']).read_text())
    directory = directory_snapshot(api, aliases)
    if not config or not set(config) <= {'vault', 'hermes', 'projects', 'knowledge', 'crm', 'forms', 'chat'}:
        raise ValueError('Unknown or empty native role configuration')
    failures = []
    if config.get('chat'):
        try:
            settings = config['chat']
            result = chat.reconcile(API(settings['base'], settings['token']), directory)
            print('Chat roles reconciled ' + json.dumps(result, sort_keys=True), flush=True)
        except Exception as error:
            failures.append('Chat:' + type(error).__name__)
    if config.get('forms'):
        try:
            settings = config['forms']
            native = API(settings['base'], settings['token'])
            result = forms.reconcile(native, directory)
            print('Forms roles reconciled ' + json.dumps(result, sort_keys=True), flush=True)
        except Exception as error:
            failures.append('Forms:' + type(error).__name__)
    if config.get('hermes'):
        try:
            hermes = config['hermes']
            native = API(hermes['base'], hermes['token'])
            profile = native('GET', '/api/v1/auths/')
            if profile['id'] != hermes['controller_user_id'] or profile['role'] != 'admin':
                raise ValueError('Hermes controller identity mismatch')
            removed = hermes_copies.reconcile(native, directory, os.environ['HERMES_SYNC_STATE'], hermes['controller_user_id'])
            result = HermesRoles(native, hermes['controller_user_id'], hermes['collection_ids'], hermes.get('model_ids', [])).reconcile(directory)
            print('Hermes roles reconciled ' + json.dumps({**result, 'revoked_copies': removed}, sort_keys=True), flush=True)
        except Exception as error:
            failures.append('Hermes:' + type(error).__name__)
    if config.get('projects'):
        try:
            native = API(config['projects']['base'], config['projects']['token'])
            result = projects.reconcile(native, directory)
            print('Projects roles reconciled ' + json.dumps(result, sort_keys=True), flush=True)
        except Exception as error:
            failures.append('Projects:' + type(error).__name__)
    if config.get('crm'):
        try:
            settings = config['crm']
            native = API(settings['base'])
            native.headers['Authorization'] = 'token ' + settings['api_key'] + ':' + settings['api_secret']
            result = crm.reconcile(native, directory, settings['controller_user_id'])
            print('CRM roles reconciled ' + json.dumps(result, sort_keys=True), flush=True)
        except Exception as error:
            failures.append('CRM:' + type(error).__name__)
    if config.get('knowledge'):
        try:
            knowledge = config['knowledge']
            native = API(knowledge['base'], knowledge['token'])
            result = KnowledgeRoles(native, knowledge['controller_user_id']).reconcile(directory)
            print('Knowledge roles reconciled ' + json.dumps(result, sort_keys=True), flush=True)
        except Exception as error:
            failures.append('Knowledge:' + type(error).__name__)
    if config.get('vault'):
        try:
            reconcile_vault(config['vault'], {member['identity']: member for member in directory.values()}, session)
        except Exception as error:
            failures.append('Vault:' + type(error).__name__)
    if failures:
        raise RuntimeError('Native role reconciliation failed: ' + ', '.join(failures))


def main():
    session = {}
    while True:
        try:
            reconcile(session)
            Path('/tmp/roles-ready').touch()
        except Exception as error:
            Path('/tmp/roles-ready').unlink(missing_ok=True)
            print('Native role reconciliation failed: ' + str(error) if isinstance(error, RuntimeError) else 'Native role reconciliation failed: ' + type(error).__name__, flush=True)
            if os.environ.get('ROLE_ONCE') == '1':
                raise SystemExit(1)
        if os.environ.get('ROLE_ONCE') == '1':
            return
        time.sleep(60)


if __name__ == '__main__':
    main()
