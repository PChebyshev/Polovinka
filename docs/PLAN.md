# «Половинка» (рабочее название «Мы на %») — план и модель данных

## 1. Архитектура

```
polovinka/
  package.json          # workspaces: server, web, shared
  shared/               # типы API и банк вопросов (questions.json)
  server/               # Fastify + better-sqlite3, раздаёт /api и web/dist
  web/                  # React + Vite + TS + Tailwind, PWA
  Dockerfile            # multi-stage, один процесс, том /data для SQLite
  docker-compose.yml    # app + Caddy (авто-TLS) для VPS
```

- **Один процесс** Node: Fastify отдаёт `/api/*`, статику SPA, OG-страницы для ссылок
  (`/j/:code`, `/c/:code`, `/w/:code`) и web-push из того же процесса (библиотека `web-push`, свои VAPID-ключи).
- **Аккаунт** = случайный токен (32 байта) в `localStorage`, на сервере хранится его SHA-256.
  Заголовок `Authorization: Bearer <token>`.
- **Реальное время** внутри приложения: SSE `/api/events` (ответил партнёр, раскрытие, жест).
  Фолбэк — опрос раз в 20 с. Push только дополняет.
- **Время дня** считается в часовом поясе пары (берём с телефона первого, кто создал пару).
  «День» = дата в этом поясе; вопрос дня появляется в 00:00, раскрытие — как только ответили оба.
- **Офлайн**: SW кэширует оболочку; ответы и жесты пишутся в очередь IndexedDB с `client_id`
  (идемпотентность) и уходят при появлении сети (Background Sync + повтор при старте).
- **Без внешних зависимостей в рантайме**: системные шрифты, инлайн-SVG иконки, никаких CDN.

Честная оговорка про push: наш сервер ни к чему гугловскому не обращается, но сам браузер
доставляет push через свой сервис: Chrome/Android — через FCM (Google), Firefox — через Mozilla,
iOS — через Apple (только для установленного на экран PWA, iOS 16.4+). Из России FCM работает
нестабильно, поэтому push — «если дойдёт», а основная доставка — SSE в открытом приложении
и ручное «Позвать» через мессенджер.

## 2. Словарь

- **Раунд** — один вопрос, заданный паре на дату (daily / bonus / challenge).
- **Открытие** — раунд, в котором ответили оба (раскрыт). Счётчик пары только растёт.
- **Знаем друг друга на N%** — единственная оценка пары: угаданные выборы партнёра /
  все догадки (на шкале — с точностью до одного деления). Одинаковые ответы
  в процент не входят и показываются только как деталь («и выбрали одно»).
- Из «не угадали» растёт персонализация: категории с большим числом промахов =
  больше нового = выше вес.
- **Дней вместе в игре** — число дат, когда хотя бы один из пары ответил. Не сгорает.

## 3. Модель данных (SQLite, WAL)

