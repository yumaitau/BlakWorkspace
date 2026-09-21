"""Complete authenticated directory snapshots; never treat a failed read as empty."""
import uuid


def users(api):
    result = {}
    page = 1
    seen = set()
    while page:
        if not isinstance(page, int) or page in seen:
            raise ValueError('Invalid directory pagination')
        seen.add(page)
        response = api('GET', '/api/v3/core/users/?page_size=100&page=' + str(page))
        for user in response['results']:
            subject = str(uuid.UUID(user['uuid']))
            if subject in result:
                raise ValueError('Duplicate directory identity')
            if not isinstance(user['is_active'], bool) or not isinstance(user['email'], str):
                raise ValueError('Invalid directory identity metadata')
            groups = user['groups_obj']
            result[subject] = {'is_active': user['is_active'], 'email': user['email'],
                               'groups': [group['name'] for group in groups]}
        page = response['pagination']['next']
    return result
