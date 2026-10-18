import { useEffect, useState } from 'react';
import { APP_NAME_ACC } from '@polovinka/shared';
import { api } from '../lib/api';
import { canPrompt, inAppBrowser, onInstallChange, platform, promptInstall } from '../lib/install';
import { Button } from './ui';

function ShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline h-5 w-5 -translate-y-0.5 text-[#4ea1ff]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="значок «Поделиться»"
    >
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

function AddIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="inline h-5 w-5 -translate-y-0.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-label="значок «На экран Домой»"
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

function DotsIcon() {
  return (
    <svg viewBox="0 0 24 24" className="inline h-5 w-5 -translate-y-0.5" fill="currentColor" aria-label="меню">
      <circle cx="12" cy="5" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="12" cy="19" r="2" />
    </svg>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-bg">{n}</span>
      <span className="leading-snug">{children}</span>
    </li>
  );
}

/**
 * Пошаговая инструкция «На экран „Домой“».
 * finalStep — что сделать после установки (по умолчанию: открыть иконку).
 */
export function InstallGuide({ finalStep }: { finalStep?: string }) {
  const [, bump] = useState(0);
  useEffect(() => onInstallChange(() => bump((n) => n + 1)), []);
  const p = platform();
  const inApp = inAppBrowser();
  const after = finalStep ?? `Откройте ${APP_NAME_ACC} с иконки на экране — там и начнём.`;

  if (p === 'android') {
    if (canPrompt()) {
      return (
        <div>
          <Button
            big
            className="w-full"
            onClick={async () => {
              const r = await promptInstall();
              if (r === 'accepted') void api.track('install_accepted');
            }}
          >
            Установить {APP_NAME_ACC}
          </Button>
          <p className="mt-2 text-center text-sm text-muted">{after}</p>
        </div>
      );
    }
    return (
      <ol className="space-y-3 text-[15px]">
        {inApp && <Step n={0}>Ссылка открылась внутри {inApp}. Нажмите меню и выберите «Открыть в браузере».</Step>}
        <Step n={1}>
          Нажмите меню <DotsIcon /> в правом верхнем углу браузера.
        </Step>
        <Step n={2}>Выберите «Установить приложение» или «Добавить на главный экран».</Step>
        <Step n={3}>{after}</Step>
      </ol>
    );
  }

  return (
    <ol className="space-y-3 text-[15px]">
      {inApp ? (
        <Step n={0}>Ссылка открылась внутри {inApp}. Нажмите «…» или значок компаса и выберите «Открыть в Safari».</Step>
      ) : (
        <li className="text-xs text-muted">Если страница открылась внутри Telegram или WhatsApp, сначала откройте её в Safari: «…» или значок компаса.</li>
      )}
      <Step n={1}>
        Нажмите «Поделиться» <ShareIcon /> внизу экрана. В Chrome она вверху справа.
      </Step>
      <Step n={2}>
        Пролистайте вниз и выберите «На экран „Домой“» <AddIcon />.
      </Step>
      <Step n={3}>Нажмите «Добавить». {after}</Step>
    </ol>
  );
}
