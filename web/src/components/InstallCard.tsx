import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { canPrompt, dismissInstall, installDismissed, isIos, isStandalone, onInstallChange, promptInstall } from '../lib/install';
import { Button, Card, Label } from './ui';

export function InstallCard() {
  const [, bump] = useState(0);
  const [hidden, setHidden] = useState(() => installDismissed() || isStandalone());
  const [shownLogged, setShownLogged] = useState(false);

  useEffect(() => onInstallChange(() => bump((n) => n + 1)), []);

  const ios = isIos();
  const available = canPrompt() || ios;
  useEffect(() => {
    if (!hidden && available && !shownLogged) {
      setShownLogged(true);
      void api.track('install_prompt_shown');
    }
  }, [hidden, available, shownLogged]);

  if (hidden || !available) return null;

  const dismiss = () => {
    dismissInstall();
    void api.track('install_dismissed');
    setHidden(true);
  };
  const install = async () => {
    const r = await promptInstall();
    if (r === 'accepted') {
      void api.track('install_accepted');
      setHidden(true);
    }
  };

  return (
    <Card tone="sage" className="rise">
      <Label>На экран «Домой»</Label>
      <p className="mt-2 text-sm text-muted">
        {ios ? 'Добавьте «Мы на %» на экран: нажмите «Поделиться» внизу Safari, затем «На экран „Домой“». Так появятся и уведомления.' : 'Добавьте «Мы на %» на экран: откроется как приложение, без адресной строки.'}
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="ghost" onClick={dismiss}>
          Не сейчас
        </Button>
        {!ios && (
          <Button className="flex-1" onClick={install}>
            Добавить
          </Button>
        )}
        {ios && (
          <Button variant="secondary" className="flex-1" onClick={dismiss}>
            Понятно
          </Button>
        )}
      </div>
    </Card>
  );
}
