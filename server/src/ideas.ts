import type { FastifyInstance } from 'fastify';
import type { CareHint, Idea, Prefs, RoundIdea } from '../../shared/src/types.js';
import { CATEGORY_LABELS } from '../../shared/src/types.js';
import { STAGES, isCategoryVisible } from '../../shared/src/progress.js';
import { renderText } from '../../shared/src/text.js';
import { all, one, run, logEvent, type AnswerRow, type PairRow, type QuestionRow, type RoundRow, type UserRow } from './db.js';
import { newId, nowIso } from './ids.js';
import { requireUser } from './auth.js';
import { addDays, dateInTz } from './time.js';
import { partnerOf, roundPublic } from './serialize.js';
import { sendTo } from './sse.js';
import { aiEnabled, aiJson, TONE } from './ai.js';
import { curatedIdeas } from './ideasContent.js';
import { pairFlags } from './selection.js';
import { levelFor } from './levels.js';
import { scoreFor } from './score.js';

/**
 * Рекомендации и накопленная история:
 *  - идеи после раскрытия (ИИ или заранее написанные) и список «Хотим вместе»;
 *  - подсказки заботы: что радует половинку, по её ответам;
 *  - вопрос, составленный по истории ответов пары;
 *  - профиль пары (сколько вместе, дети) и личные настройки.
 */

const IDEA_MAX = 240;
const CARE_EVERY_DAYS = 7;
const CARE_CATEGORIES = ['joy', 'support', 'habits'];
const PERSONAL_MIN_LEVEL = 2;
const HISTORY_FOR_AI = 25;

interface IdeaRow {
  id: string;
  pair_id: string;
  text: string;
  kind: string;
  source: string;
  round_id: string | null;
  created_by: string;
  created_at: string;
  done_at: string | null;
}

function ideaPublic(r: IdeaRow): Idea {
  return {
    id: r.id,
    text: r.text,
    kind: r.kind === 'talk' ? 'talk' : 'do',
    source: r.source === 'round' || r.source === 'ai' ? r.source : 'manual',
    roundId: r.round_id,
    createdBy: r.created_by,
    createdAt: r.created_at,
    doneAt: r.done_at,
  };
}

export function ideasOpen(pairId: string): number {
  return Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM ideas WHERE pair_id = ? AND done_at IS NULL AND removed_at IS NULL', pairId)?.n ?? 0);
}

export function doneIdeas(pairId: string): Idea[] {
  return all<IdeaRow>('SELECT * FROM ideas WHERE pair_id = ? AND done_at IS NOT NULL AND removed_at IS NULL ORDER BY done_at', pairId).map(ideaPublic);
}

export function prefsFor(user: UserRow): Prefs {
  const partner = partnerOf(user);
  return { intimacy: user.intimacy_ok === 1, partnerIntimacy: partner?.intimacy_ok === 1, careHints: user.care_hints !== 0 };
}

function stageLabel(stage: string | null | undefined): string {
  return STAGES.find((s) => s.key === stage)?.label.toLowerCase() ?? 'не указано';
}

/** Ответ человека словами: вариант вопроса, «себя / половинку» или число на шкале. */
function answerLabel(q: QuestionRow, a: AnswerRow | undefined, me: string, them: string): string {
  if (!a) return '—';
  if (q.format === 'scale') return `${a.choice} из 5 (1 — ${renderText(q.a, me, them)}, 5 — ${renderText(q.b, me, them)})`;
  if (q.format === 'who') return a.choice === a.user_id ? 'назвал(а) себя' : 'назвал(а) партнёра';
  return renderText(a.choice === 'a' ? q.a : q.b, me, them);
}

function sameChoice(q: QuestionRow, x: AnswerRow, y: AnswerRow): boolean {
  if (q.format === 'scale') return Math.abs(Number(x.choice) - Number(y.choice)) <= 1;
  return x.choice === y.choice;
}

function guessed(q: QuestionRow, guesser: AnswerRow, other: AnswerRow): boolean {
  if (guesser.guess === null) return false;
  if (q.format === 'scale') return Math.abs(Number(guesser.guess) - Number(other.choice)) <= 1;
  return guesser.guess === other.choice;
}

