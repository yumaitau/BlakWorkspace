# Generated from services/app-roles/http_client.py. Do not edit.
"""Small, origin-bound HTTP client for native directory/role APIs."""
import http.cookies
import json
import urllib.error
import urllib.parse
import urllib.request


class NativeAPIError(RuntimeError):
    def __init__(self, code):
        self.code = code
        super().__init__('Native API rejected request with HTTP ' + str(code))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class API:
    def __init__(self, base, token=None):
        parsed = urllib.parse.urlsplit(base)
        if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError('Invalid native API origin')
        self.base = base.rstrip('/')
        self.headers = {'Authorization': 'Bearer ' + token} if token else {}
        self.opener = urllib.request.build_opener(NoRedirect())

    def request(self, method, path, data=None, form=False):
        target = urllib.parse.urljoin(self.base + '/', path)
        origin = urllib.parse.urlsplit(self.base)
        parsed = urllib.parse.urlsplit(target)
        if (parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc):
            raise ValueError('Cross-origin native API request rejected')
        headers = dict(self.headers)
        if data is not None:
            headers['Content-Type'] = 'application/x-www-form-urlencoded' if form else 'application/json'
            data = (urllib.parse.urlencode(data) if form else json.dumps(data)).encode()
        request = urllib.request.Request(target, data=data, headers=headers, method=method)
        try:
            response = self.opener.open(request, timeout=30)
        except urllib.error.HTTPError as error:
            if error.code not in (301, 302, 303):
                raise NativeAPIError(error.code) from None
            response = error
        with response:
            body = response.read(8 * 1024 * 1024 + 1)
            if len(body) > 8 * 1024 * 1024:
                raise RuntimeError('Native API metadata response exceeded limit')
            return response.status, response.headers, body

    def __call__(self, method, path, data=None):
        status, _, body = self.request(method, path, data)
        if not 200 <= status < 300:
            raise RuntimeError('Unexpected native API redirect')
        return json.loads(body) if body else None

    def login_api_key(self, client_id, client_secret):
        status, _, body = self.request('POST', '/identity/connect/token', {
            'grant_type': 'client_credentials', 'client_id': client_id, 'client_secret': client_secret,
            'scope': 'api', 'deviceIdentifier': 'blak-vault-role-controller',
            'deviceName': 'Blak ID role controller', 'deviceType': 8,
        }, form=True)
        if status != 200:
            raise RuntimeError('Native API key authentication failed')
        self.headers['Authorization'] = 'Bearer ' + json.loads(body)['access_token']

    def login_operator(self, token):
        status, headers, _ = self.request('POST', '/admin/', {'token': token}, form=True)
        cookie = http.cookies.SimpleCookie()
        for header in headers.get_all('Set-Cookie', []):
            cookie.load(header)
        if status not in (200, 302, 303) or 'VW_ADMIN' not in cookie:
            raise RuntimeError('Vault operator authentication failed')
        self.headers['Cookie'] = 'VW_ADMIN=' + cookie['VW_ADMIN'].value
