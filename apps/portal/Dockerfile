FROM node:22-alpine AS draw-build
WORKDIR /draw
COPY draw/package*.json ./
RUN npm ci --ignore-scripts
COPY draw/ ./
COPY theme-tokens.json /theme-tokens.json
RUN npm run build && mkdir -p dist/excalidraw && cp -R node_modules/@excalidraw/excalidraw/dist/prod/fonts dist/excalidraw/
FROM node:22-alpine
WORKDIR /app
COPY package.json server.js catalog.js flow-engine.js cloud-object.js session.js http-client.js request-body.js search-access.js theme.js theme-tokens.json styles.css brand-banner.png ./
COPY brand-icons/ ./brand-icons/
COPY draw-store.js knowledge-export.js ./
COPY --from=draw-build /draw/dist/ ./draw-dist/
ENV PORT=3000 NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