const IDEAS_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array',
      items: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['do', 'talk'] }, text: { type: 'string' } },
        required: ['kind', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
};

/** «Партнёр 1/2» — служебные метки для модели, в тексте для людей их быть не должно. */
const PARTNER_LABEL = /партн[её]р\S*\s*[12]/i;

function cleanIdeas(raw: unknown): RoundIdea[] | null {
  const list = (raw as { ideas?: unknown })?.ideas;
  if (!Array.isArray(list)) return null;
  const out = list
    .map((x) => x as { kind?: unknown; text?: unknown })
    .filter((x) => (x.kind === 'do' || x.kind === 'talk') && typeof x.text === 'string' && x.text.trim().length >= 10 && !PARTNER_LABEL.test(x.text))
    .map((x) => ({ kind: x.kind as RoundIdea['kind'], text: (x.text as string).trim().slice(0, IDEA_MAX) }))
    .slice(0, 2);
  return out.length ? out : null;
}

/** Идеи для раскрытого раунда: один раз на раунд, оба видят одно и то же. */
async function ideasForRound(round: RoundRow, log: { warn: (s: string) => void }): Promise<{ ideas: RoundIdea[]; source: string }> {
  const cached = one<{ ideas: string; source: string }>('SELECT ideas, source FROM round_ideas WHERE round_id = ?', round.id);
  if (cached) {
    const list = JSON.parse(cached.ideas) as RoundIdea[];
    if (!list.some((i) => PARTNER_LABEL.test(i.text))) return { ideas: list, source: cached.source };
    run('DELETE FROM round_ideas WHERE round_id = ?', round.id);
  }

  const q = one<QuestionRow>('SELECT * FROM questions WHERE id = ?', round.question_id)!;
  const answers = all<AnswerRow>('SELECT * FROM answers WHERE round_id = ? ORDER BY created_at', round.id);
  const [x, y] = answers;
  const same = x && y ? sameChoice(q, x, y) : true;
  let ideas: RoundIdea[] | null = null;
  let source = 'curated';

  if (aiEnabled() && x && y) {
    const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', round.pair_id)!;
    const A = 'Партнёр 1';
    const B = 'Партнёр 2';
    const why = (a: AnswerRow) => (a.why_text || a.why_chip ? ` Почему: «${a.why_text || a.why_chip}».` : '');
    const user = [
      `Тема: ${CATEGORY_LABELS[q.category] ?? q.category}.`,
      `Вопрос: «${renderText(q.text, A, B)}»${q.format === 'ab' ? ` — варианты: «${renderText(q.a, A, B)}» или «${renderText(q.b, A, B)}».` : ''}`,
      `${A} ответил(а): ${answerLabel(q, x, A, B)}.${why(x)} Угадал(а) ответ партнёра: ${guessed(q, x, y) ? 'да' : 'нет'}.`,
      `${B} ответил(а): ${answerLabel(q, y, B, A)}.${why(y)} Угадал(а) ответ партнёра: ${guessed(q, y, x) ? 'да' : 'нет'}.`,
      `Вместе: ${stageLabel(pair.stage)}.${pair.has_kids ? ' Есть дети.' : ''}`,
      '',
      same
        ? 'Они выбрали одно и то же. Предложи одну идею, что сделать вместе (kind=do), и одну тему для разговора (kind=talk).'
        : 'Они выбрали по-разному. Предложи одну идею, как совместить оба выбора (kind=do), и один вопрос для разговора (kind=talk).',
      'Каждая идея — одно-два предложения, до 200 символов, обращение к паре на «вы». Не называй их «Партнёр 1» и «Партнёр 2»: пиши про пару целиком.',
      q.category === 'intimacy' ? 'Тема деликатная: только нежность и романтика, без откровенностей.' : '',
    ].join('\n');
    ideas = cleanIdeas(await aiJson({ name: 'ideas', system: TONE, user, schema: IDEAS_SCHEMA }, log));
    if (ideas) {
      source = 'ai';
      if (ideas.length < 2) ideas = [...ideas, ...curatedIdeas(q.category, same).filter((c) => !ideas!.some((i) => i.kind === c.kind))].slice(0, 2);
    }
  }
  ideas ??= curatedIdeas(q.category, same);
  run('INSERT OR IGNORE INTO round_ideas (round_id, ideas, source, created_at) VALUES (?, ?, ?, ?)', round.id, JSON.stringify(ideas), source, nowIso());
  return { ideas, source };
}

