FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 SAVE_FILE=/data/fabrika.db STATIC_DIR=/app/client/dist
# Sunucu paketi tek dosyaya derlenir; çalışma zamanında yalnızca 'ws' gerekir
RUN echo '{"type":"module","private":true}' > package.json && npm install --omit=dev ws@^8.18.0 && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
VOLUME /data
EXPOSE 3000
CMD ["node", "--no-warnings=ExperimentalWarning", "server/dist/index.js"]
