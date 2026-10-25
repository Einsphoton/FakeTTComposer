# TT作曲家 Web 版
FROM node:20-alpine

# tzdata 用于正确显示保存时间；su-exec 用于 PUID/PGID 降权
RUN apk add --no-cache tzdata su-exec

ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    DATA_DIR=/data \
    TZ=Asia/Shanghai \
    PUID=1000 \
    PGID=1000

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY public ./public
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data \
 && chown -R node:node /app /data

EXPOSE 8080
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "server.js"]
