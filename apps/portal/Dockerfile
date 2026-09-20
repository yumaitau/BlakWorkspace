FROM node:22-alpine
WORKDIR /app
COPY package.json server.js catalog.js flow-engine.js cloud-object.js session.js http-client.js request-body.js search-access.js theme.js theme-tokens.json styles.css brand-banner.png ./
COPY brand-icons/ ./brand-icons/
ENV PORT=3000 NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
