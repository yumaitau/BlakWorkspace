FROM rocketchat/rocket.chat@sha256:2cc2f6a9e26d339b68e6a3a9805a74647d77f971f24ac8c1ecbf4755cbf8d052
USER root
COPY *.cjs /app/bundle/blak/
RUN node /app/bundle/blak/patch.cjs && node --check /app/bundle/programs/server/app/app.js && node --test /app/bundle/blak/*.test.cjs
USER 65533:65533
