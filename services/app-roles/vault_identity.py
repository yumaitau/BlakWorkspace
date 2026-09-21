"""Read immutable native SSO bindings from Vaultwarden's pinned operator view.

1.37.3 exposes the SSO association in the operator HTML, not its JSON API. Parse
that table with strict shape checks and cross-check account IDs against JSON.
An upstream shape change fails the run; no email-based relinking fallback.
"""
from html.parser import HTMLParser
import uuid


class SsoTable(HTMLParser):
    def __init__(self):
        super().__init__()
        self.active = False
        self.cell = None
        self.cells = []
        self.headers = []
        self.ids = set()
        self.rows = {}

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'table' and attrs.get('id') == 'users-table':
            self.active = True
        if not self.active:
            return
        if tag == 'tr':
            self.cells, self.ids = [], set()
        if tag in ('td', 'th'):
            self.cell = [tag, '']
        if attrs.get('data-vw-user-uuid'):
            self.ids.add(str(uuid.UUID(attrs['data-vw-user-uuid'])))

    def handle_data(self, value):
        if self.active and self.cell:
            self.cell[1] += value

    def handle_endtag(self, tag):
        if not self.active:
            return
        if tag in ('td', 'th') and self.cell:
            kind, text = self.cell
            (self.headers if kind == 'th' else self.cells).append(text.strip())
            self.cell = None
        if tag == 'tr' and self.cells:
            if len(self.ids) != 1 or len(self.cells) != len(self.headers):
                raise ValueError('Unexpected native SSO metadata row')
            key = next(iter(self.ids))
            if key in self.rows:
                raise ValueError('Duplicate native SSO metadata row')
            self.rows[key] = self.cells
        if tag == 'table':
            self.active = False

    def links(self, issuer, profiles):
        if self.headers.count('SSO Identifier') != 1 or set(self.rows) != set(profiles):
            raise ValueError('Incomplete native SSO metadata snapshot')
        column = self.headers.index('SSO Identifier')
        prefix = issuer + '/'  # Upstream OIDCIdentifier preserves the issuer slash.
        links = {}
        for native_id, row in self.rows.items():
            value = row[column]
            if not value:
                continue
            if not value.startswith(prefix):
                raise ValueError('Native account uses an unexpected SSO issuer')
            subject = str(uuid.UUID(value[len(prefix):]))
            if subject in links.values():
                raise ValueError('Duplicate native account for a Blak ID subject')
            links[native_id] = subject
        return links


def native_accounts(operator, issuer):
    profiles = {str(uuid.UUID(user['id'])): user for user in operator('GET', '/admin/users')}
    status, _, html = operator.request('GET', '/admin/users/overview')
    if status != 200:
        raise ValueError('Native SSO metadata is unavailable')
    table = SsoTable()
    table.feed(html.decode())
    return profiles, table.links(issuer, profiles)
