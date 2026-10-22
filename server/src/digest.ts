import type { FastifyInstance } from 'fastify';
import type { DigestDay, DigestMoment, DigestResponse, DigestStory, WeekDigest } from '../../shared/src/types.js';
import { CATEGORY_LABELS, GESTURE_LABELS } from '../../shared/src/types.js';
import { STAGES } from '../../shared/src/progress.js';
import { renderText } from '../../shared/src/text.js';
import { all, one, run, logEvent, type AnswerRow, type PairRow, type QuestionRow, type RoundRow, type UserRow } from './db.js';
import { nowIso } from './ids.js';
import { requireUser } from './auth.js';
import { addDays, dateInTz, weekdayInTz } from './time.js';
import { aiEnabled, aiJson, TONE } from './ai.js';
import { answerLabel, guessed, PARTNER_LABEL, sameChoice } from './ideas.js';
import { curatedIdeas } from './ideasContent.js';

/**
 * «Ваша неделя»: раз в неделю, в понедельник — итоги прошлой недели пары.
 * Цифры и моменты считаются из ответов; текст пишет ИИ (или шаблон, если ИИ выключен).
 * В ИИ уходят ответы и метки {A}/{B} вместо имён; имена подставляем сами.
 * Вопросы из «Близости» в итоги не попадают.
 */

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const LAYER_RANK: Record<string, number> = { deep: 3, us: 2, light: 1 };

const dayMonth = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** Понедельник недели, в которую попадает дата. */
function mondayOf(tz: string): string {
  const today = dateInTz(tz);
  return addDays(today, -((weekdayInTz(tz) + 6) % 7));
}

/** Начало недели offset недель назад (1 — прошлая). */
export function digestWeekStart(tz: string, offset: number): string {
  return addDays(mondayOf(tz), -7 * offset);
}

interface RoundFacts {
  round: RoundRow;
  q: QuestionRow;
  answers: [AnswerRow, AnswerRow];
  same: boolean;
  guessed: [boolean, boolean];
}

function members(pairId: string): UserRow[] {
  return all<UserRow>('SELECT * FROM users WHERE pair_id = ? ORDER BY created_at', pairId);
}

/** С какого дня пара вдвоём: второй присоединился или (для перенесённой истории) первый общий ответ. */
function pairSince(pairId: string, users: UserRow[]): string | null {
  if (users.length < 2) return null;
  const first = one<{ d: string | null }>(
    `SELECT MIN(r.date) AS d FROM rounds r WHERE r.pair_id = ? AND (SELECT COUNT(*) FROM answers a WHERE a.round_id = r.id) >= 2`,
    pairId,
  )?.d;
  const joined = users[1].created_at.slice(0, 10);
  return first && first < joined ? first : joined;
}

/** Ответ для людей: вариант, «4 из 5» или имя того, кого назвали. */
function shownAnswer(q: QuestionRow, a: AnswerRow, me: string, them: string, users: UserRow[]): string {
  if (q.format === 'scale') return `${a.choice} из 5`;
  if (q.format === 'who') return users.find((u) => u.id === a.choice)?.name ?? '—';
  return renderText(a.choice === 'a' ? q.a : q.b, me, them);
}

function momentOf(f: RoundFacts, users: UserRow[]): DigestMoment {
  const [x, y] = users;
  return {
    question: renderText(f.q.text, x.name, y.name),
    answers: [shownAnswer(f.q, f.answers[0], x.name, y.name, users), shownAnswer(f.q, f.answers[1], y.name, x.name, users)],
    same: f.same,
    guessed: f.guessed,
  };
}

