FROM ghcr.io/usekaneo/kaneo@sha256:a85a23996c36166cfcebcb4ee161b40cc62c7b924faf06353684a84d5e84162c
COPY --chown=1001:1001 patch.mjs /tmp/blak-projects-patch.mjs
COPY --chown=1001:1001 role-bridge.mjs /app/apps/api/dist/blak-role-bridge.mjs
COPY --chown=1001:1001 role-bridge.test.mjs /tmp/role-bridge.test.mjs
COPY --chown=1001:1001 native-permissions.test.mjs /tmp/native-permissions.test.mjs
RUN node /tmp/blak-projects-patch.mjs /app/apps/api/dist/index.js \
    && node --check /app/apps/api/dist/index.js \
    && cp /app/apps/api/dist/blak-role-bridge.mjs /tmp/role-bridge.mjs \
    && node --test /tmp/role-bridge.test.mjs \
    && node --test /tmp/native-permissions.test.mjs \
    && rm /tmp/blak-projects-patch.mjs /tmp/role-bridge.mjs /tmp/role-bridge.test.mjs /tmp/native-permissions.test.mjs
