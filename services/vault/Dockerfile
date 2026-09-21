# Vaultwarden 1.37.3. Native encryption and authentication code are unchanged.
FROM vaultwarden/server@sha256:1587c45feaa479f1f5e8af3b00eded36bff77bcf1880cf8dbf0541706dd470e0
COPY services/vault/index-transform.sed /tmp/blak-index.sed
COPY services/vault/brand.css /web-vault/css/blak.css
COPY apps/portal/fonts/ /web-vault/fonts/
COPY services/workspace-shell/logo.svg /web-vault/images/blak-logo.svg
RUN test "$(grep -o '<body class="layout_frontend">' /web-vault/index.html | wc -l)" -eq 1 \
    && sed -i -f /tmp/blak-index.sed /web-vault/index.html \
    && rm /tmp/blak-index.sed
