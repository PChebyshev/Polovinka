import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { isStandalone } from '../lib/install';
import { hasPushSubscription, pushSupport, subscribePush } from '../lib/sw';
import { Button, Card, Label } from './ui';

const KEY = 'polovinka.notifPrompt.dismissedAt';

/**
 * На главной установленного приложения: если на этом телефоне нет подписки на push,
 * один тап включает её. Разрешение на iPhone можно спросить только по нажатию.
 */
export function NotificationPrompt() {
  const { setMe } = useStore();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (!isStandalone() || pushSupport() !== 'ok') return;
    try {
      if (Date.now() - Number(localStorage.getItem(KEY) ?? 0) < 3 * 86_400_000) return;
    } catch {
      /* пусто */
    }
    hasPushSubscription().then((has) => setShow(!has));
  }, []);

  if (!show) return null;

  const enable = async () => {
    setBusy(true);
    const r = await subscribePush();
    setBusy(false);
    if (r === 'ok') {
      setShow(false);
      setMe(await api.updateMe({ notifEnabled: true }));
    } else if (r === 'denied') setNote('Уведомления запрещены. Разрешите их в настройках iPhone → Уведомления → Половинка.');
    else setNote('Не получилось включить. Попробуйте в Настройках приложения.');
  };

  return (
    <Card tone="accent" className="rise">
      <Label>Уведомления</Label>
      <p className="mt-2 text-sm text-muted">Утром — вопрос дня, вечером — раскрытие. Не больше двух в день.</p>
      <Button className="mt-3 w-full" onClick={enable} disabled={busy}>
        Включить уведомления
      </Button>
      {note && <p className="mt-2 text-sm text-rose">{note}</p>}
      <button
        className="mt-2 w-full py-1 text-center text-xs text-muted"
        onClick={() => {
          try {
            localStorage.setItem(KEY, String(Date.now()));
          } catch {
            /* пусто */
          }
          setShow(false);
        }}
      >
        Не сейчас
      </button>
    </Card>
  );
}
