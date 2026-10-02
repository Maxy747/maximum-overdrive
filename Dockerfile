# Build the app and the bundled server, then run it on a slim image with nothing else in it.
FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
# The server is one bundled file plus the built app; it needs no node_modules at run time.
COPY --from=build /src/selfhost-dist/ ./
RUN mkdir -p /data && chown node:node /data
ENV NODE_ENV=production MAX_DATA_DIR=/data MAX_HOST=0.0.0.0 PORT=4317
USER node
EXPOSE 4317
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["node","-e","fetch('http://127.0.0.1:'+(process.env.PORT||4317)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node","server.mjs"]
