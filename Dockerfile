FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
# Persist the built graph across restarts/redeploys if this path is mounted
# as a Dokploy volume; otherwise it just gets rebuilt on the next cron tick.
VOLUME ["/app/data"]
EXPOSE 4000
CMD ["node", "dist/index.js"]
