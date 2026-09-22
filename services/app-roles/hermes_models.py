"""Grant members inference access to configured runtimes, never private presets."""
from urllib.parse import urlencode

from http_client import NativeAPIError


def reconcile(api, controller, model_ids, groups):
    if not model_ids:
        return
    inventory = {model['id']: model for model in api('GET', '/api/models')['data']}
    grants = [{'principal_type': 'group', 'principal_id': group, 'permission': 'read'}
              for group in groups.values()]
    order = lambda grant: (grant['principal_type'], grant['principal_id'], grant['permission'])
    pending = []
    # Validate the whole configured set before changing any model's grants.
    for model_id in model_ids:
        runtime = inventory.get(model_id, {})
        if runtime.get('owned_by') not in ('ollama', 'openai'):
            raise ValueError('Configured Hermes runtime is unavailable')
        try:
            model = api('GET', '/api/v1/models/model?' + urlencode({'id': model_id}))
        except NativeAPIError as error:
            if error.code != 404:
                raise
            model = None
        if model is not None:
            if model['user_id'] != controller or model.get('base_model_id'):
                raise ValueError('Configured Hermes runtime is not controller-owned')
            actual = [{key: grant[key] for key in ('principal_type', 'principal_id', 'permission')}
                      for grant in model['access_grants']]
            if sorted(actual, key=order) == sorted(grants, key=order):
                continue
        pending.append(model_id)
    for model_id in pending:
        # Native endpoint creates missing base-model records under this controller.
        api('POST', '/api/v1/models/model/access/update', {'id': model_id, 'access_grants': grants})
    if pending:
        api('GET', '/api/models')
