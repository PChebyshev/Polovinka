#!/usr/bin/env bash
# Установка «Мы на %» на чистый Ubuntu-сервер (рассчитан на облачный сервер Timeweb Cloud).
# Запуск под root:
#   curl -fsSL https://raw.githubusercontent.com/PChebyshev/Polovinka/claude/plan-and-data-model/deploy/install.sh | bash
# Можно заранее задать переменные: DOMAIN, STATS_KEY, VAPID_EMAIL, BRANCH, APP_DIR.
set -euo pipefail

# Тело в фигурных скобках: при «curl | bash» скрипт читается целиком до запуска.
{
REPO_URL="${REPO_URL:-https://github.com/PChebyshev/Polovinka.git}"
BRANCH="${BRANCH:-claude/plan-and-data-model}"
APP_DIR="${APP_DIR:-/opt/polovinka}"

say()  { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# read из терминала, даже если скрипт пришёл через «curl | bash»
ask() {
  local prompt="$1" default="${2:-}" reply=""
  if [ -r /dev/tty ]; then
    read -r -p "$prompt" reply < /dev/tty || true
  fi
  printf '%s' "${reply:-$default}"
}

[ "$(id -u)" -eq 0 ] || fail "Запустите от root (в консоли Timeweb вы и так root)."
command -v apt-get >/dev/null || fail "Нужен Ubuntu или Debian."

# --- 1. Swap, если памяти меньше 2 ГБ: иначе сборка клиента может не влезть --------
mem_mb=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$mem_mb" -lt 1900 ] && ! swapon --show | grep -q .; then
  say "Памяти ${mem_mb} МБ, добавляю swap 2 ГБ для сборки"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "swap включён"
fi

# --- 2. Docker из репозитория Ubuntu (доступен из России без VPN) --------------------
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  say "Ставлю Docker"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -q
  if ! apt-get install -y -q docker.io docker-compose-v2 docker-buildx git curl ca-certificates; then
    say "Пакетов Ubuntu не хватило, пробую официальный установщик Docker"
    apt-get install -y -q git curl ca-certificates
    curl -fsSL https://get.docker.com | sh
  fi
fi
command -v git >/dev/null || apt-get install -y -q git
docker compose version >/dev/null 2>&1 || fail "docker compose не установился. Пришлите вывод выше."
ok "$(docker --version)"

# --- 3. Зеркала Docker Hub: из российских IP он иногда недоступен -------------------
say "Настраиваю зеркала Docker Hub"
mkdir -p /etc/docker
if [ ! -s /etc/docker/daemon.json ] || ! grep -q registry-mirrors /etc/docker/daemon.json; then
  cat > /etc/docker/daemon.json <<'JSON'
{
  "registry-mirrors": ["https://dockerhub.timeweb.cloud", "https://mirror.gcr.io"],
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
JSON
  systemctl restart docker
fi
systemctl enable --now docker >/dev/null 2>&1 || true
ok "зеркала: dockerhub.timeweb.cloud, mirror.gcr.io"

# --- 4. Код ------------------------------------------------------------------------
say "Скачиваю код в ${APP_DIR}"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q "$BRANCH"
  git -C "$APP_DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
ok "ветка ${BRANCH}, коммит $(git rev-parse --short HEAD)"

# --- 5. Настройки (.env) ------------------------------------------------------------
ip=$(curl -fsS4 --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
if [ -f .env ] && [ -z "${DOMAIN:-}" ]; then
  say "Найден .env, оставляю настройки как есть"
  # shellcheck disable=SC1091
  . ./.env
else
  say "Настройки"
  echo "IP этого сервера: ${ip}"
  echo "Домен должен указывать на этот IP (A-запись)."
  echo "Если домена пока нет, нажмите Enter: возьму бесплатный ${ip//./-}.sslip.io для проверки."
  DOMAIN="${DOMAIN:-$(ask 'Домен (например, mynaprocent.ru): ' "${ip//./-}.sslip.io")}"
  VAPID_EMAIL="${VAPID_EMAIL:-$(ask 'Ваша почта (нужна push-сервисам, никуда не публикуется): ' 'admin@example.com')}"
  STATS_KEY="${STATS_KEY:-$(head -c 18 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 20)}"
  DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"
  umask 077
  cat > .env <<ENV
DOMAIN=${DOMAIN}
STATS_KEY=${STATS_KEY}
VAPID_EMAIL=${VAPID_EMAIL}
ENV
  ok ".env записан"
fi

# Предупредить, если домен смотрит не сюда (Caddy тогда не получит сертификат)
resolved=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
if [ -n "$ip" ] && [ "$resolved" != "$ip" ]; then
  printf '\033[1;33m! %s сейчас указывает на %s, а сервер %s.\n  Если только что меняли DNS, подождите 10–30 минут: сайт заработает сам, перезапускать ничего не нужно.\033[0m\n' "$DOMAIN" "${resolved:-никуда}" "$ip"
fi

# --- 6. Сборка и запуск -------------------------------------------------------------
say "Собираю и запускаю (первый раз 3–8 минут)"
docker compose up -d --build

say "Жду, пока приложение ответит"
for _ in $(seq 1 60); do
  if docker compose exec -T app node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; then
    ok "приложение работает"
    break
  fi
  sleep 3
done

cat <<DONE

$(printf '\033[1;32m')Готово.$(printf '\033[0m')
  Сайт:        https://${DOMAIN}
  Статистика:  https://${DOMAIN}/stats   ключ: ${STATS_KEY}
  Папка:       ${APP_DIR}

Если сайт не открывается сразу, сертификат ещё выпускается (до пары минут).
Логи:        cd ${APP_DIR} && docker compose logs -f
Обновить:    bash ${APP_DIR}/deploy/install.sh
DONE
exit 0
}
