ARG BUILD_FROM=ghcr.io/home-assistant/aarch64-base:3.21
FROM $BUILD_FROM

RUN apk add --no-cache nodejs icu-data-full

WORKDIR /app
COPY server.js ./
COPY public ./public

CMD ["node", "/app/server.js"]
