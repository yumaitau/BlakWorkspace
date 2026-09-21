# Vaultwarden 1.37.3. Native encryption and authentication code are unchanged.
FROM vaultwarden/server@sha256:1587c45feaa479f1f5e8af3b00eded36bff77bcf1880cf8dbf0541706dd470e0
COPY services/vault/index-transform.sed /tmp/blak-index.sed
COPY services/vault/brand.css /web-vault/css/blak.css
COPY apps/portal/fonts/ /web-vault/fonts/
COPY services/workspace-shell/logo.svg /web-vault/images/blak-logo.svg
RUN for anchor in '<body class="layout_frontend">' '<title page-title>Vaultwarden Web</title>' '</head>' '<link rel="stylesheet" href="css/vaultwarden.css"/>'; do \
      test "$(grep -Fo "$anchor" /web-vault/index.html | wc -l)" -eq 1 || exit 1; \
    done \
    && sed -i -f /tmp/blak-index.sed /web-vault/index.html \
    && grep -Fq '<link rel="stylesheet" href="/css/blak.css"/>' /web-vault/index.html \
    && rm /tmp/blak-index.sed
