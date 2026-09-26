FROM node:22-alpine AS draw-build
WORKDIR /draw
COPY draw/package*.json ./
RUN npm ci --ignore-scripts
COPY draw/ ./
COPY theme-tokens.json /theme-tokens.json
RUN npm run build && mkdir -p dist/excalidraw && cp -R node_modules/@excalidraw/excalidraw/dist/prod/fonts dist/excalidraw/
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY integration.js app-roles.js session-store.js oidc.js ./
COPY content-sources.json ./
COPY logout-page.js logout.js ./
COPY server.js catalog.js public-urls.js outline-sites.js file-guard.js file-guard-run.js flow-engine.js cloud-object.js cloud-console.js session.js http-client.js request-body.js search-access.js theme.js theme-tokens.json styles.css brand-banner.png ./
COPY brand-icons/ ./brand-icons/
COPY brand-home-logo.jpg brand.js welcome.js login-background.png ./
COPY fonts.css ./
COPY fonts/ ./fonts/
COPY sync-health.js draw-store.js knowledge-export.js ./
COPY host-monitor.js backups.js ./
COPY access-catalog.js access-model.js access-guard.js access-pages.js blak-id-admin.js ./
COPY --from=draw-build /draw/dist/ ./draw-dist/
RUN node -e "require('./server')"
ENV PORT=3000 NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