// --- Подсказка заботы ---------------------------------------------------------------

interface CareRow {
  id: string;
  to_user_id: string;
  round_id: string;
  text: string;
  created_at: string;
  seen_at: string | null;
}

async function careHintFor(user: UserRow, log: { warn: (s: string) => void }): Promise<CareHint | null> {
  const partner = partnerOf(user);
  if (!partner || partner.care_hints === 0) return null;
  const recent = one<CareRow>('SELECT * FROM care_hints WHERE to_user_id = ? ORDER BY created_at DESC LIMIT 1', user.id);
  if (recent && !recent.seen_at) return { id: recent.id, text: recent.text, roundId: recent.round_id };
  if (recent && Date.now() - new Date(recent.created_at).getTime() < CARE_EVERY_DAYS * 86_400_000) return null;

  const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
  const today = dateInTz(pair.tz);
  const round = one<RoundRow & { qid: string }>(
    `SELECT r.*, q.id AS qid FROM rounds r JOIN questions q ON q.id = r.question_id
      WHERE r.pair_id = ? AND r.status = 'revealed' AND q.format = 'ab' AND q.category IN (${CARE_CATEGORIES.map(() => '?').join(',')})
        AND r.date BETWEEN ? AND ?
        AND NOT EXISTS (SELECT 1 FROM care_hints c WHERE c.round_id = r.id AND c.to_user_id = ?)
      ORDER BY r.date DESC LIMIT 1`,
    pair.id,
    ...CARE_CATEGORIES,
    addDays(today, -60),
    addDays(today, -2),
    user.id,
  );
  if (!round) return null;
  const q = one<QuestionRow>('SELECT * FROM questions WHERE id = ?', round.question_id)!;
  const theirs = one<AnswerRow>('SELECT * FROM answers WHERE round_id = ? AND user_id = ?', round.id, partner.id);
  if (!theirs) return null;
  // Вопрос звучит голосом половинки: «Меня больше радует, когда ты: …»
  const said = `${renderText(q.text, partner.name, user.name)} ${lowerFirst(renderText(theirs.choice === 'a' ? q.a : q.b, partner.name, user.name))}`;
  // «— это про тебя»: в цитате «ты» — это тот, кто читает подсказку
  let text = `${partner.name} отвечал(а): «${said}» — это про тебя. Может, сегодня хороший повод?`;
  if (aiEnabled()) {
    const quoteQ = renderText(q.text, 'Б', 'А');
    const quoteA = lowerFirst(renderText(theirs.choice === 'a' ? q.a : q.b, 'Б', 'А'));
    const r = await aiJson<{ text?: string }>(
      {
        name: 'care',
        system: TONE,
        user: [
          'В паре два человека: А и Б. Подсказку будет читать А.',
          `Б ответил(а) на вопрос «${quoteQ}» вариантом «${quoteA}». В этом вопросе «я», «меня», «мне» — это Б, а «ты» — это А.`,
          'Напиши подсказку для А: что А может сделать для Б в ближайшие дни, опираясь на ответ Б.',
          'Обращайся к А на «ты». Б называй только «{partner}», в именительном падеже. К Б не обращайся. Не используй «он», «она», «его», «её» — пол неизвестен.',
          'Пример: «{partner} радуется, когда ты обнимаешь без повода. Сегодня хороший день, чтобы сделать это просто так.»',
          'До 180 символов.',
        ].join('\n'),
        schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
      },
      log,
    );
    if (r?.text && careTextOk(r.text)) text = r.text.trim().slice(0, IDEA_MAX).replaceAll('{partner}', partner.name);
  }
  const id = newId();
  run('INSERT INTO care_hints (id, pair_id, to_user_id, round_id, text, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, pair.id, user.id, round.id, text, nowIso());
  logEvent('care_hint', { pairId: pair.id, userId: user.id });
  return { id, text, roundId: round.id };
}

/**
 * Подсказка пишется тому, кто заботится, а не тому, чьи это ответы.
 * Отбрасываем ответы модели, где перепутан адресат: обращение к {partner}, «А/Б» в тексте.
 */
export function careTextOk(t: string): boolean {
  const s = t.trim();
  if (s.length < 20 || !s.includes('{partner}')) return false;
  if (/\{partner\}\s*[,!]/.test(s)) return false;
  if (/(^|[\s«(])[АБ]([\s,.!:»)]|$)/.test(s)) return false;
  if (/партн[её]р/i.test(s)) return false;
  return true;
}

function lowerFirst(s: string): string {
  return s && /^[A-ZА-ЯЁ][a-zа-яё]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

// --- Вопрос по истории ответов -----------------------------------------------------

const QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    a: { type: 'string' },
    b: { type: 'string' },
    topic: { type: 'string' },
    category: { type: 'string' },
  },
  required: ['text', 'a', 'b', 'topic', 'category'],
  additionalProperties: false,
};

