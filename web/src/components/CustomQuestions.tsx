import { useEffect, useState } from 'react';
import type { CustomQuestion } from '@polovinka/shared';
import { LAYER_LABELS } from '@polovinka/shared';
import { api } from '../lib/api';
import { Button, Card, Chip, Label } from './ui';

const input = 'w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 outline-none focus:border-accent/60';

export function CustomQuestions({ myId, partnerName }: { myId: string; partnerName: string | null }) {
  const [list, setList] = useState<CustomQuestion[] | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [topic, setTopic] = useState('');
  const [layer, setLayer] = useState<'light' | 'us' | 'deep'>('light');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .customQuestions()
      .then((r) => setList(r.questions))
      .catch(() => setList([]));
  }, []);

  const add = async () => {
    if (!text.trim() || !a.trim() || !b.trim()) return;
    setBusy(true);
    try {
      const q = await api.addQuestion({ text: text.trim(), a: a.trim(), b: b.trim(), layer, topic: topic.trim() || undefined });
      setList((prev) => [q, ...(prev ?? [])]);
      setText('');
      setA('');
      setB('');
      setTopic('');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    await api.deleteQuestion(id);
    setList((prev) => prev?.filter((q) => q.id !== id) ?? prev);
  };

  return (
    <Card>
      <div className="flex items-center justify-between">
        <Label>Свои вопросы</Label>
        <span className="text-xs text-muted">{list?.length ?? 0}</span>
      </div>
      <p className="mt-2 text-sm text-muted">
        Ваш вопрос выйдет ближайшим вопросом дня. {partnerName ? `${partnerName} увидит подпись «Вопрос от: ${'вас'}».` : ''}
      </p>

      {open ? (
        <div className="mt-3 space-y-2">
          <input
            className={input}
            placeholder="Вопрос, например: Куда поедем в отпуск?"
            maxLength={160}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <input className={input} placeholder="Вариант A" maxLength={60} value={a} onChange={(e) => setA(e.target.value)} />
            <input className={input} placeholder="Вариант B" maxLength={60} value={b} onChange={(e) => setB(e.target.value)} />
          </div>
          <input className={input} placeholder="Тема на вечер (необязательно)" maxLength={200} value={topic} onChange={(e) => setTopic(e.target.value)} />
          <div className="flex flex-wrap gap-2">
            {(['light', 'us', 'deep'] as const).map((l) => (
              <Chip key={l} active={layer === l} onClick={() => setLayer(l)}>
                {LAYER_LABELS[l]}
              </Chip>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button className="flex-1" onClick={add} disabled={busy || !text.trim() || !a.trim() || !b.trim()}>
              Добавить
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" className="mt-3 w-full" onClick={() => setOpen(true)}>
          Добавить свой вопрос
        </Button>
      )}

      {list && list.length > 0 && (
        <ul className="mt-3 divide-y divide-line">
          {list.map((q) => (
            <li key={q.id} className="flex items-start justify-between gap-2 py-2 text-sm">
              <div>
                <div>{q.text}</div>
                <div className="text-xs text-muted">
                  {q.a} / {q.b} · {q.authorId === myId ? 'мой' : (partnerName ?? 'половинка')}
                  {q.used ? ' · уже был' : ' · в очереди'}
                </div>
              </div>
              {!q.used && (
                <button className="text-xs text-muted" onClick={() => remove(q.id)}>
                  убрать
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
