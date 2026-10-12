import { all } from './db.js';

/**
 * Угадал ли человек выбор партнёра. Это и есть «совпадение» в Половинке:
 * понимание друг друга, а не одинаковые вкусы. Для шкалы засчитываем ±1 деление,
 * как показывает экран раскрытия.
 */
export function guessHit(format: string, guess: string | null, actual: string): boolean {
  if (guess === null) return false;
  if (format === 'scale') return Math.abs(Number(guess) - Number(actual)) <= 1;
  return guess === actual;
}

export interface Score {
  discoveries: number;
  /** Раунды, где оба выбрали одно и то же. */
  matches: number;
  /** Угаданные выборы партнёра (до двух на раунд). */
  guessesRight: number;
  /** Сделанные догадки. */
  guessesTotal: number;
}

/** Счёт по раскрытым раундам пары (без раундов вызова), опционально за период дат. */
export function scoreFor(pairId: string, from?: string, to?: string): Score {
  const rows = all<{ round_id: string; format: string; user_id: string; choice: string; guess: string | null }>(
    `SELECT r.id AS round_id, q.format AS format, a.user_id, a.choice, a.guess
       FROM rounds r
       JOIN questions q ON q.id = r.question_id
       JOIN answers a ON a.round_id = r.id
      WHERE r.pair_id = ? AND r.status = 'revealed' AND r.kind != 'challenge'
        ${from && to ? 'AND r.date BETWEEN ? AND ?' : ''}
      ORDER BY r.id`,
    ...(from && to ? [pairId, from, to] : [pairId]),
  );
  const byRound = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byRound.get(r.round_id) ?? [];
    list.push(r);
    byRound.set(r.round_id, list);
  }
  const s: Score = { discoveries: 0, matches: 0, guessesRight: 0, guessesTotal: 0 };
  for (const list of byRound.values()) {
    if (list.length < 2) continue;
    const [x, y] = list;
    s.discoveries++;
    if (x.choice === y.choice) s.matches++;
    for (const [me, other] of [
      [x, y],
      [y, x],
    ] as const) {
      if (me.guess === null) continue;
      s.guessesTotal++;
      if (guessHit(me.format, me.guess, other.choice)) s.guessesRight++;
    }
  }
  return s;
}

export function percent(right: number, total: number): number | null {
  return total > 0 ? Math.round((right / total) * 100) : null;
}
