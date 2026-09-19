FROM node:22-alpine
WORKDIR /app
COPY package.json server.js catalog.js flow-engine.js brand-banner.png ./
COPY brand-icons/ ./brand-icons/
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
