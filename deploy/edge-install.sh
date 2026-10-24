#!/bin/bash
# Зарубежный вход Половинки (прокси для людей с VPN). Запуск на чистом сервере с Ubuntu/Debian:
#   curl -fsSL https://raw.githubusercontent.com/PChebyshev/Polovinka/claude/plan-and-data-model/deploy/edge-install.sh | EDGE_DOMAIN=go.polovinka.online bash
# Повторный запуск обновляет конфиг. ORIGIN (основной сервер) по умолчанию polovinka.online.
set -euo pipefail

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$1"; }
ok() { printf '\033[1;32m✓ %s\033[0m\n' "$1"; }
fail() { printf '\033[1;31m✗ %s\033[0m\n' "$1"; exit 1; }

[ "$(id -u)" = 0 ] || fail "Запустите от root (или через sudo)."
EDGE_DOMAIN="${EDGE_DOMAIN:-}"
if [ -z "$EDGE_DOMAIN" ]; then
  printf 'Домен входа (например, go.polovinka.online): '
  read -r EDGE_DOMAIN < /dev/tty
fi
EDGE_DOMAIN="${EDGE_DOMAIN#https://}"; EDGE_DOMAIN="${EDGE_DOMAIN%%/*}"
ORIGIN="${ORIGIN:-polovinka.online}"
RAW="https://raw.githubusercontent.com/PChebyshev/Polovinka/${BRANCH:-claude/plan-and-data-model}/deploy/edge"
DIR="${EDGE_DIR:-/opt/polovinka-edge}"

say "Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi
docker compose version >/dev/null 2>&1 || fail "docker compose не установился"
ok "docker есть"

say "Файлы входа → $DIR"
mkdir -p "$DIR" && cd "$DIR"
curl -fsSL "$RAW/Caddyfile" -o Caddyfile
curl -fsSL "$RAW/docker-compose.yml" -o docker-compose.yml
printf 'EDGE_DOMAIN=%s\nORIGIN=%s\n' "$EDGE_DOMAIN" "$ORIGIN" > .env
ok "конфиг записан: $EDGE_DOMAIN → $ORIGIN"

ip=$(curl -fsS4 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')
resolved=$(getent ahostsv4 "$EDGE_DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
if [ -n "$ip" ] && [ "$resolved" != "$ip" ]; then
  printf '\033[1;33m! %s сейчас указывает на %s, а этот сервер %s.\n  Добавьте A-запись %s → %s там, где управляете DNS домена. Сертификат выпустится сам, когда запись разойдётся.\033[0m\n' "$EDGE_DOMAIN" "${resolved:-никуда}" "$ip" "$EDGE_DOMAIN" "$ip"
fi

say "Запуск"
docker compose up -d
sleep 3
if curl -fsS -m 10 -H "Host: $EDGE_DOMAIN" "http://127.0.0.1/api/health" >/dev/null 2>&1; then ok "вход отвечает"; else echo "(Caddy поднимается; если через минуту https://$EDGE_DOMAIN/api/health не откроется — docker compose logs caddy)"; fi

cat <<DONE

$(printf '\033[1;32m')Готово.$(printf '\033[0m')
  Вход:        https://${EDGE_DOMAIN}  →  https://${ORIGIN}
  Проверка:    https://${EDGE_DOMAIN}/api/health
  Логи:        cd ${DIR} && docker compose logs -f caddy

На основном сервере в /opt/polovinka/.env должно быть EDGE_HOSTS=${EDGE_DOMAIN}
(затем bash /opt/polovinka/deploy/install.sh) — иначе ссылки-приглашения у людей
с этого входа будут вести на ${ORIGIN}.
DONE
