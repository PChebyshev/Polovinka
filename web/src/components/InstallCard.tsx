import { useEffect, useState } from 'react';
import { APP_NAME, APP_NAME_ACC } from '@polovinka/shared';
import { api } from '../lib/api';
import { dismissInstall, installDismissed, onInstallChange, platform, shouldOfferInstall } from '../lib/install';
import { Button, Card, Label } from './ui';
import { InstallGuide } from './InstallGuide';

/**
 * Для тех, кто начал в браузере. На iPhone ведёт на /install с одноразовым кодом
 * в адресе запуска: открытая с экрана иконка войдёт в этот же аккаунт сама.
 */
export function InstallCard({ force = false }: { force?: boolean }) {
  const [, bump] = useState(0);
  const [hidden, setHidden] = useState(() => !shouldOfferInstall() || (!force && installDismissed()));
  const [busy, setBusy] = useState(false);
  useEffect(() => onInstallChange(() => bump((n) => n + 1)), []);
  useEffect(() => {
    if (!hidden) void api.track('install_prompt_shown');
  }, [hidden]);

  if (hidden) return null;
  const ios = platform() === 'ios';

  const goIos = async () => {
    setBusy(true);
    try {
      const r = await api.createHandoff();
      // Полная загрузка страницы: сервер подставит в манифест адрес запуска с кодом.
      window.location.assign(`/install?h=${encodeURIComponent(r.code)}`);
    } catch {
      setBusy(false);
    }
  };

  return (
    <Card tone="sage" className="rise">
      <Label>На экран «Домой»</Label>
      <p className="mt-2 text-sm text-muted">{APP_NAME} будет открываться одной иконкой, и придут уведомления: утром — вопрос, вечером — раскрытие.</p>
      {ios ? (
        <Button className="mt-3 w-full" onClick={goIos} disabled={busy}>
          Установить на экран
        </Button>
      ) : (
        <div className="mt-3">
          <InstallGuide finalStep={`Откройте ${APP_NAME_ACC} с иконки — вы уже будете в своём аккаунте.`} />
        </div>
      )}
      {!force && (
        <button
          className="mt-2 w-full py-1 text-center text-xs text-muted"
          onClick={() => {
            dismissInstall();
            void api.track('install_dismissed');
            setHidden(true);
          }}
        >
          Не сейчас
        </button>
      )}
    </Card>
  );
}
