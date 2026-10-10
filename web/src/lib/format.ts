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

export function matchPercent(matches: number, discoveries: number): number | null {
  if (discoveries === 0) return null;
  return Math.round((matches / discoveries) * 100);
}
