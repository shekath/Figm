# Figmy server: web app + real-time collaboration + MCP connector in one container.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/server-dist ./server-dist
VOLUME /data
EXPOSE 4317
# Set FIGMY_TOKEN to require "Authorization: Bearer <token>" for the API, MCP and collaboration.
ENV PORT=4317
CMD ["sh", "-c", "exec node server-dist/server.cjs --host 0.0.0.0 --port ${PORT} --static dist --data ${FIGMY_DATA:-/data}"]
