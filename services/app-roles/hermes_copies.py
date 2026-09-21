"""Revoke tracked Hermes copies before restoring native access to an account."""
import fcntl
import json
from pathlib import Path
from http_client import NativeAPIError

SOURCES = json.loads(Path(__file__).with_name('content-sources.json').read_text())


def read(path):
    return json.loads(path.read_text()) if path.exists() else {}


def save(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, indent=2))
    temporary.chmod(0o600)
    temporary.replace(path)


def revoked(state, owners, directory):
    result = []
    for account, sources in state.items():
        if not any(record.get('files') or record.get('revocation_pending') for record in sources.values()):
            continue
        binding = owners.get(account)
        if not binding or set(binding) != {'native_id', 'subject'}:
            raise ValueError('Sync copies lack an immutable owner binding')
        member = directory.get(binding['subject'])
        apps = set(member['apps']) if member and member['is_active'] else set()
        for name, record in sources.items():
            if name not in SOURCES:
                raise ValueError('Unknown source in private sync state')
            if (record.get('files') or record.get('revocation_pending')) and ('hermes' not in apps or SOURCES[name]['app'] not in apps):
                result.append((binding['native_id'], account, name, record))
    return result


def reconcile(api, directory, state_path, controller):
    state_path = Path(state_path)
    owners_path = state_path.with_name('owners.json')
    planned = revoked(read(state_path), read(owners_path), directory)
    if not planned:
        return 0
    # A native pending role blocks existing tokens while indexing holds the lock.
    # Do not reopen the account until every required copy deletion has succeeded.
    paused = set()
    def pause(owner):
        if owner != controller and owner not in paused:
            try:
                api('POST', '/api/v1/users/' + owner + '/update', {'role': 'pending'})
            except NativeAPIError as error:
                if error.code != 404:
                    raise
            paused.add(owner)
    for owner, _, _, _ in planned:
        pause(owner)
    with state_path.with_suffix('.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('Sync active; revoked accounts remain pending until cleanup') from None
        state = read(state_path)
        planned = revoked(state, read(owners_path), directory)
        removed = 0
        for owner, _, _, record in planned:
            pause(owner)
            record['revocation_pending'] = True
            save(state_path, state)
            for key in list(record['files']):
                item = record['files'][key]
                for file_id in dict.fromkeys(item.get('cleanup', []) + [item['file_id']]):
                    try:
                        file = api('GET', '/api/v1/files/' + file_id)
                    except NativeAPIError as error:
                        if error.code != 404:
                            raise
                    else:
                        if file['user_id'] != owner:
                            raise ValueError('Refusing to delete another owner\'s native file')
                        api('DELETE', '/api/v1/files/' + file_id)
                        removed += 1
                del record['files'][key]
                save(state_path, state)
            record['access_revoked'] = True
            record.pop('last_error', None)
            model_id = 'blak-workspace-' + owner
            try:
                model = api('GET', '/api/v1/models/model?id=' + model_id)
            except NativeAPIError as error:
                if error.code != 404:
                    raise
            else:
                if model['user_id'] != owner:
                    raise ValueError('Managed model belongs to a different owner')
                references = model.get('meta', {}).get('knowledge', [])
                remaining = [item for item in references if item.get('id') != record.get('collection')]
                if remaining != references:
                    body = {key: model[key] for key in ('id', 'name', 'base_model_id', 'meta', 'params', 'access_grants', 'is_active')}
                    body['meta'] = {**body['meta'], 'knowledge': remaining}
                    api('POST', '/api/v1/models/model/update', body)
            record.pop('revocation_pending', None)
            save(state_path, state)
        return removed
