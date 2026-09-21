FROM heyform/community-edition@sha256:0758992b3539a83b5ce3df5ad3e1efabc92dec4d46e05c40bbad37381fad69b4
COPY role-policy.cjs role-bridge.cjs /app/packages/server/dist/src/blak/
COPY role-controller.cjs /app/packages/server/dist/src/controller/blak-role-controller.cjs
COPY patch.cjs native-hashes.json native.test.cjs /tmp/blak-forms/
RUN node /tmp/blak-forms/patch.cjs \
    && node --test /tmp/blak-forms/native.test.cjs \
    && rm -rf /tmp/blak-forms
