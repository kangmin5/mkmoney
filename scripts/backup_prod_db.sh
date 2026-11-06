#!/usr/bin/env bash
# 운영 DB 즉시 백업(pg_dump custom 형식), 최근 14개만 유지. 파일 권한 600.
# 이 덤프는 암호화되지 않는다 — 서버 밖으로 옮길 때는 앱의 '암호화 백업'을 쓴다.
set -euo pipefail
cd "$(dirname "$0")/.."
KEEP=14
COMPOSE=(docker compose -f compose.yaml --env-file .env)
mkdir -p backups
chmod 700 backups
stamp=$(date +%Y%m%d-%H%M%S)
target="backups/mkmoney-${stamp}.dump"
umask 077
"${COMPOSE[@]}" exec -T db pg_dump -U mkmoney -d mkmoney -Fc > "${target}.part"
mv "${target}.part" "${target}"
echo "백업: ${target} ($(du -h "${target}" | cut -f1))"
ls -1t backups/mkmoney-*.dump | tail -n +$((KEEP + 1)) | xargs -r rm -f --
