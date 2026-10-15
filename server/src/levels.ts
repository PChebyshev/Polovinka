import { LEVELS } from '../../shared/src/types.js';
import type { Celebration } from '../../shared/src/types.js';
import { EXPLORE_AT, LEVEL_INFO, STREAK_MILESTONES, topicOf } from '../../shared/src/progress.js';
import { all, one, run, type PairRow } from './db.js';
import { nowIso } from './ids.js';
import { streakFor, topicsFor } from './progress.js';

export function levelFor(discoveries: number): { level: number; nextLevelAt: number | null; levelStartAt: number } {
  let level = 1;
  for (let i = 0; i < LEVELS.length; i++) if (discoveries >= LEVELS[i]) level = i + 1;
  const next = LEVELS[level] ?? null;
  return { level, nextLevelAt: next, levelStartAt: LEVELS[level - 1] };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
const nDisc = (n: number) => `${n} ${plural(n, 'открытие', 'открытия', 'открытий')}`;

export function celebrationFor(key: string): Celebration {
  // Значки тем: b:food:e — «Исследовали», b:food:k — «Знаем друг друга».
  const b = key.match(/^b:([a-z]+):([ek])$/);
  if (b) {
    const t = topicOf(b[1]);
    if (b[2] === 'e') {
      return {
        key,
        title: `Значок «${t?.explored ?? 'Исследователи'}»`,
        subtitle: `Тема «${t?.label ?? b[1]}»: раскрыли ${EXPLORE_AT} вопросов. Следующий значок темы — когда будете угадывать друг друга в трёх случаях из четырёх.`,
      };
    }
    return {
      key,
      title: `Значок «${t?.know ?? 'Знаем друг друга'}»`,
      subtitle: `Тема «${t?.label ?? b[1]}»: вы угадываете друг друга в трёх случаях из четырёх и чаще.`,
    };
  }
  const c = key.match(/^c:(.+)$/);
  if (c) {
    return { key, title: 'Капсула времени открылась', subtitle: 'Письма, которые вы написали друг другу, теперь можно прочитать.' };
  }
  const m = key.match(/^([dtls])(\d+)$/);
  const n = m ? Number(m[2]) : 0;
  if (m?.[1] === 'l') {
    const info = LEVEL_INFO[n - 1];
    const next = LEVELS[n] ?? null;
    const start = LEVELS[n - 1] ?? 0;
    const opened = info ? (info.soon ? `Скоро здесь появится ${info.unlock}.` : `Открыто: ${info.unlock}.`) : '';
    const tail = next === null ? ' Это высший уровень.' : ` До следующего уровня ${nDisc(next - start)}.`;
    return { key, title: `Уровень ${n} · ${info?.name ?? ''}`, subtitle: `${nDisc(start)} друг о друге. ${opened}${tail}` };
  }
  if (m?.[1] === 's') {
    return {
      key,
      title: `${n} ${plural(n, 'день', 'дня', 'дней')} подряд вместе`,
      subtitle: n >= 30 ? 'Это уже ваш ритуал. Спасибо, что находите друг для друга минуту.' : 'Неделя маленьких разговоров. Так и становятся ближе.',
    };
  }
  if (m?.[1] === 'd') {
    return { key, title: `${nDisc(n)} друг о друге`, subtitle: 'Вы пишете свою историю. Каждый ответ — ещё одна строчка.' };
  }
  return {
    key,
    title: `${n} ${plural(n, 'день', 'дня', 'дней')} вместе в игре`,
    subtitle: 'Маленький ритуал, который вы держите вдвоём.',
  };
}

function insert(pairId: string, keys: string[]) {
  for (const key of keys) run("INSERT OR IGNORE INTO milestones (pair_id, key, reached_at, seen_by) VALUES (?, ?, ?, '[]')", pairId, key, nowIso());
}

/** Проверяет новые вехи: уровни, серию, значки тем. Возвращает новые ключи. */
export function checkMilestones(pair: PairRow, discoveries: number): string[] {
  const have = new Set(all<{ key: string }>('SELECT key FROM milestones WHERE pair_id = ?', pair.id).map((r) => r.key));
  const fresh: string[] = [];
  const { level } = levelFor(discoveries);
  for (let l = 2; l <= level; l++) if (!have.has(`l${l}`)) fresh.push(`l${l}`);
  const streak = streakFor(pair);
  for (const n of STREAK_MILESTONES) if (streak.current >= n && !have.has(`s${n}`)) fresh.push(`s${n}`);
  for (const t of topicsFor(pair.id, level)) {
    if (t.badgeExplored && !have.has(`b:${t.key}:e`)) fresh.push(`b:${t.key}:e`);
    if (t.badgeKnow && !have.has(`b:${t.key}:k`)) fresh.push(`b:${t.key}:k`);
  }
  insert(pair.id, fresh);
  return fresh;
}

/** Капсулы, срок которых наступил, превращаются в вехи (одна церемония на капсулу). */
export function checkCapsules(pairId: string) {
  const opened = all<{ id: string }>('SELECT id FROM capsules WHERE pair_id = ? AND opens_at <= ?', pairId, nowIso());
  const have = new Set(all<{ key: string }>("SELECT key FROM milestones WHERE pair_id = ? AND key LIKE 'c:%'", pairId).map((r) => r.key));
  insert(pairId, opened.map((c) => `c:${c.id}`).filter((k) => !have.has(k)));
}

export function badgesCount(pairId: string): number {
  return Number(one<{ n: number }>("SELECT COUNT(*) AS n FROM milestones WHERE pair_id = ? AND key LIKE 'b:%'", pairId)?.n ?? 0);
}

export function unseenCelebrations(pairId: string, userId: string): Celebration[] {
  const rows = all<{ key: string; seen_by: string }>('SELECT key, seen_by FROM milestones WHERE pair_id = ? ORDER BY reached_at, rowid', pairId);
  return rows.filter((r) => !(JSON.parse(r.seen_by) as string[]).includes(userId)).map((r) => celebrationFor(r.key));
}

export function markCelebrationSeen(pairId: string, userId: string, key: string) {
  const row = one<{ seen_by: string }>('SELECT seen_by FROM milestones WHERE pair_id = ? AND key = ?', pairId, key);
  if (!row) return;
  const seen = JSON.parse(row.seen_by) as string[];
  if (!seen.includes(userId)) seen.push(userId);
  run('UPDATE milestones SET seen_by = ? WHERE pair_id = ? AND key = ?', JSON.stringify(seen), pairId, key);
}
