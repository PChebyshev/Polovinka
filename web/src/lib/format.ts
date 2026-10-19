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

/** Сегодняшняя дата YYYY-MM-DD по часам телефона. */
export function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDaysLocal(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** «сегодня», «завтра», «в субботу», «25 октября» — для планов. */
export function relDay(date: string, today = todayLocal()): string {
  const diff = Math.round((new Date(`${date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86_400_000);
  if (diff === 0) return 'сегодня';
  if (diff === 1) return 'завтра';
  if (diff === 2) return 'послезавтра';
  if (diff === -1) return 'вчера';
  const d = new Date(`${date}T12:00:00`);
  if (diff > 2 && diff < 7) {
    const wd = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'][d.getDay()];
    return wd;
  }
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/** Ближайшая суббота (если сегодня суббота — сегодня). */
export function nextSaturday(today = todayLocal()): string {
  const wd = new Date(`${today}T12:00:00`).getDay();
  return addDaysLocal(today, (6 - wd + 7) % 7);
}
