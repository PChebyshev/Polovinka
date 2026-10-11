import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { hasPushSubscription, pushSupport, subscribePush, unsubscribePush } from '../lib/sw';
import { Button, Card, Label } from './ui';

export function NotificationSettings() {
  const { me, setMe } = useStore();
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [testNote, setTestNote] = useState<string | null>(null);

  const test = async () => {
    setTestNote('Отправляю…');
    try {
      const r = await api.pushTest();
      if (r.tooSoon) setTestNote('Подождите полминуты перед следующей проверкой.');
      else if (r.disabled) setTestNote('Push выключен на сервере.');
      else if (r.sent > 0) setTestNote('Отправлено. Уведомление должно прийти в течение минуты. Если нет — проверьте, что уведомления для «Половинка» разрешены в настройках телефона.');
      else if (r.failed > 0) setTestNote(`Сервис уведомлений отказал (код ${r.statuses.join(', ')}). Выключите и снова включите уведомления на этом телефоне.`);
      else setTestNote('Этот телефон не подписан. Нажмите «Включить на этом телефоне».');
    } catch {
      setTestNote('Не удалось связаться с сервером.');
    }
  };
  const support = pushSupport();

  useEffect(() => {
    hasPushSubscription().then(setSubscribed);
  }, []);

  if (!me) return null;

  const toggle = async () => {
    setBusy(true);
    setNote(null);
    try {
      if (subscribed) {
        await unsubscribePush();
        setSubscribed(false);
        setMe(await api.updateMe({ notifEnabled: false }));
      } else {
        const r = await subscribePush();
        if (r === 'ok') {
          setSubscribed(true);
          setMe(await api.updateMe({ notifEnabled: true }));
        } else if (r === 'denied') setNote('Уведомления запрещены в настройках браузера.');
        else setNote('Не удалось включить. Попробуйте ещё раз позже.');
      }
    } finally {
      setBusy(false);
    }
  };

  const setTime = async (k: 'notifMorning' | 'notifEvening', v: string) => {
    if (!/^\d\d:\d\d$/.test(v)) return;
    setMe(await api.updateMe({ [k]: v }));
  };

  const input = 'rounded-2xl border border-line bg-surface-2 px-3 py-2 outline-none focus:border-accent/60';

  return (
    <Card>
      <Label>Уведомления</Label>
      <p className="mt-2 text-sm text-muted">Не больше двух в день: утром вопрос, вечером раскрытие. Тон приглашающий, без напоминаний о пропусках.</p>

      {support === 'insecure' && <p className="mt-3 text-sm text-sand">Уведомления работают только по HTTPS.</p>}
      {support === 'unsupported' && <p className="mt-3 text-sm text-sand">Этот браузер не поддерживает push.</p>}
      {support === 'needs_install' && <p className="mt-3 text-sm text-sand">На iPhone уведомления приходят только после «Добавить на экран „Домой“» в Safari.</p>}
      {support === 'denied' && <p className="mt-3 text-sm text-sand">Уведомления запрещены в настройках браузера для этого сайта.</p>}

      {support === 'ok' && (
        <Button variant={subscribed ? 'secondary' : 'primary'} className="mt-3 w-full" onClick={toggle} disabled={busy || subscribed === null}>
          {subscribed ? 'Выключить на этом телефоне' : 'Включить на этом телефоне'}
        </Button>
      )}
      {note && <p className="mt-2 text-sm text-rose">{note}</p>}
      {support === 'ok' && subscribed && (
        <Button variant="ghost" className="mt-1 w-full" onClick={test}>
          Проверить уведомление
        </Button>
      )}
      {testNote && <p className="mt-1 text-center text-xs text-muted">{testNote}</p>}

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <label>
          <div className="mb-1 text-xs text-muted">Утренний вопрос</div>
          <input type="time" className={`${input} w-full`} defaultValue={me.user.notifMorning} onBlur={(e) => setTime('notifMorning', e.target.value)} onChange={(e) => e.target.value.length === 5 && setTime('notifMorning', e.target.value)} />
        </label>
        <label>
          <div className="mb-1 text-xs text-muted">Вечернее раскрытие</div>
          <input type="time" className={`${input} w-full`} defaultValue={me.user.notifEvening} onBlur={(e) => setTime('notifEvening', e.target.value)} onChange={(e) => e.target.value.length === 5 && setTime('notifEvening', e.target.value)} />
        </label>
      </div>
      <p className="mt-2 text-xs text-muted">Если раскрытие случилось раньше, вечернее уведомление придёт сразу, а не по расписанию.</p>
    </Card>
  );
}