/** Факты недели: дни, раскрытые вопросы, жесты, идеи. */
function collect(pair: PairRow, users: UserRow[], start: string, end: string) {
  const [x, y] = users;
  const rounds = all<RoundRow>(
    `SELECT * FROM rounds WHERE pair_id = ? AND kind != 'challenge' AND status = 'revealed' AND date BETWEEN ? AND ? ORDER BY date, created_at`,
    pair.id,
    start,
    end,
  );
  const facts: RoundFacts[] = [];
  for (const round of rounds) {
    const q = one<QuestionRow>('SELECT * FROM questions WHERE id = ?', round.question_id);
    if (!q || q.category === 'intimacy') continue;
    const ax = one<AnswerRow>('SELECT * FROM answers WHERE round_id = ? AND user_id = ?', round.id, x.id);
    const ay = one<AnswerRow>('SELECT * FROM answers WHERE round_id = ? AND user_id = ?', round.id, y.id);
    if (!ax || !ay) continue;
    facts.push({ round, q, answers: [ax, ay], same: sameChoice(q, ax, ay), guessed: [guessed(q, ax, ay), guessed(q, ay, ax)] });
  }

  const days: DigestDay[] = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const daily = one<RoundRow>(`SELECT * FROM rounds WHERE pair_id = ? AND kind = 'daily' AND date = ?`, pair.id, date);
    const n = daily ? Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM answers WHERE round_id = ?', daily.id)?.n ?? 0) : 0;
    const f = daily ? facts.find((r) => r.round.id === daily.id) : undefined;
    days.push({ date, state: n >= 2 ? 'both' : n === 1 ? 'one' : 'none', match: !!f?.same });
  }

  const gestures = all<{ type: string }>(`SELECT type FROM gestures WHERE pair_id = ? AND substr(created_at, 1, 10) BETWEEN ? AND ?`, pair.id, start, end);
  const ideasAdded = Number(
    one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ideas WHERE pair_id = ? AND removed_at IS NULL AND substr(created_at, 1, 10) BETWEEN ? AND ?`,
      pair.id,
      start,
      end,
    )?.n ?? 0,
  );
  const ideasDone = all<{ text: string }>(
    `SELECT text FROM ideas WHERE pair_id = ? AND removed_at IS NULL AND substr(done_at, 1, 10) BETWEEN ? AND ? ORDER BY done_at`,
    pair.id,
    start,
    end,
  ).map((r) => r.text);

  const topicCount = new Map<string, number>();
  for (const f of facts) topicCount.set(f.q.category, (topicCount.get(f.q.category) ?? 0) + 1);
  const topics = [...topicCount.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);

  const guessesRight = facts.reduce((s, f) => s + Number(f.guessed[0]) + Number(f.guessed[1]), 0);
  const rank = (f: RoundFacts) => LAYER_RANK[f.q.layer] ?? 0;
  // Совпадение недели: выбрали одно и то же, лучше — оба угадали и вопрос поглубже
  const matchF = facts
    .filter((f) => f.same)
    .sort((a, b) => Number(b.guessed[0] && b.guessed[1]) - Number(a.guessed[0] && a.guessed[1]) || rank(b) - rank(a))[0];
  // Второй момент — самый неожиданный из остальных: меньше угаданного, разный выбор, вопрос поглубже
  const misses = (f: RoundFacts) => Number(!f.guessed[0]) + Number(!f.guessed[1]);
  const surpriseF = facts.filter((f) => f !== matchF).sort((a, b) => misses(b) - misses(a) || Number(!b.same) - Number(!a.same) || rank(b) - rank(a))[0];

  return { facts, days, gestures, ideasAdded, ideasDone, topics, guessesRight, matchF, surpriseF };
}

type Collected = ReturnType<typeof collect>;

// --- Текст от ИИ ---------------------------------------------------------------

const STORY_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    story: { type: 'string' },
    discoveries: { type: 'array', items: { type: 'string' } },
    insight: { type: 'string' },
    tips: { type: 'array', items: { type: 'string' } },
    question: { type: 'string' },
  },
  required: ['title', 'story', 'discoveries', 'insight', 'tips', 'question'],
  additionalProperties: false,
};

const A = '{A}';
const B = '{B}';

function prompt(pair: PairRow, start: string, end: string, c: Collected, prevTitle: string | null): string {
  const stage = STAGES.find((s) => s.key === pair.stage)?.label.toLowerCase();
  const bothDays = c.days.filter((d) => d.state === 'both').length;
  const lines = [
    `Неделя пары ${A} и ${B}: ${dayMonth(start)} — ${dayMonth(end)}.${stage ? ` Вместе: ${stage}.` : ''}${pair.has_kids ? ' Есть дети.' : ''}`,
    `Отвечали вдвоём ${bothDays} дн. из 7. Вопросов с раскрытием: ${c.facts.length}. Выбрали одно и то же: ${c.facts.filter((f) => f.same).length}. Угадали ответ друг друга: ${c.guessesRight} из ${c.facts.length * 2}.`,
    c.gestures.length
      ? `Тёплые жесты друг другу: ${c.gestures.map((g) => `«${GESTURE_LABELS[g.type as keyof typeof GESTURE_LABELS] ?? g.type}»`).join(', ')}.`
      : 'Тёплых жестов на этой неделе не было.',
    c.ideasDone.length ? `Сделали вместе из списка «Хотим вместе»: ${c.ideasDone.map((t) => `«${t}»`).join(', ')}.` : '',
    c.ideasAdded ? `Добавили новых идей в «Хотим вместе»: ${c.ideasAdded}.` : '',
    '',
    'Ответы недели:',
    ...c.facts.map((f, i) => {
      const [ax, ay] = f.answers;
      const why = (a: AnswerRow) => (a.why_text || a.why_chip ? ` (почему: «${(a.why_text || a.why_chip)!.slice(0, 160)}»)` : '');
      const options =
        f.q.format === 'ab'
          ? ` — «${renderText(f.q.a, A, B)}» или «${renderText(f.q.b, A, B)}»`
          : f.q.format === 'scale'
            ? ` — шкала от «${f.q.a}» (1) до «${f.q.b}» (5)`
            : '';
      return [
        `${i + 1}. ${WEEKDAYS[Math.round((Date.parse(f.round.date) - Date.parse(start)) / 864e5)] ?? ''}, тема «${CATEGORY_LABELS[f.q.category] ?? f.q.category}». «${renderText(f.q.text, A, B)}»${options}.`,
        `   ${A}: ${answerLabel(f.q, ax, A, B)}${why(ax)}; угадывая ${B}, ${f.guessed[0] ? 'попал(а)' : 'не угадал(а)'}.`,
        `   ${B}: ${answerLabel(f.q, ay, B, A)}${why(ay)}; угадывая ${A}, ${f.guessed[1] ? 'попал(а)' : 'не угадал(а)'}.`,
      ].join('\n');
    }),
    '',
    prevTitle ? `Заголовок прошлой недели был «${prevTitle}» — не повторяйся.` : '',
    '',
    `Напиши итоги этой недели. Их читают оба: к паре — на «вы», о каждом — меткой ${A} или ${B} (метки оставь как есть, имена подставим мы).`,
    `Метки ${A} и ${B} — только в именительном падеже, имена мы не склоняем: пиши «${A} выбирает…», «${A}: «…»», «${A} и ${B} оба…». Нельзя: «у ${A}», «для ${B}», «${A}у».`,
    `Пол неизвестен: не пиши «${A} выбрал» — пиши в настоящем времени («${A} выбирает») или «выбрал(а)».`,
    'Главное — чтобы было интересно читать: конкретика из их ответов, варианты цитируй в «ёлочках», лёгкий юмор, тепло. Без общих фраз вроде «вы отличная пара».',
    'Цифры не пересказывай — они будут на графиках. Не сравнивай, кто угадал больше: это не соревнование. Не упрекай за пропущенные дни.',
    'Поля:',
    '- title: заголовок недели до 50 символов, как название главы, — по самому яркому ответу недели;',
    '- story: 2–3 предложения о неделе через конкретные ответы;',
    '- discoveries: 2–3 коротких наблюдения «что вы узнали друг о друге», каждое — про конкретный ответ, до 140 символов;',
    '- insight: одна закономерность (1–2 предложения): где вы похожи, где разные и что из этого интересного — бережно, без диагнозов;',
    '- tips: ровно 2 идеи на следующую неделю — конкретные дела вдвоём, связанные с ответами, до 140 символов каждая;',
    '- question: один вопрос для разговора за ужином, который вытекает из ответов недели.',
  ];
  return lines.filter((l, i, arr) => l !== '' || arr[i - 1] !== '').join('\n');
}

/** Метки {A}/{B} → имена; модель иногда пишет их кириллицей или с пробелами. */
function fill(text: string, a: string, b: string): string {
  return text
    .replace(/\{\s*[AА]\s*\}/g, a)
    .replace(/\{\s*[BВ]\s*\}/g, b)
    .replace(/\s+/g, ' ')
    .trim();
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s);
const bad = (s: string) => PARTNER_LABEL.test(s) || /[{}]/.test(s);

function cleanStory(raw: unknown, a: string, b: string): DigestStory | null {
  const r = raw as Partial<Record<keyof DigestStory, unknown>> | null;
  if (!r || typeof r.title !== 'string' || typeof r.story !== 'string') return null;
  const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? clip(fill(v, a, b), n) : null);
  const list = (v: unknown, n: number, max: number) =>
    (Array.isArray(v) ? v : [])
      .map((x) => str(x, n))
      .filter((x): x is string => !!x && x.length >= 10)
      .slice(0, max);
  const story: DigestStory = {
    title: str(r.title, 70) ?? '',
    story: str(r.story, 600) ?? '',
    discoveries: list(r.discoveries, 200, 3),
    insight: str(r.insight, 320),
    tips: list(r.tips, 180, 2),
    question: str(r.question, 200),
  };
  const all = [story.title, story.story, ...story.discoveries, story.insight ?? '', ...story.tips, story.question ?? ''];
  if (story.title.length < 3 || story.story.length < 20 || all.some(bad)) return null;
  return story;
}

// --- Текст по шаблону ------------------------------------------------------------

function templateStory(c: Collected, users: UserRow[]): DigestStory {
  const [x, y] = users;
  const total = c.facts.length;
  const same = c.facts.filter((f) => f.same).length;
  const title =
    total === 0 ? 'Тихая неделя' : same >= Math.ceil(total * 0.7) ? 'Неделя совпадений' : c.guessesRight <= total ? 'Неделя сюрпризов' : 'Неделя открытий';
  const m = c.matchF ? momentOf(c.matchF, users) : null;
  const s = c.surpriseF ? momentOf(c.surpriseF, users) : null;
  const story = [
    m ? `Вы оба выбрали «${m.answers[0]}» в вопросе «${m.question.replace(/[:?]\s*$/, '')}».` : '',
    s ? `А вот «${s.question.replace(/[:?]\s*$/, '')}» развёл вас: ${x.name} — «${s.answers[0]}», ${y.name} — «${s.answers[1]}».` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const discoveries = c.facts
    .filter((f) => f !== c.matchF && f !== c.surpriseF && !f.same)
    .slice(0, 2)
    .map((f) => {
      const mm = momentOf(f, users);
      return `«${mm.question.replace(/[:?]\s*$/, '')}»: ${x.name} — «${mm.answers[0]}», ${y.name} — «${mm.answers[1]}».`;
    });
  // Идеи-дела из двух главных тем недели
  const tips = [
    ...new Set(
      c.topics.slice(0, 2).flatMap((t) =>
        curatedIdeas(t, true)
          .filter((i) => i.kind === 'do')
          .map((i) => i.text),
      ),
    ),
  ].slice(0, 2);
  const question = (c.surpriseF ?? c.matchF)?.q.topic ?? null;
  return {
    title,
    story: story || 'Неделя прошла в своём ритме. Новые вопросы уже ждут — начать можно с сегодняшнего.',
    discoveries,
    insight: null,
    tips,
    question: question ? renderText(question, x.name, y.name) : null,
  };
}

/** Текст запроса к ИИ для недели — для проверки промпта. */
export function digestPrompt(pair: PairRow, start: string): string | null {
  const users = members(pair.id);
  if (users.length < 2) return null;
  return prompt(pair, start, addDays(start, 6), collect(pair, users, start, addDays(start, 6)), null);
}

// --- Сборка и хранение -----------------------------------------------------------

/** Итоги недели пары: из базы, а если их ещё нет и неделя закончилась — собираем. */
export async function digestFor(pair: PairRow, start: string, log: { warn: (s: string) => void }): Promise<WeekDigest | null> {
  const saved = one<{ data: string }>('SELECT data FROM week_digests WHERE pair_id = ? AND week_start = ?', pair.id, start);
  if (saved) return JSON.parse(saved.data) as WeekDigest;
  const end = addDays(start, 6);
  if (dateInTz(pair.tz) <= end || pair.is_guest) return null;
  const users = members(pair.id);
  const since = pairSince(pair.id, users);
  // Пара собралась позже конца недели — итогов за неё нет
  if (!since || since > end) return null;

  const c = collect(pair, users, start, end);
  let story: DigestStory;
  let source: WeekDigest['source'];
  if (c.facts.length === 0) {
    story = {
      title: 'Тихая неделя',
      story: 'Бывают недели, когда не до вопросов, — это нормально. Начать снова легко: сегодняшний вопрос уже ждёт вас обоих.',
      discoveries: [],
      insight: null,
      tips: [],
      question: null,
    };
    source = 'quiet';
  } else {
    const prev = one<{ data: string }>('SELECT data FROM week_digests WHERE pair_id = ? AND week_start = ?', pair.id, addDays(start, -7));
    const prevTitle = prev ? (JSON.parse(prev.data) as WeekDigest).story.title : null;
    const ai = aiEnabled()
      ? cleanStory(
          await aiJson({ name: 'digest', system: TONE, user: prompt(pair, start, end, c, prevTitle), schema: STORY_SCHEMA }, log),
          users[0].name,
          users[1].name,
        )
      : null;
    story = ai ?? templateStory(c, users);
    source = ai ? 'ai' : 'template';
  }

  const digest: WeekDigest = {
    weekStart: start,
    weekEnd: end,
    names: [users[0].name, users[1].name],
    days: c.days,
    revealed: c.facts.length,
    matches: c.facts.filter((f) => f.same).length,
    guessesRight: c.guessesRight,
    guessesTotal: c.facts.length * 2,
    gestures: c.gestures.length,
    ideasAdded: c.ideasAdded,
    ideasDone: c.ideasDone,
    topics: c.topics.map((t) => CATEGORY_LABELS[t] ?? t).slice(0, 5),
    matchMoment: c.matchF ? momentOf(c.matchF, users) : null,
    surpriseMoment: c.surpriseF ? momentOf(c.surpriseF, users) : null,
    story,
    source,
  };
  // Пока генерировали, мог успеть другой запрос — первая запись остаётся
  run(
    'INSERT OR IGNORE INTO week_digests (pair_id, week_start, data, source, created_at) VALUES (?, ?, ?, ?, ?)',
    pair.id,
    start,
    JSON.stringify(digest),
    source,
    nowIso(),
  );
  logEvent('digest_generated', { pairId: pair.id, meta: { source } });
  const stored = one<{ data: string }>('SELECT data FROM week_digests WHERE pair_id = ? AND week_start = ?', pair.id, start)!;
  return JSON.parse(stored.data) as WeekDigest;
}

/** Для главной: итоги прошлой недели ждут (пн–ср), если человек их ещё не открыл. */
export function digestReadyFor(user: UserRow, pair: PairRow): { weekStart: string; title: string | null } | null {
  if (pair.is_guest) return null;
  if ((weekdayInTz(pair.tz) + 6) % 7 > 2) return null;
  const start = digestWeekStart(pair.tz, 1);
  if (one('SELECT 1 FROM digest_seen WHERE user_id = ? AND week_start = ?', user.id, start)) return null;
  const since = pairSince(pair.id, members(pair.id));
  if (!since || since > addDays(start, 6)) return null;
  const saved = one<{ data: string; source: string }>('SELECT data, source FROM week_digests WHERE pair_id = ? AND week_start = ?', pair.id, start);
  if (saved?.source === 'quiet') return null;
  return { weekStart: start, title: saved ? (JSON.parse(saved.data) as WeekDigest).story.title : null };
}

/** Собрать итоги заранее — в понедельник с 5 утра по времени пары, чтобы к утреннему уведомлению всё было готово. */
export async function warmDigests(log: { warn: (s: string) => void }) {
  const pairs = all<PairRow>(
    `SELECT p.* FROM pairs p WHERE p.is_guest = 0 AND p.deleted_at IS NULL AND (SELECT COUNT(*) FROM users u WHERE u.pair_id = p.id) >= 2`,
  );
  let made = 0;
  for (const pair of pairs) {
    if ((weekdayInTz(pair.tz) + 6) % 7 !== 0) continue;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: pair.tz, hour: '2-digit', hour12: false }).format(new Date()));
    if (hour < 5) continue;
    const start = digestWeekStart(pair.tz, 1);
    if (one('SELECT 1 FROM week_digests WHERE pair_id = ? AND week_start = ?', pair.id, start)) continue;
    await digestFor(pair, start, log);
    if (++made >= 20) break;
  }
}

export function startDigests(log: { warn: (s: string) => void }) {
  const timer = setInterval(
    () => void warmDigests(log).catch((e: unknown) => log.warn(`итоги недели: ${e instanceof Error ? e.message : String(e)}`)),
    10 * 60_000,
  );
  timer.unref();
}

export async function registerDigestRoutes(app: FastifyInstance) {
  /** Итоги недели offset недель назад (1 — прошлая, до 12). Открытие отмечается. */
  app.get('/api/week/digest', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
    const offset = Math.min(12, Math.max(1, Number((req.query as { offset?: string }).offset) || 1));
    const start = digestWeekStart(pair.tz, offset);
    const digest = await digestFor(pair, start, app.log);
    if (digest && !one('SELECT 1 FROM digest_seen WHERE user_id = ? AND week_start = ?', user.id, start)) {
      run('INSERT OR IGNORE INTO digest_seen (user_id, week_start, seen_at) VALUES (?, ?, ?)', user.id, start, nowIso());
      logEvent('digest_opened', { pairId: pair.id, userId: user.id, meta: { offset } });
    }
    const joined = pairSince(pair.id, members(pair.id));
    const res: DigestResponse = {
      weekStart: start,
      weekEnd: addDays(start, 6),
      digest,
      hasOlder: offset < 12 && !!joined && joined <= addDays(start, -1),
    };
    return res;
  });
}
