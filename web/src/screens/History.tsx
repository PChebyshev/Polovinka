import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { HistoryItem } from '@polovinka/shared';
import { CATEGORY_LABELS, GESTURE_LABELS } from '@polovinka/shared';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import { choiceLabel, guessHit, matchPercent, nDays, plural } from '../lib/format';
import { Button, Heart, Spinner } from '../components/ui';
import { LevelBar } from '../components/LevelBar';
import { StreakBar } from '../components/StreakBar';
import { ChartCard, DAY_LABEL, RingMeter, RitualCalendar, UnderstandingLine, WeeklyColumns } from '../components/charts';
import { TopicsContent } from './Topics';

type Tab = 'overview' | 'feed' | 'topics';
type Insights = Awaited<ReturnType<typeof api.insights>>;

const TABS: Array<[Tab, string]> = [
  ['overview', 'Обзор'],
  ['feed', 'Лента'],
  ['topics', 'Темы'],
];

function fmtDay(iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('ru-RU', opts);
}

export function History() {
  const { me } = useStore();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  if (!me) return null;
  const title = me.partner ? `${me.user.name} и ${me.partner.name}` : me.user.name;

  return (
    <div className="mx-auto max-w-md px-4 pb-28 pt-4">
      <div className="text-sm text-muted">{title}</div>
      <h1 className="text-2xl font-bold">Наша история</h1>

      <div className="sticky top-0 z-10 -mx-4 mt-3 bg-bg/90 px-4 py-2 backdrop-blur">
        <div className="grid grid-cols-3 rounded-2xl bg-surface p-1">
          {TABS.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setParams(k === 'overview' ? {} : { tab: k }, { replace: true })}
              className={`rounded-xl py-2 text-sm font-semibold transition ${tab === k ? 'bg-accent text-bg' : 'text-muted'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3">
        {tab === 'overview' && <Overview />}
        {tab === 'feed' && <Feed />}
        {tab === 'topics' && <TopicsContent />}
      </div>
    </div>
  );
}

// --- Обзор -----------------------------------------------------------------------------

function TwoHalves() {
  // Небольшая иллюстрация: две половинки, которые складываются в одно сердце.
  return (
    <svg viewBox="0 0 120 100" className="h-24 w-28" aria-hidden>
      <path d="M60 92 C 20 66, 6 44, 14 26 C 22 8, 46 8, 58 26 L 60 29 Z" fill="var(--color-accent)" opacity="0.9" />
      <path d="M62 92 C 102 66, 116 44, 108 26 C 100 8, 76 8, 64 26 L 62 29 Z" fill="var(--color-lilac)" opacity="0.9" />
    </svg>
  );
}

function Tile({ value, label, to }: { value: ReactNode; label: string; to?: string }) {
  const body = (
    <>
      <div className="text-2xl font-bold">{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
    </>
  );
  return to ? (
    <Link to={to} className="rounded-2xl border border-line bg-surface px-4 py-3">
      {body}
    </Link>
  ) : (
    <div className="rounded-2xl border border-line bg-surface px-4 py-3">{body}</div>
  );
}

function Action({ to, icon, title, hint }: { to: string; icon: ReactNode; title: string; hint: string }) {
  return (
    <Link to={to} className="flex items-start gap-3 rounded-2xl border border-line bg-surface px-4 py-3">
      <span className="mt-0.5 text-accent">{icon}</span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </Link>
  );
}

const Icon = {
  week: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="4" width="18" height="17" rx="3" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  ),
  capsule: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="4" y="3" width="16" height="18" rx="8" />
      <path d="M4 12h16M12 15v2" />
    </svg>
  ),
  duel: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <path d="M3 20c0-3 2.5-5 5-5s5 2 5 5M11 20c0-3 2.5-5 5-5s5 2 5 5" />
    </svg>
  ),
  levels: (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4 20h4v-6H4zM10 20h4V9h-4zM16 20h4V4h-4z" />
    </svg>
  ),
};

function Overview() {
  const { me } = useStore();
  const [data, setData] = useState<Insights | null>(null);
  const [lineIdx, setLineIdx] = useState<number | null>(null);
  const [colIdx, setColIdx] = useState<number | null>(null);
  const [dayIdx, setDayIdx] = useState<number | null>(null);

  useEffect(() => {
    api
      .insights()
      .then(setData)
      .catch(() => setData(null));
  }, []);

  if (!me) return null;
  const c = me.counters;
  const pct = matchPercent(c.guessesRight, c.guessesTotal);

  if (c.discoveries === 0) {
    return (
      <div className="flex flex-col items-center rounded-3xl border border-line bg-surface px-6 py-10 text-center">
        <TwoHalves />
        <div className="mt-4 text-lg font-semibold">История начнётся с первого ответа</div>
        <p className="mt-2 text-sm text-muted">Ответьте вдвоём на вопрос дня — здесь появятся ваши открытия, графики и любимые моменты.</p>
        <Link to="/" className="mt-5 rounded-2xl bg-accent px-5 py-3 font-semibold text-bg">
          К вопросу дня
        </Link>
      </div>
    );
  }

  const weeks = data?.weekly ?? [];
  const firstActive = weeks.findIndex((w) => w.discoveries > 0);
  const shown = firstActive >= 0 ? weeks.slice(Math.max(0, Math.min(firstActive, weeks.length - 4))) : weeks.slice(-4);
  const wkLabel = (i: number) => `неделя с ${fmtDay(shown[i].weekStart, { day: 'numeric', month: 'short' })}`;
  const lineCaption =
    lineIdx === null
      ? null
      : shown[lineIdx].total
        ? `${wkLabel(lineIdx)}: угадали ${shown[lineIdx].right} из ${shown[lineIdx].total}, ${Math.round((shown[lineIdx].right / shown[lineIdx].total) * 100)}%`
        : `${wkLabel(lineIdx)}: догадок не было`;
  const colCaption =
    colIdx === null ? null : `${wkLabel(colIdx)}: ${shown[colIdx].discoveries} ${plural(shown[colIdx].discoveries, 'открытие', 'открытия', 'открытий')}`;
  const cal = data?.calendar ?? [];
  const dayCaption =
    dayIdx === null || !cal[dayIdx] || !DAY_LABEL[cal[dayIdx].state]
      ? null
      : `${fmtDay(cal[dayIdx].date, { weekday: 'short', day: 'numeric', month: 'long' })}: ${DAY_LABEL[cal[dayIdx].state]}`;

  return (
    <div className="space-y-4">
      {/* Главная цифра */}
      <div className="flex items-center gap-4 rounded-3xl border border-accent/30 bg-gradient-to-br from-accent/15 via-surface to-lilac/10 p-5">
        <RingMeter value={pct} />
        <div>
          <div className="text-sm text-muted">Знаем друг друга</div>
          <div className="mt-1 text-sm">
            {c.guessesTotal > 0 ? `угадали выбор друг друга ${c.guessesRight} из ${c.guessesTotal} раз` : 'угадывайте, что выберет другой'}
          </div>
          {data?.since && <div className="mt-2 text-xs text-muted">вместе в игре с {fmtDay(data.since)}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Tile value={c.discoveries} label={plural(c.discoveries, 'открытие друг о друге', 'открытия друг о друге', 'открытий друг о друге')} />
        <Tile value={c.daysTogether} label={`${nDays(c.daysTogether).split(' ')[1]} вместе в игре`} />
        <Tile value={c.gestures} label={plural(c.gestures, 'тёплый жест', 'тёплых жеста', 'тёплых жестов')} />
        <Tile value={me.badges} label={plural(me.badges, 'значок тем', 'значка тем', 'значков тем')} to="/history?tab=topics" />
      </div>

      <div>
        <StreakBar streak={me.streak} />
        <LevelBar counters={c} />
      </div>

      {!data ? (
        <Spinner />
      ) : (
        <>
          {weeks.filter((w) => w.discoveries > 0).length < 2 ? (
            <div className="flex items-center gap-4 rounded-3xl border border-dashed border-line bg-surface p-5">
              <svg width="56" height="44" viewBox="0 0 56 44" aria-hidden className="shrink-0">
                <line x1="4" y1="40" x2="52" y2="40" stroke="var(--color-line)" strokeWidth="1" />
                {[10, 18, 26, 34, 42].map((x, i) => (
                  <rect key={x} x={x - 3} y={40 - (i + 1) * 6} width="6" height={(i + 1) * 6} rx="2" fill="var(--color-accent)" opacity={i < 1 ? 0.9 : 0.25} />
                ))}
              </svg>
              <div>
                <div className="font-semibold">Графики скоро появятся</div>
                <div className="mt-1 text-sm text-muted">Через пару недель здесь будет видно, как растёт ваше понимание и сколько открытий вы делаете.</div>
              </div>
            </div>
          ) : (
            <>
              <ChartCard
                title="Как растёт понимание"
                subtitle="Доля угаданных выборов партнёра по неделям"
                caption={lineCaption}
                table={{
                  head: ['Неделя с', 'Угадали', '%'],
                  rows: shown.map((w) => [
                    fmtDay(w.weekStart, { day: 'numeric', month: 'short' }),
                    `${w.right} из ${w.total}`,
                    w.total ? `${Math.round((w.right / w.total) * 100)}%` : '—',
                  ]),
                }}
              >
                <UnderstandingLine weeks={shown} onPick={setLineIdx} />
              </ChartCard>

              <ChartCard
                title="Открытия по неделям"
                subtitle="Вопросы, на которые ответили оба"
                caption={colCaption}
                table={{
                  head: ['Неделя с', 'Открытий'],
                  rows: shown.map((w) => [fmtDay(w.weekStart, { day: 'numeric', month: 'short' }), w.discoveries]),
                }}
              >
                <WeeklyColumns weeks={shown} onPick={setColIdx} />
              </ChartCard>
            </>
          )}

          <ChartCard
            title="Календарь ритуала"
            subtitle="Последние 12 недель"
            caption={dayCaption}
            table={{
              head: ['День', 'Как прошёл'],
              rows: cal
                .filter((d) => d.state !== 'future' && d.state !== 'before')
                .reverse()
                .map((d) => [fmtDay(d.date), DAY_LABEL[d.state]]),
            }}
          >
            <RitualCalendar days={cal} onPick={setDayIdx} />
          </ChartCard>

          {(data.bestTopic || data.discoveryTopic) && (
            <div className="rounded-3xl border border-line bg-surface p-5">
              <div className="font-semibold">Что мы узнали</div>
              <div className="mt-3 space-y-3 text-sm">
                {data.bestTopic && (
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sage/20 text-sage">✓</span>
                    <span>
                      Лучше всего знаете друг друга в теме <b>«{data.bestTopic.label}»</b>
                      <span className="block text-xs text-muted">
                        угадали {data.bestTopic.right} из {data.bestTopic.total}
                      </span>
                    </span>
                  </div>
                )}
                {data.discoveryTopic && (
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sand/20 text-sand">✦</span>
                    <span>
                      Больше всего открытий в теме <b>«{data.discoveryTopic.label}»</b>
                      <span className="block text-xs text-muted">
                        угадали {data.discoveryTopic.right} из {data.discoveryTopic.total} — вы ещё узнаёте друг друга
                      </span>
                    </span>
                  </div>
                )}
              </div>
              <Link to="/history?tab=topics" className="mt-3 inline-block text-sm text-accent">
                Все темы →
              </Link>
            </div>
          )}
        </>
      )}

      {me.partner && (
        <div className="grid grid-cols-2 gap-2">
          <Action to="/week" icon={Icon.week} title="Итог недели" hint="Карточка для сторис" />
          <Action to="/capsule" icon={Icon.capsule} title="Капсула времени" hint="Письма в будущее" />
          <Action to="/challenge" icon={Icon.duel} title="Вызвать пару" hint="5 вопросов друзьям" />
          <Action to="/levels" icon={Icon.levels} title="Уровни" hint="Что откроется дальше" />
        </div>
      )}
    </div>
  );
}

// --- Лента -------------------------------------------------------------------------------

type Filter = 'all' | 'rounds' | 'gestures' | 'favorites';
const FILTERS: Array<[Filter, string]> = [
  ['all', 'Всё'],
  ['rounds', 'Вопросы'],
  ['gestures', 'Жесты'],
  ['favorites', '♥ Любимое'],
];

function Feed() {
  const { me } = useStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(
    async (before: string | null, replace: boolean) => {
      setLoading(true);
      try {
        const r = await api.history(before, filter === 'favorites', filter === 'rounds' || filter === 'gestures' ? filter : undefined);
        setItems((prev) => (replace || !prev ? r.items : [...prev, ...r.items]));
        setNext(r.nextBefore);
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    setItems(null);
    void load(null, true);
  }, [load]);

  const groups = useMemo(() => {
    const out: Array<{
      month: string;
      days: Array<{ day: string; items: HistoryItem[] }>;
    }> = [];
    for (const it of items ?? []) {
      const month = new Date(it.at).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(/\s*г\.$/, '');
      const day = it.at.slice(0, 10);
      let m = out[out.length - 1];
      if (!m || m.month !== month) out.push((m = { month, days: [] }));
      let d = m.days[m.days.length - 1];
      if (!d || d.day !== day) m.days.push((d = { day, items: [] }));
      d.items.push(it);
    }
    return out;
  }, [items]);

  if (!me) return null;
  const partnerName = me.partner?.name ?? 'половинка';

  const toggleFav = async (it: HistoryItem) => {
    const refId = it.type === 'round' ? it.round.id : it.gesture.id;
    const r = await api.toggleFavorite(it.type, refId);
    setItems((prev) => prev?.map((x) => (x === it ? { ...x, favoriteMine: r.favorite } : x)) ?? prev);
  };

  return (
    <div>
      <div className="mb-4 grid grid-cols-4 gap-1.5">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`rounded-full px-2 py-2 text-[13px] ${filter === k ? 'bg-accent text-bg' : 'bg-surface-2 text-muted'}`}
          >
            {label}
          </button>
        ))}
      </div>

      {items === null ? (
        <Spinner />
      ) : items.length === 0 ? (
        <div className="rounded-3xl border border-line bg-surface px-6 py-8 text-center text-sm text-muted">
          {filter === 'favorites'
            ? 'Любимых моментов пока нет. Нажмите сердечко у любого момента.'
            : filter === 'gestures'
              ? 'Тёплых жестов пока нет.'
              : 'Здесь появятся ваши ответы.'}
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((m) => (
            <section key={m.month}>
              <h2 className="mb-2 text-sm font-semibold capitalize text-muted">{m.month}</h2>
              <div className="space-y-4">
                {m.days.map((d) => (
                  <div key={d.day} className="relative pl-5">
                    <span className="absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
                    <span className="absolute bottom-0 left-[4.5px] top-5 w-px bg-line" />
                    <div className="mb-2 text-xs text-muted">
                      {fmtDay(d.day, {
                        weekday: 'long',
                        day: 'numeric',
                        month: 'long',
                      })}
                    </div>
                    <div className="space-y-2">
                      {d.items.map((it) =>
                        it.type === 'gesture' ? (
                          <GestureItem key={it.gesture.id} it={it} myId={me.user.id} partnerName={partnerName} onFav={() => toggleFav(it)} />
                        ) : (
                          <RoundItem key={it.round.id} it={it} myName={me.user.name} partnerName={partnerName} onFav={() => toggleFav(it)} />
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
          {next && (
            <Button variant="secondary" className="w-full" onClick={() => load(next, false)} disabled={loading}>
              Показать ещё
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function FavButton({ on, any, onClick }: { on: boolean; any: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`-m-2 shrink-0 p-2 ${on ? 'text-accent' : any ? 'text-accent/60' : 'text-muted/50'}`} aria-label="Любимый момент">
      <Heart className="h-5 w-5" filled={on || any} />
    </button>
  );
}

function RoundItem({
  it,
  myName,
  partnerName,
  onFav,
}: {
  it: Extract<HistoryItem, { type: 'round' }>;
  myName: string;
  partnerName: string;
  onFav: () => void;
}) {
  const r = it.round;
  const q = r.question;
  const revealed = r.status === 'revealed' && r.mine && r.partner;
  const hitMine = !!(revealed && guessHit(q.format, r.mine!.guess, r.partner!.choice));
  const hitTheirs = !!(revealed && guessHit(q.format, r.partner!.guess, r.mine!.choice));
  const tag = !revealed
    ? { text: 'ждём ответа', cls: 'bg-surface-2 text-muted' }
    : hitMine && hitTheirs
      ? { text: 'угадали друг друга', cls: 'bg-sage/15 text-sage' }
      : hitMine || hitTheirs
        ? {
            text: hitMine ? 'я угадал(а)' : `${partnerName} угадал(а)`,
            cls: 'bg-lilac/15 text-lilac',
          }
        : { text: 'открытие', cls: 'bg-sand/15 text-sand' };
  const why = (a: typeof r.mine) => (a ? a.whyText || a.whyChip : null);
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`rounded-full px-2 py-0.5 ${tag.cls}`}>{tag.text}</span>
            <span className="text-muted">
              {r.kind === 'bonus' ? 'бонус' : r.kind === 'repeat' ? 'повтор' : 'вопрос дня'} · {CATEGORY_LABELS[q.category] ?? 'свой вопрос'}
            </span>
          </div>
          <div className="mt-2 font-semibold leading-snug">{q.text}</div>
        </div>
        <FavButton on={it.favoriteMine} any={it.favoritePartner} onClick={onFav} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <div className="text-[11px] text-muted">{myName}</div>
          <div className="leading-snug">{r.mine ? choiceLabel(q, r.mine.choice) : '—'}</div>
          {why(r.mine) && <div className="mt-1 text-[11px] italic text-muted">«{why(r.mine)}»</div>}
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2">
          <div className="text-[11px] text-muted">{partnerName}</div>
          <div className="leading-snug">{revealed ? choiceLabel(q, r.partner!.choice) : r.partnerAnswered ? 'скрыто до раскрытия' : '—'}</div>
          {revealed && why(r.partner) && <div className="mt-1 text-[11px] italic text-muted">«{why(r.partner)}»</div>}
        </div>
      </div>
    </div>
  );
}

function GestureItem({
  it,
  myId,
  partnerName,
  onFav,
}: {
  it: Extract<HistoryItem, { type: 'gesture' }>;
  myId: string;
  partnerName: string;
  onFav: () => void;
}) {
  const g = it.gesture;
  const fromMe = g.fromUserId === myId;
  return (
    <div className={`flex ${fromMe ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${fromMe ? 'rounded-br-md bg-accent/15' : 'rounded-bl-md bg-rose/15'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] text-muted">
            {fromMe ? `Я → ${partnerName}` : `${partnerName} → мне`} · {GESTURE_LABELS[g.type]}
          </div>
          <FavButton on={it.favoriteMine} any={it.favoritePartner} onClick={onFav} />
        </div>
        <div className="mt-1 font-semibold leading-snug">{g.text}</div>
        <div className="mt-1 text-[11px] text-muted">
          {new Date(g.createdAt).toLocaleTimeString('ru-RU', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
}
