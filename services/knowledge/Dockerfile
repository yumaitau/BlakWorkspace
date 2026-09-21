FROM outlinewiki/outline@sha256:832051f039b446c87aa23929cf92c00980c66aaa2d744d118c48c016ec816ad8
COPY --chown=1001:1001 roles.cjs /opt/outline/build/server/blak/roles.cjs
COPY --chown=1001:1001 enroll.cjs /opt/outline/build/server/blak/enroll.cjs
COPY --chown=1001:1001 patch.cjs roles.test.cjs native.test.cjs /tmp/blak-knowledge/
RUN node /tmp/blak-knowledge/patch.cjs \
    && cp /opt/outline/build/server/blak/roles.cjs /tmp/blak-knowledge/roles.cjs \
    && node --check /opt/outline/build/server/routes/api/users/users.js \
    && node --test /tmp/blak-knowledge/roles.test.cjs /tmp/blak-knowledge/native.test.cjs \
    && rm -r /tmp/blak-knowledge