```sql
users
  id TEXT PK, name TEXT, token_hash TEXT UNIQUE, pair_id TEXT NULL,
  tz TEXT, invite_code TEXT UNIQUE,
  notif_morning TEXT DEFAULT '09:00', notif_evening TEXT DEFAULT '20:00',
  notif_enabled INT DEFAULT 1, last_seen_at, created_at

pairs
  id TEXT PK, tz TEXT, is_guest INT DEFAULT 0,        -- гостевая пара из вызова
  week_theme TEXT NULL,                               -- «тема недели» (этап 2)
  created_at, deleted_at NULL

questions                                             -- встроенные сидятся из shared/questions.json
  id TEXT PK, pair_id TEXT NULL,                      -- pair_id = свой вопрос пары
  author_id TEXT NULL, layer TEXT ('light'|'us'|'deep'), category TEXT,
  format TEXT ('ab'|'scale'|'who'|'from_partner'),
  text TEXT,                                          -- шаблон с {me} {partner}
  a TEXT, b TEXT, why_chips TEXT (JSON), topic TEXT,  -- topic = тема на вечер
  is_active INT DEFAULT 1, created_at

question_marks                                        -- «плохой вопрос»
  pair_id, user_id, question_id, created_at, reasons, comment   PK(pair_id, user_id, question_id)

rounds
  id TEXT PK, pair_id, question_id, date TEXT (YYYY-MM-DD в tz пары),
  kind TEXT ('daily'|'bonus'|'challenge'), challenge_id TEXT NULL,
  status TEXT ('open'|'revealed'), revealed_at NULL, created_at
  UNIQUE(pair_id, date, kind, question_id)

answers
  id TEXT PK, round_id, user_id, client_id TEXT UNIQUE,  -- идемпотентность офлайн-очереди
  choice TEXT, guess TEXT NULL,                          -- 'a'|'b' или число для шкалы
  why_text TEXT NULL, why_chip TEXT NULL, created_at
  UNIQUE(round_id, user_id)

gestures
  id TEXT PK, pair_id, from_user_id, to_user_id,
  type TEXT ('thanks'|'thinking'|'proud'), text TEXT, created_at, seen_at NULL

gesture_templates                                     -- свои шаблоны жестов (этап 2)
  id, pair_id, type, text, created_at

favorites                                             -- любимые моменты в ленте
  pair_id, user_id, kind ('round'|'gesture'), ref_id, created_at  PK(pair_id,user_id,kind,ref_id)

milestones
  pair_id, key TEXT ('d10'|'d50'|'d100'|...), reached_at,
  seen_by TEXT (JSON список user_id)                  PK(pair_id, key)

push_subscriptions
  id, user_id, endpoint TEXT UNIQUE, p256dh, auth, created_at, failed_at NULL

notification_log                                      -- лимиты: 2/день, «позвать» 1/день
  user_id, date, kind ('morning'|'evening'|'nudge'), created_at
  PK(user_id, date, kind)

challenges
  id TEXT PK, code TEXT UNIQUE, from_pair_id, question_ids TEXT (JSON, 5 шт.),
  created_at, opened_count INT DEFAULT 0

challenge_pairs                                       -- пары, принявшие вызов
  challenge_id, pair_id, created_at                   PK(challenge_id, pair_id)

weekly_cards
  id, code TEXT UNIQUE, pair_id, week_start TEXT, stats TEXT (JSON),
  png_path TEXT NULL, created_at                      -- PNG рисует клиент, сервер хранит для OG

events                                                -- аналитика, только факты без текстов ответов
  id INTEGER PK, pair_id NULL, user_id NULL, type TEXT, meta TEXT (JSON), created_at
  -- типы: user_created, invite_sent, invite_opened, invite_accepted,
  --       challenge_sent, challenge_opened, challenge_pair_created, challenge_converted,
  --       answer, reveal, why_added, topic_opened, gesture_sent, push_subscribed,
  --       weekly_shared, install_prompt_shown, install_accepted
```

Приватность: все выборки идут через `pair_id` текущего пользователя. «Удалить нашу историю»
удаляет rounds/answers/gestures/favorites/milestones/weekly_cards пары и сами questions с pair_id,
а строки events оставляет (там нет текстов, только типы и даты). Пара при этом остаётся.

## 4. Алгоритм вопроса дня

1. Кандидаты: активные встроенные + свои вопросы пары, минус уже заданные паре, минус «не про нас»
   от любого из партнёров.
2. Свои вопросы пары идут вне очереди в ближайший день.
3. Слой: 60/25/15. Ограничения: `deep` не чаще 2 за последние 7 дней и не в понедельник утром;
   первые 3 дня пары — только `light`/`us`.
4. Категория внутри слоя: вес = 1 + (доля «не угадали» в категории) × 2, минус 0.5 за каждую
   отметку «плохой вопрос» в категории. Тему выключают три отметки с причиной про тему
   («не про нашу жизнь», «слишком личный», «может задеть»); «не подходит вариант», «скучный»,
   «непонятный», «уже был похожий» убирают только сам вопрос и видны в /stats → «Плохие вопросы».
5. Формат-сюрприз (`scale` / `who` / `from_partner`) ≈ раз в 8–12 дней, не раньше 5-го дня.
6. Генерация детерминирована (seed = pair_id + date), чтобы оба телефона увидели один вопрос
   без гонок; строка rounds создаётся при первом запросе дня (INSERT OR IGNORE).