async function personalQuestion(user: UserRow, partner: UserRow, log: { warn: (s: string) => void }): Promise<QuestionRow | null> {
  const flags = pairFlags(user.pair_id);
  const rounds = all<RoundRow>(
    `SELECT r.* FROM rounds r JOIN questions q ON q.id = r.question_id
      WHERE r.pair_id = ? AND r.status = 'revealed' ORDER BY r.revealed_at DESC LIMIT ?`,
    user.pair_id,
    HISTORY_FOR_AI,
  );
  if (rounds.length < 3) return null;
  const A = 'Партнёр 1';
  const B = 'Партнёр 2';
  const lines = rounds.map((r) => {
    const q = one<QuestionRow>('SELECT * FROM questions WHERE id = ?', r.question_id)!;
    const ans = all<AnswerRow>('SELECT * FROM answers WHERE round_id = ?', r.id);
    const mine = ans.find((a) => a.user_id === user.id);
    const theirs = ans.find((a) => a.user_id === partner.id);
    const why = (a: AnswerRow | undefined) => (a?.why_text ? ` («${a.why_text}»)` : '');
    return `- [${CATEGORY_LABELS[q.category] ?? q.category}] ${renderText(q.text, A, B)} → ${A}: ${answerLabel(q, mine, A, B)}${why(mine)}; ${B}: ${answerLabel(q, theirs, B, A)}${why(theirs)}`;
  });
  const cats = Object.keys(CATEGORY_LABELS).filter((c) => isCategoryVisible(c, flags) && !['childhood', 'future', 'again'].includes(c));
  const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
  const r = await aiJson<{ text?: string; a?: string; b?: string; topic?: string; category?: string }>(
    {
      name: 'question',
      system: TONE,
      user: [
        `Пара вместе: ${stageLabel(pair.stage)}.${pair.has_kids ? ' Есть дети.' : ''} Их последние ответы:`,
        ...lines,
        '',
        'Составь ОДИН новый вопрос с двумя вариантами ответа, который продолжает то, что они уже рассказали, и поможет узнать друг друга глубже.',
        'Не повторяй уже заданные вопросы. Вопрос — от первого лица, как в приложении: «Мне…», «Я бы…», «Сейчас мне…».',
        'text — до 90 символов, варианты a и b — до 40 символов каждый, оба привлекательные, без «правильного».',
        'topic — тема для разговора вечером, одно предложение. category — одна из: ' + cats.join(', ') + '.',
        flags.intimacy ? '' : 'Не касайся интимной темы.',
      ].join('\n'),
      schema: QUESTION_SCHEMA,
    },
    log,
  );
  if (!r?.text || !r.a || !r.b) return null;
  const text = r.text.trim().slice(0, 140);
  const a = r.a.trim().slice(0, 60);
  const b = r.b.trim().slice(0, 60);
  if (text.length < 8 || !a || !b || a.toLowerCase() === b.toLowerCase()) return null;
  const category = r.category && cats.includes(r.category) ? r.category : 'now';
  const id = newId();
  run(
    `INSERT INTO questions (id, pair_id, author_id, layer, category, format, text, a, b, why_chips, topic, is_active, created_at, source)
     VALUES (?, ?, NULL, 'us', ?, 'ab', ?, ?, ?, NULL, ?, 1, ?, 'ai')`,
    id,
    user.pair_id,
    category,
    text,
    a,
    b,
    (r.topic ?? '').trim().slice(0, 200) || null,
    nowIso(),
  );
  return one<QuestionRow>('SELECT * FROM questions WHERE id = ?', id)!;
}

