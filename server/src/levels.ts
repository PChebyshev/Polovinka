import { LEVELS } from '../../shared/src/types.js';
import type { Celebration } from '../../shared/src/types.js';
import { all, one, run } from './db.js';
import { nowIso } from './ids.js';

export function levelFor(discoveries: number): { level: number; nextLevelAt: number | null; levelStartAt: number } {
  let level = 1;
  for (let i = 0; i < LEVELS.length; i++) if (discoveries >= LEVELS[i]) level = i + 1;
  const next = LEVELS[level] ?? null;
  return { level, nextLevelAt: next, levelStartAt: LEVELS[level - 1] };
}

const DISCOVERY_MILESTONES = [10, 50, 100, 365];
const DAYS_MILESTONES = [7, 30, 100];

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export function celebrationFor(key: string): Celebration {
  const m = key.match(/^([dtl])(\d+)$/);
  const n = m ? Number(m[2]) : 0;
  if (m?.[1] === 'l') {
    const start = LEVELS[n - 1] ?? 0;
    const next = LEVELS[n] ?? null;
    return {
      key,
      title: `Уровень пары ${n}`,
      subtitle:
        next === null
          ? `${start} ${plural(start, 'открытие', 'открытия', 'открытий')} друг о друге. Это высший уровень.`
          : `${start} ${plural(start, 'открытие', 'открытия', 'открытий')} друг о друге. Полоска уровня начинается заново: до уровня ${n + 1} ещё ${next - start} ${plural(next - start, 'открытие', 'открытия', 'открытий')}.`,
    };
  }
  if (m?.[1] === 'd') {
    return {
      key,
      title: `${n} ${plural(n, 'открытие', 'открытия', 'открытий')} друг о друге`,
      subtitle:
        (n >= 100 ? 'Вы пишете свою историю, и она уже большая.' : 'Вы пишете свою историю. Каждый ответ — ещё одна строчка.') +
        (LEVELS.includes(n) ? ` Новый уровень пары: ${levelFor(n).level}.` : ''),
    };
  }
  return {
    key,
    title: `${n} ${plural(n, 'день', 'дня', 'дней')} вместе в игре`,
    subtitle: n >= 100 ? 'Сто дней маленьких разговоров. Это уже традиция.' : 'Маленький ритуал, который вы держите вдвоём.',
  };
}

/** Проверяет, не достигнуты ли новые вехи. Возвращает новые ключи. */
export function checkMilestones(pairId: string, discoveries: number, daysTogether: number): string[] {
  const have = new Set(all<{ key: string }>('SELECT key FROM milestones WHERE pair_id = ?', pairId).map((r) => r.key));
  const fresh: string[] = [];
  for (const n of DISCOVERY_MILESTONES) if (discoveries >= n && !have.has(`d${n}`)) fresh.push(`d${n}`);
  for (const n of DAYS_MILESTONES) if (daysTogether >= n && !have.has(`t${n}`)) fresh.push(`t${n}`);
  // Новый уровень пары. Если на том же пороге есть веха открытий, показываем только её.
  const { level } = levelFor(discoveries);
  for (let l = 2; l <= level; l++) {
    const threshold = LEVELS[l - 1];
    if (!have.has(`l${l}`) && !DISCOVERY_MILESTONES.includes(threshold)) fresh.push(`l${l}`);
  }
  for (const key of fresh) run("INSERT OR IGNORE INTO milestones (pair_id, key, reached_at, seen_by) VALUES (?, ?, ?, '[]')", pairId, key, nowIso());
  return fresh;
}

export function unseenCelebrations(pairId: string, userId: string): Celebration[] {
  const rows = all<{ key: string; seen_by: string }>('SELECT key, seen_by FROM milestones WHERE pair_id = ? ORDER BY reached_at', pairId);
  return rows.filter((r) => !(JSON.parse(r.seen_by) as string[]).includes(userId)).map((r) => celebrationFor(r.key));
}

export function markCelebrationSeen(pairId: string, userId: string, key: string) {
  const row = one<{ seen_by: string }>('SELECT seen_by FROM milestones WHERE pair_id = ? AND key = ?', pairId, key);
  if (!row) return;
  const seen = JSON.parse(row.seen_by) as string[];
  if (!seen.includes(userId)) seen.push(userId);
  run('UPDATE milestones SET seen_by = ? WHERE pair_id = ? AND key = ?', JSON.stringify(seen), pairId, key);
}
