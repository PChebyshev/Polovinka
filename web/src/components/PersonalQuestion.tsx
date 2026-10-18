import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useStore } from '../lib/store';

/** «Вопрос по вашим ответам»: один в день, составлен по истории пары. Только если на сервере включён ИИ. */
export function PersonalQuestion() {
  const { me, refresh } = useStore();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!me?.ai || !me.partner) return;
    api
      .personalStatus()
      .then((r) => setAvailable(r.available))
      .catch(() => undefined);
  }, [me?.ai, me?.partner]);

  if (!me?.ai || !available) return null;

  const ask = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await api.personal();
      setAvailable(false);
      await refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      onClick={ask}
      disabled={busy}
      className="block w-full rounded-3xl border border-lilac/40 bg-gradient-to-br from-lilac/15 to-surface px-4 py-3 text-left"
    >
      <div className="text-xs font-semibold uppercase tracking-wider text-lilac">Вопрос по вашим ответам ✦</div>
      <div className="mt-1 text-sm">
        {busy
          ? 'Составляем вопрос по вашей истории…'
          : failed
            ? 'Не получилось. Попробовать ещё раз →'
            : 'Новый вопрос, который продолжает то, что вы уже рассказали →'}
      </div>
    </button>
  );
}
