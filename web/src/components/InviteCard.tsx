import { useState } from 'react';
import { Button, Card, Label } from './ui';
import { api } from '../lib/api';
import { shareText, type ShareResult } from '../lib/share';

export function InviteCard({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<ShareResult | 'busy' | null>(null);
  const [manual, setManual] = useState<string | null>(null);

  const invite = async () => {
    setState('busy');
    try {
      const inv = await api.invite();
      const r = await shareText(inv.text);
      if (r === 'manual') setManual(inv.text);
      setState(r);
      if (r === 'shared' || r === 'copied') void api.inviteSent(r);
    } catch {
      setState(null);
    }
  };

  return (
    <Card tone="accent" className="rise">
      <Label>Пара</Label>
      {!compact && <h2 className="mt-2 text-xl font-semibold">Позови половинку</h2>}
      <p className="mt-2 text-sm text-muted">
        Отправь ссылку в любом мессенджере. Половинка откроет её, введёт имя, и вы вместе.
      </p>
      <Button className="mt-4 w-full" big onClick={invite} disabled={state === 'busy'}>
        Позвать половинку
      </Button>
      {state === 'copied' && <p className="mt-2 text-center text-sm text-sage">Ссылка скопирована, осталось отправить</p>}
      {state === 'shared' && <p className="mt-2 text-center text-sm text-sage">Отправлено</p>}
      {manual && (
        <textarea readOnly className="mt-3 w-full rounded-2xl bg-surface-2 p-3 text-sm" rows={4} value={manual} onFocus={(e) => e.currentTarget.select()} />
      )}
    </Card>
  );
}
