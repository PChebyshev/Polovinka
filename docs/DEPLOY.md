# Деплой на Timeweb Cloud

Нужен именно VPS («Облачный сервер»), а не виртуальный хостинг: приложение — это
процесс Node.js с SQLite на диске, его удобнее всего запускать в Docker.

## 1. Сервер

1. В панели [timeweb.cloud](https://timeweb.cloud) → «Облачные серверы» → «Создать».
2. ОС: Ubuntu 24.04. Если в списке образов есть готовый «Docker», берите его — тогда шаг 3 короче.
3. Конфигурация: минимум 1 CPU и 2 ГБ памяти. На 1 ГБ сборка Vite и TypeScript
   может упасть по памяти; тогда соберите образ на ноутбуке (см. ниже).
4. Добавьте свой SSH-ключ при создании. Запишите IP сервера.

## 2. Домен

1. Купите или привяжите домен в том же Timeweb («Домены и SSL») или у любого регистратора.
2. В DNS создайте A-запись: `@` → IP сервера (и при желании `www` → тот же IP).
3. Подождите, пока запись разойдётся (обычно 5–30 минут). Проверка: `ping ваш-домен.ru`.

Сертификат выпускать не нужно: Caddy из docker-compose сделает это сам по HTTP-01,
для этого порты 80 и 443 должны быть открыты. В Timeweb Cloud у нового сервера
сетевой экран не включён; если включали, разрешите TCP 22, 80, 443.

## 3. Docker на сервере

Если образ «Docker» не выбирали:

```bash
ssh root@IP
curl -fsSL https://get.docker.com | sh
docker compose version   # должен напечатать версию
```

## 4. Код и запуск

```bash
apt-get install -y git
git clone https://github.com/PChebyshev/Polovinka.git /opt/polovinka
cd /opt/polovinka
git checkout claude/plan-and-data-model   # или master после слияния
cp .env.example .env
nano .env                                  # DOMAIN, STATS_KEY, VAPID_EMAIL
docker compose up -d --build
```

Если репозиторий приватный, GitHub попросит логин и токен (Settings → Developer
settings → Personal access tokens, права `repo`). Либо сделайте репозиторий
публичным на время деплоя.

Через минуту откройте `https://ваш-домен.ru`. Проверка состояния:

```bash
docker compose ps
docker compose logs -f app      # логи приложения
docker compose logs -f caddy    # выпуск сертификата
curl -s https://ваш-домен.ru/api/health
```

## 5. Что где лежит

- База SQLite, VAPID-ключи и картинки карточек недели — в томе `app-data`
  (`docker volume inspect polovinka_app-data` покажет путь на диске).
- Сертификаты Caddy — в томе `caddy-data`.

Бэкап базы одной командой:

```bash
docker run --rm -v polovinka_app-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/polovinka-$(date +%F).tgz -C /data .
```

## 6. Обновление

```bash
cd /opt/polovinka
git pull
docker compose up -d --build
```

Данные в томах сохраняются. Старые образы можно подчистить: `docker image prune -f`.

## Если памяти мало: сборка на ноутбуке

```bash
# на ноутбуке с Docker
docker build -t polovinka:latest .
docker save polovinka:latest | gzip > polovinka.tgz
scp polovinka.tgz root@IP:/opt/polovinka/
# на сервере
cd /opt/polovinka && docker load < polovinka.tgz
```

И в `docker-compose.yml` у сервиса `app` замените `build: .` на `image: polovinka:latest`.

## Проверка после деплоя

1. Открыть сайт с двух телефонов, пройти приглашение и вопрос дня.
2. Настройки → «Уведомления» → «Включить», выставить время на ближайшую минуту, закрыть
   приложение и дождаться push. На iPhone сначала «Добавить на экран „Домой“».
3. `https://ваш-домен.ru/stats` с ключом из `.env`.

## Переменные окружения

| Переменная | Назначение |
|---|---|
| `DOMAIN` | домен для Caddy и ссылок приглашений |
| `STATS_KEY` | ключ страницы `/stats` |
| `VAPID_EMAIL` | контакт для push-сервисов |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | задайте, если переносите сервер и хотите сохранить подписки; иначе читаются из `/data/vapid.json` |
