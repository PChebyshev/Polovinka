import { all, one, type QuestionRow, type RoundRow } from './db.js';
import { addDays, daysBetween, weekdayInTz } from './time.js';

const RATIO: Record<string, number> = { light: 0.6, us: 0.25, deep: 0.15 };
const DEEP_PER_WEEK = 2;
const FIRST_DAYS_WITHOUT_DEEP = 3;
const SURPRISE_FROM_DAY = 5;
const SURPRISE_EVERY_DAYS = 10;
const MARKS_TO_DISABLE_CATEGORY = 3;

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick<T>(items: T[], weight: (t: T) => number, rnd: () => number): T | undefined {
  const weights = items.map(weight);
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0) return items[Math.floor(rnd() * items.length)];
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export interface PickOptions {
  pairId: string;
  pairCreatedAt: string;
  tz: string;
  date: string;
  kind: 'daily' | 'bonus';
  seedSalt?: string;
  allowFormats?: string[];
  /** Пока в паре один человек — только лёгкие вопросы. */
  solo?: boolean;
}

/** Статистика по категориям: сколько раскрыто и сколько раз не угадали. */
function categoryStats(pairId: string): Map<string, { revealed: number; missed: number }> {
  const rows = all<{ category: string; revealed: number; missed: number }>(
    `SELECT q.category AS category,
            COUNT(DISTINCT r.id) AS revealed,
            SUM(CASE WHEN a.guess IS NOT NULL AND a.guess != p.choice THEN 1 ELSE 0 END) AS missed
       FROM rounds r
       JOIN questions q ON q.id = r.question_id
       JOIN answers a ON a.round_id = r.id
       JOIN answers p ON p.round_id = r.id AND p.user_id != a.user_id
      WHERE r.pair_id = ? AND r.status = 'revealed'
      GROUP BY q.category`,
    pairId,
  );
  const m = new Map<string, { revealed: number; missed: number }>();
  for (const r of rows) m.set(r.category, { revealed: Number(r.revealed), missed: Number(r.missed) });
  return m;
}

export function pickQuestion(opts: PickOptions): QuestionRow | undefined {
  const rnd = mulberry32(hashSeed(`${opts.pairId}|${opts.date}|${opts.kind}|${opts.seedSalt ?? ''}`));
  // Форматы-сюрпризы включаются на этапе 2; пока только «A или B».
  const allowFormats = opts.allowFormats ?? ['ab'];

  const used = new Set(all<{ question_id: string }>('SELECT question_id FROM rounds WHERE pair_id = ?', opts.pairId).map((r) => r.question_id));
  const marked = all<{ question_id: string; category: string }>(
    `SELECT m.question_id, q.category FROM question_marks m JOIN questions q ON q.id = m.question_id WHERE m.pair_id = ?`,
    opts.pairId,
  );
  const markedIds = new Set(marked.map((m) => m.question_id));
  const marksByCategory = new Map<string, number>();
  for (const m of marked) marksByCategory.set(m.category, (marksByCategory.get(m.category) ?? 0) + 1);

  const candidates = all<QuestionRow>(
    `SELECT * FROM questions WHERE is_active = 1 AND (pair_id IS NULL OR pair_id = ?)`,
    opts.pairId,
  ).filter((q) => !used.has(q.id) && !markedIds.has(q.id) && allowFormats.includes(q.format) && (marksByCategory.get(q.category) ?? 0) < MARKS_TO_DISABLE_CATEGORY);

  if (candidates.length === 0) return undefined;

  // Свои вопросы пары идут вне очереди.
  const custom = candidates.filter((q) => q.pair_id === opts.pairId);
  if (custom.length > 0 && opts.kind === 'daily') {
    custom.sort((x, y) => x.created_at.localeCompare(y.created_at));
    return custom[0];
  }

  const pairCreatedDate = opts.pairCreatedAt.slice(0, 10);
  const dayIndex = Math.max(0, daysBetween(pairCreatedDate, opts.date));
  const weekday = weekdayInTz(opts.tz, new Date(`${opts.date}T12:00:00Z`));

  const weekAgo = addDays(opts.date, -6);
  const recentDeep = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM rounds r JOIN questions q ON q.id = r.question_id
      WHERE r.pair_id = ? AND r.date >= ? AND r.date < ? AND q.layer = 'deep'`,
    opts.pairId,
    weekAgo,
    opts.date,
  );
  const deepAllowed =
    opts.kind === 'daily' &&
    weekday !== 1 &&
    dayIndex >= FIRST_DAYS_WITHOUT_DEEP &&
    Number(recentDeep?.n ?? 0) < DEEP_PER_WEEK;

  const layers = (opts.solo ? ['light'] : ['light', 'us', 'deep']).filter((l) => (l !== 'deep' || deepAllowed) && candidates.some((q) => q.layer === l));
  const layer = weightedPick(layers, (l) => RATIO[l], rnd) ?? 'light';

  // Форматы-сюрпризы: не раньше 5-го дня, примерно раз в 10 дней.
  let pool = candidates.filter((q) => q.layer === layer);
  const surpriseDay = dayIndex >= SURPRISE_FROM_DAY && rnd() < 1 / SURPRISE_EVERY_DAYS;
  const surprises = pool.filter((q) => q.format !== 'ab');
  const plain = pool.filter((q) => q.format === 'ab');
  if (surpriseDay && surprises.length > 0) pool = surprises;
  else if (plain.length > 0) pool = plain;

  const stats = categoryStats(opts.pairId);
  const weightOf = (q: QuestionRow) => {
    const s = stats.get(q.category);
    const missRate = s && s.revealed > 0 ? s.missed / (s.revealed * 2) : 0;
    const marks = marksByCategory.get(q.category) ?? 0;
    return Math.max(0.1, 1 + missRate * 2 - marks * 0.5);
  };
  return weightedPick(pool, weightOf, rnd);
}

export function roundsForDate(pairId: string, date: string): RoundRow[] {
  return all<RoundRow>('SELECT * FROM rounds WHERE pair_id = ? AND date = ? ORDER BY created_at', pairId, date);
}
