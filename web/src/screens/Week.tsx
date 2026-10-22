import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DigestResponse, WeekResponse } from '@polovinka/shared';
import { WeekDigestView, weekRange } from '../components/WeekDigestView';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { shareText } from '../lib/share';
import { canvasToBlob, drawWeekCard } from '../lib/weekCard';
import { Button, Card, Label, Spinner } from '../components/ui';

/** Итоги недели: листаем назад по неделям. */
function DigestTab() {
  const { refresh } = useStore();
  const [offset, setOffset] = useState<number | undefined>(undefined);
  const [res, setRes] = useState<DigestResponse | null>(null);
  useEffect(() => {
    setRes(null);
    api
      .weekDigest(offset)
      .then((r) => {
        setRes(r);
        void refresh();
      })
      .catch(() => setRes(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset]);
  if (!res) return <Spinner />;
  return (
    <div className="mt-4">
      <div className="mb-3 flex items-center justify-between text-sm">
        <button className="text-muted disabled:opacity-30" onClick={() => setOffset(res.offset + 1)} disabled={!res.hasOlder}>
          ← раньше
        </button>
        <span className="text-muted">{weekRange(res.weekStart, res.weekEnd)}</span>
        <button className="text-muted disabled:opacity-30" onClick={() => setOffset(res.offset - 1)} disabled={!res.hasNewer}>
          позже →
        </button>
      </div>
      {res.digest ? (
        <WeekDigestView d={res.digest} />
      ) : (
        <Card>
          <p className="text-muted">За эту неделю итогов нет: вы тогда ещё не были вдвоём в Половинке.</p>
        </Card>
      )}
    </div>
  );
}

export function Week() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'card' ? 'card' : 'digest';
  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="text-2xl font-bold">Неделя</h1>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-surface-2 p-1 text-sm">
        {(
          [
            ['digest', 'Итоги'],
            ['card', 'Карточка для сторис'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className={`rounded-full py-2 ${tab === k ? 'bg-accent text-bg' : 'text-muted'}`}
            onClick={() => setParams(k === 'card' ? { tab: 'card' } : {}, { replace: true })}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'digest' ? <DigestTab /> : <ShareCard />}
    </div>
  );
}

function ShareCard() {
  const { me } = useStore();
  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setWeek(null);
    api
      .week(offset)
      .then(setWeek)
      .catch(() => setWeek(null));
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
    <div>
      <div className="mt-4 flex gap-2">
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
