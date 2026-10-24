import { useState } from 'react';
import { api, type CampaignStats, type StatsResponse } from '../lib/api';
import { Button, Card, Chip, Label } from './ui';

const SOURCES = ['VK Реклама', 'Telegram Ads', 'Яндекс Директ', 'Посев в каналах', 'Другое'];

function rub(n: number): string {
  return `${Math.round(n).toLocaleString('ru-RU')} ₽`;
}
function pctOf(n: number, d: number): string {
  return d ? `${Math.round((n / d) * 100)}%` : '—';
}

/** Воронка кампании: шаг, число, конверсия от предыдущего шага — текстом. */
function Steps({ rows }: { rows: Array<[string, number, number | null]> }) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return (
    <div className="space-y-1.5">
      {rows.map(([label, n, prev]) => (
        <div key={label} className="grid grid-cols-[8.5rem_1fr_4.5rem] items-center gap-2 text-xs">
          <span className="text-muted">{label}</span>
          <div className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-r-[4px] bg-accent" style={{ width: `${n ? Math.max(3, (n / max) * 100) : 0}%` }} />
          </div>
          <span className="text-right tabular-nums">
            {n}
            {prev !== null && <span className="text-muted"> · {pctOf(n, prev)}</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function CampaignCard({ c, statsKey, onChanged }: { c: CampaignStats; statsKey: string; onChanged: () => void }) {
  const [copied, setCopied] = useState<'main' | 'edge' | false>(false);
  const [editBudget, setEditBudget] = useState(false);
  const [budget, setBudget] = useState(c.budget ? String(c.budget) : '');
  const [busy, setBusy] = useState(false);
  const copy = async (which: 'main' | 'edge' = 'main') => {
    try {
      await navigator.clipboard.writeText(which === 'edge' && c.edgeUrl ? c.edgeUrl : c.url);
      setCopied(which);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* скопируют руками */
    }
  };
  const update = async (body: { budget?: number | null; archived?: boolean }) => {
    setBusy(true);
    try {
      await api.updateCampaign(statsKey, c.id, body);
      setEditBudget(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const top = c.visits || c.installs || c.signups;

  return (
    <div className={`rounded-2xl border border-line bg-surface-2/50 p-3 ${c.archived ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{c.name}</div>
          <div className="mt-0.5 text-[11px] text-muted">
            {c.source ?? 'без источника'}
            {c.auto ? ' · по utm-меткам' : ''}
            {c.archived ? ' · в архиве' : ''}
          </div>
        </div>
        <button className="shrink-0 text-xs text-muted" disabled={busy} onClick={() => update({ archived: !c.archived })}>
          {c.archived ? 'вернуть' : 'в архив'}
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2 rounded-xl bg-bg/50 px-3 py-2 text-xs">
        <span className="min-w-0 flex-1 truncate">{c.url}</span>
        <button className="shrink-0 text-accent" onClick={() => copy('main')}>
          {copied === 'main' ? 'скопировано' : 'скопировать'}
        </button>
      </div>
      {c.edgeUrl && (
        <div className="mt-1 flex items-center gap-2 rounded-xl bg-bg/50 px-3 py-2 text-xs">
          <span className="min-w-0 flex-1 truncate">
            <span className="text-muted">для Telegram (с VPN): </span>
            {c.edgeUrl}
          </span>
          <button className="shrink-0 text-accent" onClick={() => copy('edge')}>
            {copied === 'edge' ? 'скопировано' : 'скопировать'}
          </button>
        </div>
      )}

      <div className="mt-3">
        {top === 0 ? (
          <p className="text-xs text-muted">Переходов пока нет.</p>
        ) : (
          <Steps
            rows={[
              ['Перешли по ссылке', c.visits, null],
              ...(c.edgeVisits ? [['  из них с VPN (через зарубежный вход)', c.edgeVisits, c.visits || null] as [string, number, number | null]] : []),
              ['Установили на экран', c.installs, c.visits || null],
              ['Зарегистрировались', c.signups, c.visits || null],
              ['Партнёр присоединился', c.pairs, c.signups || null],
              ['Первое раскрытие', c.revealed, c.pairs || null],
              ['Активны сейчас (7 дн.)', c.active7, c.pairs || null],
            ]}
          />
        )}
        {c.week2Base > 0 && (
          <div className="mt-2 text-xs text-muted">
            Вернулись на 2-й неделе: <span className="text-text">{c.week2}</span> из {c.week2Base} пар старше 14 дней ({pctOf(c.week2, c.week2Base)})
          </div>
        )}
        {c.surveyResponses > 0 && (
          <div className="mt-1 text-xs text-muted">
            Опрос: «очень расстроюсь» — <span className="text-text">{c.surveyVery}</span> из {c.surveyResponses}
          </div>
        )}
      </div>

      <div className="mt-3 border-t border-line/60 pt-2 text-xs">
        {editBudget ? (
          <div className="flex gap-2">
            <input
              className="min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 py-2 outline-none focus:border-accent/60"
              inputMode="numeric"
              placeholder="Потрачено, ₽"
              value={budget}
              onChange={(e) => setBudget(e.target.value.replace(/\D/g, ''))}
            />
            <Button variant="secondary" onClick={() => update({ budget: budget ? Number(budget) : null })} disabled={busy}>
              Сохранить
            </Button>
          </div>
        ) : c.budget ? (
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted">
              Потрачено <span className="text-text">{rub(c.budget)}</span>
              {c.signups ? ` · регистрация ${rub(c.budget / c.signups)}` : ''}
              {c.pairs ? ` · пара ${rub(c.budget / c.pairs)}` : ''}
              {c.active7 ? ` · активная пара ${rub(c.budget / c.active7)}` : ''}
              {c.visits ? ` · переход ${rub(c.budget / c.visits)}` : ''}
            </span>
            <button className="shrink-0 text-muted" onClick={() => setEditBudget(true)}>
              изменить
            </button>
          </div>
        ) : (
          <button className="text-accent" onClick={() => setEditBudget(true)}>
            + указать, сколько потрачено — посчитаю стоимость пары
          </button>
        )}
      </div>
    </div>
  );
}

export function AdsStats({ ads, statsKey, periodDays, onChanged }: { ads: StatsResponse['ads']; statsKey: string; periodDays: number; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [source, setSource] = useState(SOURCES[0]);
  const [budget, setBudget] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const o = ads.organic;

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const r = await api.createCampaign(statsKey, { name: name.trim(), source, budget: budget ? Number(budget) : undefined });
      setCreated(r.url);
      setName('');
      setBudget('');
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  const active = ads.campaigns.filter((c) => !c.archived);
  const archived = ads.campaigns.filter((c) => c.archived);
  const input = 'w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm outline-none focus:border-accent/60';

  return (
    <div>
      <Label className="mt-8 scroll-mt-4" id="ads">
        Реклама
      </Label>
      <Card className="mt-2">
        <div className="text-sm font-semibold">Новая ссылка для объявления</div>
        <p className="mt-1 text-xs text-muted">Для каждого объявления или креатива — своя ссылка: так видно, какое работает лучше.</p>
        <input
          className={`mt-3 ${input}`}
          placeholder="Например: VK · осень · пара на кухне"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {SOURCES.map((s) => (
            <Chip key={s} active={source === s} onClick={() => setSource(s)}>
              {s}
            </Chip>
          ))}
        </div>
        <input
          className={`mt-2 ${input}`}
          inputMode="numeric"
          placeholder="Бюджет, ₽ — необязательно"
          value={budget}
          onChange={(e) => setBudget(e.target.value.replace(/\D/g, ''))}
        />
        <Button className="mt-3 w-full" onClick={create} disabled={busy || !name.trim()}>
          Создать ссылку
        </Button>
        {created && (
          <div className="mt-3 rounded-xl bg-sage/10 px-3 py-2 text-xs">
            <div className="text-sage">Готово — вставьте в объявление:</div>
            <div className="mt-1 select-all break-all text-sm">{created}</div>
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted">
          Если рекламный кабинет сам добавляет utm-метки (Директ, VK Реклама), кампании появятся здесь автоматически с пометкой «по utm-меткам».
        </p>
      </Card>

      <div className="mt-3 space-y-3">
        {active.map((c) => (
          <CampaignCard key={c.id} c={c} statsKey={statsKey} onChanged={onChanged} />
        ))}
        {active.length === 0 && <p className="text-sm text-muted">Пока нет кампаний.</p>}
      </div>

      <div className="mt-3 rounded-2xl border border-dashed border-line px-4 py-3 text-xs text-muted">
        Для сравнения, без рекламы за {periodDays} дн.: регистраций <span className="text-text">{o.signups}</span> · пар{' '}
        <span className="text-text">{o.pairs}</span> ({pctOf(o.pairs, o.signups)}) · с раскрытием {o.revealed} · активны {o.active7}
        {o.week2Base ? ` · 2-я неделя ${o.week2} из ${o.week2Base}` : ''}
      </div>

      {archived.length > 0 && (
        <div className="mt-3">
          <button className="text-xs text-muted" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Скрыть архив' : `Архив · ${archived.length}`}
          </button>
          {showArchived && (
            <div className="mt-2 space-y-3">
              {archived.map((c) => (
                <CampaignCard key={c.id} c={c} statsKey={statsKey} onChanged={onChanged} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