export async function registerIdeaRoutes(app: FastifyInstance, deps: { meResponse: (u: UserRow) => unknown }) {
  const fresh = (id: string) => one<UserRow>('SELECT * FROM users WHERE id = ?', id)!;

  // --- Профиль пары и личные настройки ---------------------------------------------
  app.put('/api/pair/profile', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { stage?: unknown; hasKids?: unknown };
    if (body.stage !== undefined) {
      if (body.stage !== null && !STAGES.some((s) => s.key === body.stage)) return reply.code(400).send({ error: 'stage' });
      run('UPDATE pairs SET stage = ? WHERE id = ?', (body.stage as string | null) ?? null, user.pair_id);
    }
    if (body.hasKids !== undefined) run('UPDATE pairs SET has_kids = ? WHERE id = ?', body.hasKids === null ? null : body.hasKids ? 1 : 0, user.pair_id);
    logEvent('pair_profile', { pairId: user.pair_id, userId: user.id, meta: { stage: body.stage ?? null, hasKids: body.hasKids ?? null } });
    sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    return deps.meResponse(fresh(user.id));
  });

  app.put('/api/me/prefs', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { intimacy?: unknown; careHints?: unknown };
    if (typeof body.intimacy === 'boolean') run('UPDATE users SET intimacy_ok = ? WHERE id = ?', body.intimacy ? 1 : 0, user.id);
    if (typeof body.careHints === 'boolean') run('UPDATE users SET care_hints = ? WHERE id = ?', body.careHints ? 1 : 0, user.id);
    sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    return deps.meResponse(fresh(user.id));
  });

  // --- Идеи после раскрытия -----------------------------------------------------------
  app.get('/api/rounds/:id/ideas', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const round = one<RoundRow>('SELECT * FROM rounds WHERE id = ? AND pair_id = ?', (req.params as { id: string }).id, user.pair_id);
    if (!round) return reply.code(404).send({ error: 'round_not_found' });
    if (round.status !== 'revealed') return reply.code(409).send({ error: 'not_revealed' });
    const r = await ideasForRound(round, app.log);
    const saved = new Set(
      all<{ text: string }>('SELECT text FROM ideas WHERE pair_id = ? AND round_id = ? AND removed_at IS NULL', user.pair_id, round.id).map((x) => x.text),
    );
    return { ...r, saved: r.ideas.map((i) => saved.has(i.text)) };
  });

  // --- «Хотим вместе» -------------------------------------------------------------------
  app.get('/api/ideas', { preHandler: requireUser }, async (req) => {
    const rows = all<IdeaRow>('SELECT * FROM ideas WHERE pair_id = ? AND removed_at IS NULL ORDER BY created_at DESC', req.user!.pair_id);
    return { ideas: rows.map(ideaPublic) };
  });

  app.post('/api/ideas', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { text?: unknown; kind?: unknown; roundId?: unknown };
    const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, IDEA_MAX) : '';
    if (text.length < 3) return reply.code(400).send({ error: 'text' });
    const roundId =
      typeof body.roundId === 'string' && one('SELECT 1 FROM rounds WHERE id = ? AND pair_id = ?', body.roundId, user.pair_id) ? body.roundId : null;
    const dup = roundId
      ? one<IdeaRow>('SELECT * FROM ideas WHERE pair_id = ? AND round_id = ? AND text = ? AND removed_at IS NULL', user.pair_id, roundId, text)
      : undefined;
    if (dup) return ideaPublic(dup);
    const id = newId();
    const source = roundId
      ? one<{ source: string }>('SELECT source FROM round_ideas WHERE round_id = ?', roundId)?.source === 'ai'
        ? 'ai'
        : 'round'
      : 'manual';
    run(
      'INSERT INTO ideas (id, pair_id, text, kind, source, round_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      id,
      user.pair_id,
      text,
      body.kind === 'talk' ? 'talk' : 'do',
      source,
      roundId,
      user.id,
      nowIso(),
    );
    logEvent('idea_saved', { pairId: user.pair_id, userId: user.id, meta: { source } });
    sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    return ideaPublic(one<IdeaRow>('SELECT * FROM ideas WHERE id = ?', id)!);
  });

  app.post('/api/ideas/:id/done', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { done?: unknown };
    const idea = one<IdeaRow>('SELECT * FROM ideas WHERE id = ? AND pair_id = ? AND removed_at IS NULL', (req.params as { id: string }).id, user.pair_id);
    if (!idea) return reply.code(404).send({ error: 'not_found' });
    const done = body.done !== false;
    run('UPDATE ideas SET done_at = ?, done_by = ? WHERE id = ?', done ? nowIso() : null, done ? user.id : null, idea.id);
    if (done) logEvent('idea_done', { pairId: user.pair_id, userId: user.id });
    sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    return ideaPublic(one<IdeaRow>('SELECT * FROM ideas WHERE id = ?', idea.id)!);
  });

  app.delete('/api/ideas/:id', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    run('UPDATE ideas SET removed_at = ? WHERE id = ? AND pair_id = ?', nowIso(), (req.params as { id: string }).id, user.pair_id);
    sendTo(partnerOf(user)?.id, { type: 'pair_updated' });
    return { ok: true };
  });

  // --- Подсказка заботы -------------------------------------------------------------
  app.get('/api/care-hint', { preHandler: requireUser }, async (req) => ({ hint: await careHintFor(req.user!, app.log) }));

  app.post('/api/care-hint/:id/seen', { preHandler: requireUser }, async (req) => {
    run('UPDATE care_hints SET seen_at = ? WHERE id = ? AND to_user_id = ? AND seen_at IS NULL', nowIso(), (req.params as { id: string }).id, req.user!.id);
    return { ok: true };
  });

  // --- Вопрос по вашим ответам -------------------------------------------------------
  app.post('/api/rounds/personal', { preHandler: requireUser }, async (req, reply) => {
    const user = req.user!;
    const partner = partnerOf(user);
    if (!aiEnabled()) return reply.code(404).send({ error: 'ai_disabled' });
    if (!partner) return reply.code(409).send({ error: 'no_partner' });
    if (levelFor(scoreFor(user.pair_id).discoveries).level < PERSONAL_MIN_LEVEL) return reply.code(403).send({ error: 'level' });
    const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
    const date = dateInTz(pair.tz);
    // Один такой вопрос в день: если уже есть — возвращаем его
    const existing = one<RoundRow>(
      `SELECT r.* FROM rounds r JOIN questions q ON q.id = r.question_id WHERE r.pair_id = ? AND r.date = ? AND q.source = 'ai' LIMIT 1`,
      pair.id,
      date,
    );
    if (existing) return roundPublic(existing, user, partner);
    const q = await personalQuestion(user, partner, app.log);
    if (!q) return reply.code(503).send({ error: 'ai_failed' });
    const id = newId();
    run(
      `INSERT INTO rounds (id, pair_id, question_id, date, kind, status, created_at) VALUES (?, ?, ?, ?, 'bonus', 'open', ?)`,
      id,
      pair.id,
      q.id,
      date,
      nowIso(),
    );
    logEvent('personal_question', { pairId: pair.id, userId: user.id });
    sendTo(partner.id, { type: 'bonus_added', roundId: id });
    return roundPublic(one<RoundRow>('SELECT * FROM rounds WHERE id = ?', id)!, user, partner);
  });

  /** Есть ли уже вопрос по ответам сегодня — чтобы не показывать кнопку повторно. */
  app.get('/api/rounds/personal', { preHandler: requireUser }, async (req) => {
    const user = req.user!;
    const pair = one<PairRow>('SELECT * FROM pairs WHERE id = ?', user.pair_id)!;
    const level = levelFor(scoreFor(user.pair_id).discoveries).level;
    const today = one(
      `SELECT 1 FROM rounds r JOIN questions q ON q.id = r.question_id WHERE r.pair_id = ? AND r.date = ? AND q.source = 'ai'`,
      pair.id,
      dateInTz(pair.tz),
    );
    return { available: aiEnabled() && !!partnerOf(user) && level >= PERSONAL_MIN_LEVEL && !today, minLevel: PERSONAL_MIN_LEVEL };
  });
}
