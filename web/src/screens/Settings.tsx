import { useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Button, Card, Label, Sheet } from '../components/ui';
import { InviteCard } from '../components/InviteCard';
import { CustomQuestions } from '../components/CustomQuestions';
import { NotificationSettings } from '../components/NotificationSettings';
import { InstallCard } from '../components/InstallCard';
import { LoginCodeBox } from '../components/LoginCode';
import { CATEGORY_LABELS, GESTURE_LABELS } from '@polovinka/shared';
import { Chip } from '../components/ui';

export function Settings() {
  const { me, setMe, logout, refresh } = useStore();
  const [name, setName] = useState(me?.user.name ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tplType, setTplType] = useState<'thanks' | 'thinking' | 'proud'>('thanks');
  const [tplText, setTplText] = useState('');
  if (!me) return null;

  const setTheme = async (theme: string | null) => setMe(await api.setTheme(theme));
  const addTemplate = async () => {
    if (!tplText.trim()) return;
    await api.addTemplate(tplType, tplText.trim());
    setTplText('');
    await refresh();
  };
  const removeTemplate = async (id: string) => {
    await api.deleteTemplate(id);
    await refresh();
  };

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

      <div className="mt-4">
        <CustomQuestions myId={me.user.id} partnerName={me.partner?.name ?? null} />
      </div>

      <Card className="mt-4">
        <Label>Тема недели</Label>
        <p className="mt-2 text-sm text-muted">Вопросы из выбранной темы будут выпадать чаще. Меняет любой из вас.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip active={!me.weekTheme} onClick={() => setTheme(null)}>
            Без темы
          </Chip>
          {Object.entries(CATEGORY_LABELS).map(([k, label]) => (
            <Chip key={k} active={me.weekTheme === k} onClick={() => setTheme(k)}>
              {label}
            </Chip>
          ))}
        </div>
      </Card>

      <Card className="mt-4">
        <Label>Свои шаблоны жестов</Label>
        <p className="mt-2 text-sm text-muted">Появятся чипами на экране жеста у обоих.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(['thanks', 'thinking', 'proud'] as const).map((t) => (
            <Chip key={t} active={tplType === t} onClick={() => setTplType(t)}>
              {GESTURE_LABELS[t]}
            </Chip>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-accent/60"
            placeholder="Текст шаблона"
            maxLength={120}
            value={tplText}
            onChange={(e) => setTplText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void addTemplate()}
          />
          <Button variant="secondary" onClick={addTemplate} disabled={!tplText.trim()}>
            +
          </Button>
        </div>
        {me.gestureTemplates.length > 0 && (
          <ul className="mt-3 divide-y divide-line text-sm">
            {me.gestureTemplates.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  <span className="text-muted">{GESTURE_LABELS[t.type]} </span>
                  {t.text}
                </span>
                <button className="text-xs text-muted" onClick={() => removeTemplate(t.id)}>
                  убрать
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-4">
        <Label>Вход на другом устройстве</Label>
        <p className="mt-2 text-sm text-muted">
          Для второго телефона или приложения на экране «Домой» на iPhone: там нажмите «У меня уже есть аккаунт» и введите код.
        </p>
        <LoginCodeBox />
      </Card>

      <div className="mt-4">
        <NotificationSettings />
      </div>

      <div className="mt-4">
        <InstallCard />
      </div>

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

      <p className="mt-6 text-center text-xs text-muted">Мы на % · этап 4</p>

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
        <p className="text-sm text-muted">Аккаунт без пароля. Вернуться можно по коду из «Вход на другом устройстве» на другом вашем устройстве, где вы уже вошли. Если такого нет, вернуться не получится.</p>
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
