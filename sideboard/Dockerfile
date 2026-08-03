ARG BUILD_FROM=ghcr.io/home-assistant/aarch64-base:3.21
FROM $BUILD_FROM

RUN apk add --no-cache nodejs icu-data-full

# The base image's s6-overlay scrubs env before running CMD unless told not
# to — without this, SUPERVISOR_TOKEN never reaches the server process.
ENV S6_KEEP_ENV=1

WORKDIR /app
COPY server.js ./
COPY public ./public

CMD ["node", "/app/server.js"]
