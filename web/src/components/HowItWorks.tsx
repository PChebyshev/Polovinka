import type { ReactNode } from 'react';

function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">{icon}</span>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="mt-0.5 text-sm text-muted">{children}</div>
      </div>
    </div>
  );
}

const sun = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
const moon = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </svg>
);
const heart = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
    <path d="M12 20.5 4.4 13.1A4.6 4.6 0 0 1 12 6.8a4.6 4.6 0 0 1 7.6 6.3Z" />
  </svg>
);

/** Как устроена Половинка — для тех, кто пришёл по совету друзей. */
export function HowItWorks() {
  return (
    <div className="rounded-3xl border border-line bg-surface p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted">Как это устроено</div>

      {/* мини-карточка вопроса */}
      <div className="mt-3 rounded-2xl bg-surface-2 p-3">
        <div className="text-[11px] text-muted">Вопрос дня</div>
        <div className="mt-0.5 font-semibold">Идеальный выходной — это…</div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl border-2 border-accent bg-accent/10 px-3 py-2">
            Дома под пледом
            <div className="mt-1 text-[10px] text-accent">я выберу</div>
          </div>
          <div className="rounded-xl border-2 border-lilac/70 bg-lilac/10 px-3 py-2">
            Новый город
            <div className="mt-1 text-[10px] text-lilac">а половинка?</div>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-4">
        <Step icon={sun} title="Утром — один вопрос, 20 секунд">
          Отвечаете за себя и угадываете, что выберет половинка.
        </Step>
        <Step icon={moon} title="Вечером — раскрытие">
          Видите ответы друг друга и кто кого угадал. А дальше — «почему?» и тема для разговора.
        </Step>
        <Step icon={heart} title="Только для вас двоих">
          Без соревнований и рекламы. История пары, значки за темы, и ответы, которые видите только вы.
        </Step>
      </div>
    </div>
  );
}
