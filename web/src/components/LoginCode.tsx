import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Button } from './ui';

/** Показывает одноразовый код входа для другого устройства или приложения на экране «Домой». */
export function LoginCodeBox({ auto = false }: { auto?: boolean }) {
  const [code, setCode] = useState<string | null>(null);
  const [expires, setExpires] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const make = useCallback(async () => {
    setBusy(true);
    setCopied(false);
    try {
      const r = await api.createLoginCode();
      setCode(r.code);
      setExpires(r.expiresAt);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (auto) void make();
  }, [auto, make]);

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      /* пользователь перепишет вручную */
    }
  };

  if (!code) {
    return (
      <Button variant="secondary" className="mt-3 w-full" onClick={make} disabled={busy}>
        Показать код входа
      </Button>
    );
  }

  const until = expires ? new Date(expires).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <div className="mt-3">
      <div className="rounded-2xl border border-line bg-surface-2 py-4 text-center font-mono text-3xl font-bold tracking-[0.3em]">{code}</div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>Действует до {until}, один раз</span>
        <span className="flex gap-3">
          <button className="text-accent" onClick={copy}>
            {copied ? 'Скопирован' : 'Скопировать'}
          </button>
          <button onClick={make} disabled={busy}>
            Новый
          </button>
        </span>
      </div>
    </div>
  );
}
