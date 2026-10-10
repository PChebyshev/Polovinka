import { useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Card, Label, Sheet } from '../components/ui';
import { InviteCard } from '../components/InviteCard';

export function Settings() {
  const { me, setMe, logout, refresh } = useStore();
  const [name, setName] = useState(me?.user.name ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [saved, setSaved] = useState(false);
  if (!me) return null;

  const saveName = async () => {
    const n = name.trim();
    if (!n || n === me.user.name) return;
    setMe(await api.updateMe({ name: n }));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  const del = async () => {
    await api.deleteHistory();
    setConfirmDelete(false);
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('polovinka.reveal.'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* пусто */
    }
    await refresh();
  };

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <h1 className="text-2xl font-bold">Настройки</h1>

      <Card className="mt-4">
        <Label>Моё имя</Label>
        <div className="mt-2 flex gap-2">
          <input className="min-w-0 flex-1 rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-accent/60" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
          <Button variant="secondary" onClick={saveName} disabled={!name.trim() || name.trim() === me.user.name}>
            {saved ? '✓' : 'Сохранить'}
          </Button>
        </div>
      </Card>

      <Card className="mt-4">
        <Label>Пара</Label>
        {me.partner ? (
          <p className="mt-2">
            Ваша пара: <span className="font-semibold">{me.user.name} и {me.partner.name}</span>. Ответы видны только вам двоим.
          </p>
        ) : (
          <p className="mt-2 text-muted">Половинка ещё не присоединилась.</p>
        )}
      </Card>
      {!me.partner && (
        <div className="mt-4">
          <InviteCard compact />
        </div>
      )}

      <Card className="mt-4">
        <Label>Уведомления</Label>
        <p className="mt-2 text-sm text-muted">Утренний вопрос и вечернее раскрытие появятся на этапе 4. Время: {me.user.notifMorning} и {me.user.notifEvening}.</p>
      </Card>

      <Card className="mt-4">
        <Label>Приватность</Label>
        <p className="mt-2 text-sm text-muted">Удаляет все вопросы, ответы и жесты вашей пары без возможности вернуть. Пара остаётся.</p>
        <Button variant="secondary" className="mt-3 w-full" onClick={() => setConfirmDelete(true)}>
          Удалить нашу историю
        </Button>
        <Button variant="ghost" className="mt-2 w-full" onClick={() => setConfirmLogout(true)}>
          Выйти с этого телефона
        </Button>
      </Card>

      <p className="mt-6 text-center text-xs text-muted">Мы на % · этап 1</p>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Удалить нашу историю?">
        <p className="text-sm text-muted">Исчезнут все ответы, «почему» и жесты у обоих. Вернуть будет нельзя.</p>
        <div className="mt-4 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmDelete(false)}>
            Оставить
          </Button>
          <Button className="flex-1 bg-rose" onClick={del}>
            Удалить
          </Button>
        </div>
      </Sheet>

      <Sheet open={confirmLogout} onClose={() => setConfirmLogout(false)} title="Выйти с этого телефона?">
        <p className="text-sm text-muted">Аккаунт привязан к этому телефону без пароля. После выхода вернуться в эту пару можно только по новой ссылке от половинки.</p>
        <div className="mt-4 flex gap-3">
          <Button variant="secondary" className="flex-1" onClick={() => setConfirmLogout(false)}>
            Остаться
          </Button>
          <Button className="flex-1" onClick={logout}>
            Выйти
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
