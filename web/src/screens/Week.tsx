import { useEffect, useRef, useState } from 'react';
import type { WeekResponse } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { shareText } from '../lib/share';
import { canvasToBlob, drawWeekCard } from '../lib/weekCard';
import { Button, Card, Label, Spinner } from '../components/ui';

export function Week() {
  const { me } = useStore();
  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setWeek(null);
    api.week(offset).then(setWeek).catch(() => setWeek(null));
  }, [offset]);

  useEffect(() => {
    if (!week || !canvasRef.current) return;
    drawWeekCard(canvasRef.current, week.names, week.stats, location.host);
    // Картинка нужна для OG-превью ссылки; загружаем молча.
    canvasToBlob(canvasRef.current)
      .then((b) => api.uploadWeekImage(week.code, b))
      .catch(() => undefined);
  }, [week]);

  if (!me) return null;
  if (!week) return <Spinner />;

  const url = `${location.origin}/w/${week.code}`;
  const title = week.names[1] ? `${week.names[0]} и ${week.names[1]}` : week.names[0];
  const d = week.stats.discoveries;
  const text = `${title}: ${d} ${d % 10 === 1 && d % 100 !== 11 ? 'открытие' : d % 10 >= 2 && d % 10 <= 4 && (d % 100 < 10 || d % 100 >= 20) ? 'открытия' : 'открытий'} за неделю${week.stats.matchPercent ? `, знаем друг друга на ${week.stats.matchPercent}%` : ''}. Наш ритуал в Половинке: ${url}`;

  const share = async () => {
    const canvas = canvasRef.current!;
    setStatus('busy');
    try {
      const blob = await canvasToBlob(canvas);
      const file = new File([blob], 'polovinka-week.png', { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] }) && window.isSecureContext) {
        try {
          await navigator.share({ files: [file], text, title: 'Половинка' });
          setStatus('shared');
          void api.weekShared('share_image');
          return;
        } catch (e) {
          if ((e as Error).name === 'AbortError') {
            setStatus(null);
            return;
          }
        }
      }
      const r = await shareText(text);
      setStatus(r);
      if (r === 'shared' || r === 'copied') void api.weekShared(r);
      if (r !== 'shared') {
        const u = URL.createObjectURL(blob);
        setDownloadUrl(u);
      }
    } catch {
      setStatus(null);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="text-2xl font-bold">Итог недели</h1>
      <div className="mt-2 flex gap-2">
        <button className={`rounded-full px-4 py-2 text-sm ${offset === 0 ? 'bg-accent text-bg' : 'bg-surface-2 text-muted'}`} onClick={() => setOffset(0)}>
          Эта неделя
        </button>
        <button className={`rounded-full px-4 py-2 text-sm ${offset === 1 ? 'bg-accent text-bg' : 'bg-surface-2 text-muted'}`} onClick={() => setOffset(1)}>
          Прошлая
        </button>
      </div>

      <canvas ref={canvasRef} className="mt-4 w-full rounded-3xl border border-line" style={{ aspectRatio: '1080 / 1350' }} />
      <p className="mt-2 text-xs text-muted">На карточке только цифры. Ваши ответы и «почему» остаются между вами.</p>

      <Button className="mt-4 w-full" big onClick={share} disabled={status === 'busy'}>
        Поделиться
      </Button>
      {status === 'shared' && <p className="mt-2 text-center text-sm text-sage">Отправлено</p>}
      {status === 'copied' && <p className="mt-2 text-center text-sm text-sage">Текст со ссылкой скопирован</p>}
      {downloadUrl && (
        <a className="mt-3 block text-center text-sm text-accent underline" href={downloadUrl} download="polovinka-week.png">
          Сохранить картинку
        </a>
      )}

      <Card className="mt-6">
        <Label>Ссылка на карточку</Label>
        <p className="mt-2 break-all text-sm text-muted">{url}</p>
      </Card>
    </div>
  );
}
