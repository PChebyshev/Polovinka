import { useState } from 'react';
import { APP_NAME_ACC } from '@polovinka/shared';
import { api } from '../lib/api';
import { isStandalone, platform } from '../lib/install';
import { Button, Card, Label } from './ui';
import { QrCode } from './Qr';

const KEY = 'polovinka.desktopHandoff.dismissedAt';

/** На компьютере тем, кто уже вошёл: QR с одноразовым кодом — телефон откроется сразу в этом аккаунте. */
export function DesktopHandoffCard() {
  const [hidden, setHidden] = useState(() => {
    if (platform() !== 'desktop' || isStandalone()) return true;
    try {
      return !!localStorage.getItem(KEY);
    } catch {
      return false;
    }
  });
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (hidden) return null;

  const show = async () => {
    setBusy(true);
    try {
      const r = await api.createHandoff();
      setUrl(`${window.location.origin}/?h=${encodeURIComponent(r.code)}&src=qr`);
      void api.track('desktop_handoff_shown');
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => {
    try {
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* приватный режим */
    }
    setHidden(true);
  };

  return (
    <Card tone="sage">
      <div className="flex items-start justify-between gap-3">
        <Label>Перенесите на телефон</Label>
        <button className="text-xs text-muted" onClick={dismiss} aria-label="Скрыть">
          ✕
        </button>
      </div>
      <p className="mt-2 text-sm text-muted">
        Вопрос приходит утром уведомлением — на компьютере его легко пропустить. Откройте {APP_NAME_ACC} на телефоне: вы сразу окажетесь в своём аккаунте.
      </p>
      {url ? (
        <div className="mt-4 flex flex-col items-center">
          <div className="rounded-2xl bg-white p-2">
            <QrCode text={url} size={200} label="QR-код для входа с телефона" />
          </div>
          <p className="mt-3 text-center text-xs text-muted">Наведите камеру телефона. Код одноразовый — не показывайте его посторонним.</p>
        </div>
      ) : (
        <Button className="mt-3 w-full" onClick={show} disabled={busy}>
          Показать QR для телефона
        </Button>
      )}
    </Card>
  );
}
