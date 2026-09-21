FROM ghcr.io/open-webui/open-webui@sha256:1a6399d237dc392a2313e0ca826020b3fd5d22536357840eb63393d18dc8b924
COPY patch-*.py /tmp/
COPY test_native.py /tmp/test_native.py
COPY test_private_native.py /tmp/test_private_native.py
COPY blak_private.py /app/backend/open_webui/utils/blak_private.py
RUN python /tmp/patch-knowledge.py /app/backend/open_webui/routers/knowledge.py \
    && python /tmp/patch-files.py /app/backend/open_webui/routers/files.py \
    && python /tmp/patch-chroma.py /app/backend/open_webui/retrieval/vector/dbs/chroma.py \
    && python /tmp/patch-controller.py /app/backend/open_webui/routers/users.py \
    && python /tmp/patch-file-access.py /app/backend/open_webui/utils/access_control/files.py \
    && python /tmp/patch-retrieval.py /app/backend/open_webui/routers/retrieval.py \
    && python /tmp/patch-private.py \
    && python /tmp/patch-identity.py \
    && python /tmp/test_native.py \
    && python /tmp/test_private_native.py \
    && rm /tmp/patch-*.py /tmp/test_native.py /tmp/test_private_native.py
