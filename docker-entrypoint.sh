#!/bin/sh
set -e

DATA_DIR="${DATA_DIR:-/data}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  # 兼容群晖/威联通共享文件夹：尽力修正数据目录属主，失败也不阻断启动
  chown -R "$PUID:$PGID" "$DATA_DIR" 2>/dev/null || true
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
