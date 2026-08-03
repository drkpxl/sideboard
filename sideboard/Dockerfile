ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:latest
FROM $BUILD_FROM

RUN apk add --no-cache nodejs icu-data-full

WORKDIR /app
COPY server.js ./
COPY public ./public

CMD ["node", "/app/server.js"]
