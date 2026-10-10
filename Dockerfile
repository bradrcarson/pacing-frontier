FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# Files stay owned by root and read-only to the app; the server only reads them.
COPY package.json server.js ./
COPY site ./site

# The official image ships an unprivileged "node" user.
USER node

# Railway sets PORT at runtime; server.js falls back to 8080.
EXPOSE 8080

CMD ["node", "server.js"]
