#!/usr/bin/env bash
# 운영 배포: 설정 검증 → (DB 실행 중이면) 백업 → 재빌드·기동 → 헬스·버전 확인.
# 사설 LAN IP에만 바인드하며 공유기 포트포워딩·터널은 사용하지 않는다.
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE=(docker compose -f compose.yaml --env-file .env)

[[ -f .env ]] || { echo ".env가 없습니다. .env.example을 복사해 값을 채우세요."; exit 1; }
env_value() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]$//"; }
LAN_BIND_IP=$(env_value LAN_BIND_IP)
DOMAIN=$(env_value MKMONEY_DOMAIN)
if ! [[ ${LAN_BIND_IP} =~ ^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.) ]]; then
  echo "LAN_BIND_IP(${LAN_BIND_IP:-없음})는 사설 IP여야 합니다."; exit 1
fi
ip -4 -o addr show | grep -q " ${LAN_BIND_IP}/" || { echo "이 서버에 ${LAN_BIND_IP} 주소가 없습니다."; exit 1; }
"${COMPOSE[@]}" config --quiet

if [[ -n "$("${COMPOSE[@]}" ps -q --status running db 2>/dev/null)" ]]; then
  ./scripts/backup_prod_db.sh
fi

"${COMPOSE[@]}" up -d --build --remove-orphans

echo "헬스 확인 중…"
for _ in $(seq 1 60); do
  app_id=$("${COMPOSE[@]}" ps -q app)
  status=$(docker inspect -f '{{.State.Health.Status}}' "${app_id}" 2>/dev/null || echo starting)
  [[ ${status} == healthy ]] && break
  sleep 2
done
[[ ${status} == healthy ]] || { echo "앱이 정상 상태가 되지 않았습니다: ${status}"; "${COMPOSE[@]}" ps; exit 1; }

# 프록시 경유 HTTPS 확인(Caddy 로컬 CA로 검증)
ca=$(mktemp)
trap 'rm -f "${ca}"' EXIT
for _ in $(seq 1 30); do
  "${COMPOSE[@]}" exec -T proxy cat /data/caddy/pki/authorities/local/root.crt > "${ca}" 2>/dev/null && [[ -s ${ca} ]] && break
  sleep 1
done
health=$(curl -sf --cacert "${ca}" --resolve "${DOMAIN}:443:${LAN_BIND_IP}" "https://${DOMAIN}/api/health")
expected=$(grep -oP '__version__ = "\K[0-9.]+' backend/app/__init__.py)
echo "헬스: ${health}"
[[ ${health} == *"\"version\":\"${expected}\""* ]] || { echo "배포 버전이 ${expected}와 다릅니다."; exit 1; }
echo "배포 완료: https://${DOMAIN} (v${expected})"
