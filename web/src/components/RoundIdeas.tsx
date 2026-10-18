import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RoundIdea } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { Card, Label } from './ui';

/** Идеи после раскрытия: что сделать вместе и о чём поговорить. Можно сохранить в «Хотим вместе». */
export function RoundIdeas({ roundId }: { roundId: string }) {
  const { refresh } = useStore();
  const [data, setData] = useState<{ ideas: RoundIdea[]; source: string; saved: boolean[] } | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .roundIdeas(roundId)
      .then((d) => alive && setData(d))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [roundId]);

  if (!data) return null;

  const save = async (i: number) => {
    const idea = data.ideas[i];
    setBusy(i);
    try {
      await api.addIdea(idea.text, idea.kind, roundId);
      setData({ ...data, saved: data.saved.map((s, k) => (k === i ? true : s)) });
      void refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="rise-2">
      <div className="flex items-center justify-between">
        <Label>{data.source === 'ai' ? 'Идеи для вас ✦' : 'Идеи для вас'}</Label>
        <Link to="/ideas" className="text-xs text-muted">
          Хотим вместе →
        </Link>
      </div>
      <div className="mt-3 space-y-3">
        {data.ideas.map((idea, i) => (
          <div key={i} className="flex items-start gap-3">
            <span
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm ${idea.kind === 'do' ? 'bg-accent/15 text-accent' : 'bg-lilac/15 text-lilac'}`}
            >
              {idea.kind === 'do' ? '✦' : '💬'}
            </span>
            <div className="flex-1">
              <div className="text-sm leading-snug">{idea.text}</div>
              {idea.kind === 'do' &&
                (data.saved[i] ? (
                  <span className="mt-1 inline-block text-xs text-sage">✓ В списке «Хотим вместе»</span>
                ) : (
                  <button className="mt-1 text-xs text-accent" onClick={() => save(i)} disabled={busy === i}>
                    + Хотим попробовать
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
