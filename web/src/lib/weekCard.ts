import type { WeekStats } from '@polovinka/shared';

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x, y, x - s * 0.5, y - s * 0.1, x - s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.85, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.85, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 0.1, x, y, x, y + s * 0.3);
  ctx.closePath();
  ctx.fill();
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/** Рисует карточку недели 1080×1350 на canvas. Личных ответов на карточке нет. */
export function drawWeekCard(canvas: HTMLCanvasElement, names: [string, string | null], st: WeekStats, siteHost: string) {
  const W = 1080;
  const H = 1350;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const font = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#1b1412');
  g.addColorStop(1, '#3a241e');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // мягкие сердца на фоне
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = '#f2cc8f';
  heart(ctx, 860, 140, 420);
  ctx.fillStyle = '#e26d8a';
  heart(ctx, 220, 900, 520);
  ctx.globalAlpha = 1;

  ctx.fillStyle = '#b89f93';
  ctx.font = `600 34px ${font}`;
  ctx.textBaseline = 'top';
  ctx.fillText('ПОЛОВИНКА  ·  ИТОГ НЕДЕЛИ', 80, 90);
  ctx.fillText(`${fmtDate(st.weekStart)} — ${fmtDate(st.weekEnd)}`.toUpperCase(), 80, 136);

  const title = names[1] ? `${names[0]} и ${names[1]}` : names[0];
  ctx.fillStyle = '#f6ece4';
  ctx.font = `700 ${title.length > 18 ? 72 : 88}px ${font}`;
  ctx.fillText(title, 80, 220);

  // большая цифра: насколько пара знает друг друга; пока догадок мало — число открытий
  const pct = st.matchPercent;
  const showPct = pct !== null && pct > 0 && st.guessesTotal >= 4;
  ctx.fillStyle = '#e8875f';
  ctx.font = `800 260px ${font}`;
  ctx.fillText(showPct ? `${pct}%` : String(st.discoveries), 80, 380);
  ctx.fillStyle = '#f2cc8f';
  ctx.font = `600 48px ${font}`;
  ctx.fillText(showPct ? 'знаем друг друга' : `${plural(st.discoveries, 'открытие', 'открытия', 'открытий')} друг о друге за неделю`, 80, 690);

  // три плитки
  const tiles: Array<[string, string]> = [
    [String(st.discoveries), plural(st.discoveries, 'открытие', 'открытия', 'открытий')],
    [String(st.daysBoth), plural(st.daysBoth, 'день вдвоём', 'дня вдвоём', 'дней вдвоём')],
    [String(st.gestures), plural(st.gestures, 'тёплый жест', 'тёплых жеста', 'тёплых жестов')],
  ];
  tiles.forEach(([n, l], i) => {
    const x = 80 + i * 310;
    const y = 800;
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath();
    ctx.roundRect(x, y, 290, 220, 36);
    ctx.fill();
    ctx.fillStyle = '#f6ece4';
    ctx.font = `800 96px ${font}`;
    ctx.fillText(n, x + 36, y + 30);
    ctx.fillStyle = '#b89f93';
    ctx.font = `500 32px ${font}`;
    ctx.fillText(l, x + 36, y + 150);
  });

  // подпись
  ctx.fillStyle = '#e8875f';
  heart(ctx, 118, 1150, 70);
  ctx.fillStyle = '#f6ece4';
  ctx.font = `700 44px ${font}`;
  ctx.fillText('Половинка', 180, 1160);
  ctx.fillStyle = '#b89f93';
  ctx.font = `500 34px ${font}`;
  ctx.fillText('один вопрос в день на двоих', 180, 1215);
  ctx.textAlign = 'right';
  ctx.fillText(siteHost, W - 80, 1215);
  ctx.textAlign = 'left';
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
}
