ARG ROCKET_CHAT_VERSION=8.8.1
FROM rocketchat/rocket.chat:${ROCKET_CHAT_VERSION}
USER root
COPY *.cjs /app/bundle/blak/
RUN node /app/bundle/blak/patch.cjs && node --check /app/bundle/programs/server/app/app.js && node --test /app/bundle/blak/*.test.cjs
USER 65533:65533
