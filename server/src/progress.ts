import type { Streak, StreakDay, TopicProgress } from '../../shared/src/types.js';
import { EXPLORE_AT, KNOW_MIN_GUESSES, KNOW_RATIO, PACK_LEVEL, STREAK_GRACE_EVERY_DAYS, TOPICS, isCategoryUnlocked } from '../../shared/src/progress.js';
import { all, type PairRow } from './db.js';
import { addDays, dateInTz, daysBetween } from './time.js';
import { guessHit } from './score.js';

/**
 * Мягкая серия дней подряд. День засчитан, если на вопрос дня ответили оба
 * (когда угодно — вчерашний вопрос можно добрать сегодня). Один пропуск за
 * STREAK_GRACE_EVERY_DAYS дней прощается. Сегодня ещё не закончено и серию не рвёт.
 */
export function streakFor(pair: PairRow): Streak {
  const today = dateInTz(pair.tz);
  const start = pair.created_at.slice(0, 10) > today ? today : pair.created_at.slice(0, 10);
  const doneDates = new Set(
    all<{ date: string }>(
      `SELECT r.date FROM rounds r
        WHERE r.pair_id = ? AND r.kind = 'daily' AND (SELECT COUNT(*) FROM answers a WHERE a.round_id = r.id) >= 2`,
      pair.id,
    ).map((r) => r.date),
  );

  const total = Math.max(0, daysBetween(start, today));
  const states = new Map<string, StreakDay>();
  let cur = 0;
  let best = 0;
  let lastGraceIdx = -Infinity;
  for (let i = 0; i <= total; i++) {
    const d = addDays(start, i);
    if (doneDates.has(d)) {
      cur++;
      states.set(d, 'done');
    } else if (d === today) {
      states.set(d, 'today');
    } else if (cur > 0 && i - lastGraceIdx >= STREAK_GRACE_EVERY_DAYS) {
      lastGraceIdx = i;
      states.set(d, 'grace');
    } else {
      cur = 0;
      states.set(d, 'missed');
    }
    best = Math.max(best, cur);
  }

  const week: Streak['week'] = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i);
    week.push({ date: d, state: d < start ? 'before' : (states.get(d) ?? 'missed') });
  }
  return { current: cur, best, todayDone: doneDates.has(today), week };
}

/** Прогресс по темам: сколько раскрыто, насколько угадываете друг друга, значки. */
export function topicsFor(pairId: string, level: number): TopicProgress[] {
  const rows = all<{ round_id: string; category: string; format: string; user_id: string; choice: string; guess: string | null }>(
    `SELECT r.id AS round_id, q.category, q.format, a.user_id, a.choice, a.guess
       FROM rounds r JOIN questions q ON q.id = r.question_id JOIN answers a ON a.round_id = r.id
      WHERE r.pair_id = ? AND r.status = 'revealed' AND r.kind != 'challenge'`,
    pairId,
  );
  const byRound = new Map<string, typeof rows>();
  for (const r of rows) byRound.set(r.round_id, [...(byRound.get(r.round_id) ?? []), r]);
  const stat = new Map<string, { explored: number; right: number; total: number }>();
  for (const list of byRound.values()) {
    if (list.length < 2) continue;
    const s = stat.get(list[0].category) ?? { explored: 0, right: 0, total: 0 };
    s.explored++;
    for (const [me, other] of [
      [list[0], list[1]],
      [list[1], list[0]],
    ] as const) {
      if (me.guess === null) continue;
      s.total++;
      if (guessHit(me.format, me.guess, other.choice)) s.right++;
    }
    stat.set(list[0].category, s);
  }
  const remaining = new Map(
    all<{ category: string; n: number }>(
      `SELECT category, COUNT(*) AS n FROM questions q
        WHERE q.is_active = 1 AND (q.pair_id IS NULL OR q.pair_id = ?) AND q.id NOT IN (SELECT question_id FROM rounds WHERE pair_id = ?)
        GROUP BY category`,
      pairId,
      pairId,
    ).map((r) => [r.category, Number(r.n)]),
  );
  return TOPICS.map((t) => {
    const s = stat.get(t.key) ?? { explored: 0, right: 0, total: 0 };
    return {
      key: t.key,
      label: t.label,
      unlocked: isCategoryUnlocked(t.key, level),
      unlockLevel: PACK_LEVEL[t.key] ?? 1,
      explored: s.explored,
      right: s.right,
      total: s.total,
      badgeExplored: s.explored >= EXPLORE_AT,
      badgeKnow: s.total >= KNOW_MIN_GUESSES && s.right / s.total >= KNOW_RATIO,
      remaining: remaining.get(t.key) ?? 0,
    };
  });
}