7. Бонус: до 3 в день, кнопка «Ещё один?» после раскрытия, слои только `light`/`us`.

## 5. Экраны (всё на русском, mobile-first, тёмная тёплая тема)

- `/` — машина состояний: имя → «Позвать половинку» → вопрос дня (2 тапа) → ожидание →
  раскрытие с анимацией → «Почему?» → «Тема на вечер» → «На сегодня всё» + бонус.
- `/together` — «Вместе»: планы с датами, «Хотим вместе», «Сделали вместе» и тёплый жест (типы, чипы, поле «дописать», отправка в 1–2 тапа). Старые адреса `/gesture` и `/ideas` ведут сюда.
- `/history` — лента «Наша история»: раунды, «почему», жесты, сердечко «любимый момент»;
  шапка: открытия, уровень, дней вместе, следующая веха.
- `/settings` — время уведомлений, свои вопросы, свои шаблоны жестов, тема недели,
  «Добавить на экран», «Удалить нашу историю», «Выйти с этого телефона».
- `/week` — воскресный итог: canvas → PNG, «Поделиться».
- `/j/:code` — приглашение партнёра; `/c/:code` — вызов паре; `/w/:code` — публичная карточка недели.
- `/stats` — воронка, K-фактор, три метрики близости (доля дней с ответами обоих,
  доля раскрытий с «почему», жестов на пару в неделю). Защищена `STATS_KEY` из env.

Уровни пары: по открытиям — 1 (0), 2 (5), 3 (10), 4 (25), 5 (50), 6 (100), 7 (200), 8 (365).
Вехи с церемонией: 10, 50, 100, 365 открытий и 7 / 30 / 100 дней вместе в игре.

## 6. API (кратко)

```
POST /api/users                      {name, tz}           → {token, user}
GET  /api/me                                              → {user, pair, partner, today, counters}
POST /api/pair/join                  {code, name?}        → пара создана
GET  /api/today                                           → раунд дня + мои ответы + статус партнёра
POST /api/rounds/:id/answer          {client_id, choice, guess}
POST /api/rounds/:id/why             {why_text|why_chip}
POST /api/rounds/bonus                                    → новый бонусный раунд
POST /api/questions/:id/mark         «плохой вопрос» {reasons[], comment?}
POST /api/nudge                                           → «позвать» (1/день), текст для share
POST /api/gestures                   {client_id, type, text}
GET  /api/history?cursor=
POST /api/favorites/toggle
GET  /api/events  (SSE)
POST /api/questions                  свой вопрос
GET  /api/week/current   POST /api/week/:code/image (PNG)
POST /api/challenges     GET /api/challenges/:code   POST /api/challenges/:code/join
POST /api/push/subscribe DELETE /api/push/subscribe   PUT /api/settings
DELETE /api/pair/history
GET  /api/stats?key=
```

## 7. Этапы

1. Основной цикл: шаги 1–7, SSE, 250+ вопросов, локальный запуск (`npm run dev`), Dockerfile.
2. Лента «Наша история», избранное, уровни и вехи с церемонией, свои вопросы, свои шаблоны
   жестов, тема недели, «не про нас», бонусные вопросы, форматы-сюрпризы.
3. Воскресный итог (canvas → PNG, share, `/w/:code` с OG), вызов паре (`/c/:code`, гостевая пара,
   сравнение двух пар, конвертация в постоянную), OG-превью всех ссылок.
4. Web push (VAPID, расписание утро/вечер, лимиты), офлайн-очередь, подсказка «Добавить на экран»,
   события аналитики и `/stats`.

## 8. Как проверять с двух телефонов

- Этапы 1–3: `npm run dev -- --host`, телефоны в одном Wi-Fi открывают `http://<ip-ноутбука>:5173`.
  По http Web Share недоступен — сработает фолбэк «Скопировать ссылку», это ожидаемо.
- Этап 4 (SW, push, «на экран») требует HTTPS: поднимаем на VPS через `docker compose up`
  (Caddy выдаст сертификат по домену). Это же — боевой вариант.
