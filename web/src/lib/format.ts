export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

export function nDiscoveries(n: number): string {
  return `${n} ${plural(n, 'открытие', 'открытия', 'открытий')}`;
}

export function nDays(n: number): string {
  return `${n} ${plural(n, 'день', 'дня', 'дней')}`;
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/** Доля угаданных выборов партнёра — это и есть «Совпадаем на X%». */
export function matchPercent(guessesRight: number, guessesTotal: number): number | null {
  if (guessesTotal === 0) return null;
  return Math.round((guessesRight / guessesTotal) * 100);
}

/** Угадал ли выбор партнёра. Для шкалы засчитываем ±1 деление (как на сервере). */
export function guessHit(format: string, guess: string | null, actual: string | null | undefined): boolean {
  if (guess === null || actual == null) return false;
  if (format === 'scale') return Math.abs(Number(guess) - Number(actual)) <= 1;
  return guess === actual;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }) + ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** Подпись выбора с учётом формата вопроса. */
export function choiceLabel(q: { format: string; a: string; b: string }, choice: string | null): string {
  if (choice === null) return '—';
  if (q.format === 'scale') return `${choice} из 5`;
  return choice === 'a' ? q.a : q.b;
}
