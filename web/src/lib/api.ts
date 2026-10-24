import { enqueue } from './queue';
import { storedAttr } from './attr';
import type { BookResponse, CapsulePublic, CareHint, DigestResponse, Idea, MemoryCard, PairStage, RoundIdea, TopicProgress } from '@polovinka/shared';
import type {
  ChallengeCompare,
  ChallengeInfo,
  CustomQuestion,
  GesturePublic,
  GestureTemplate,
  HistoryResponse,
  MeResponse,
  RoundPublic,
  TodayResponse,
  WeekPublic,
  WeekResponse,
} from '@polovinka/shared';

const TOKEN_KEY = 'polovinka.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

const SNAPSHOT_KEY = 'polovinka.snapshot';
const SNAPSHOT_MAX_AGE = 7 * 86_400_000;

/** Последнее состояние (me + today) — чтобы приложение открывалось сразу, не дожидаясь сети. */
export function readSnapshot(): { me: MeResponse; today: TodayResponse | null } | null {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as { token: string; at: number; me: MeResponse; today: TodayResponse | null };
    if (s.token !== getToken() || Date.now() - s.at > SNAPSHOT_MAX_AGE) return null;
    return { me: s.me, today: s.today };
  } catch {
    return null;
  }
}

export function writeSnapshot(me: MeResponse, today: TodayResponse | null) {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ token: getToken(), at: Date.now(), me, today }));
  } catch {
    /* переполнено или приватный режим */
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(SNAPSHOT_KEY);
    }
  } catch {
    /* приватный режим */
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

/** Ошибка сети при запросе, который поставлен в офлайн-очередь. */
export class QueuedError extends Error {
  constructor() {
    super('queued');
  }
}

/** Последний GET-ответ пришёл из кэша service worker'а (нет сети). */
export let lastFromCache = false;

async function request<T>(method: string, path: string, body?: unknown, opts: { queue?: boolean } = {}): Promise<T> {
  return (await requestMeta<T>(method, path, body, opts)).data;
}

declare global {
  interface Window {
    /** index.html начинает грузить /api/me, пока едет скрипт приложения. */
    __polovinkaMe?: Promise<Response>;
  }
}

async function requestMeta<T>(method: string, path: string, body?: unknown, opts: { queue?: boolean } = {}): Promise<{ data: T; fromCache: boolean }> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    // /api/me мог начать грузиться ещё из index.html — берём тот ответ, если он есть
    const early = method === 'GET' && path === '/api/me' ? window.__polovinkaMe : undefined;
    if (early) window.__polovinkaMe = undefined;
    // Не ждать вечно: через VPN или на слабой сети лучше ошибка (и очередь для ответов), чем бесконечный спиннер
    res =
      (await early?.catch(() => undefined)) ??
      (await fetch(path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(method === 'GET' ? 25_000 : 20_000),
      }));
  } catch (e) {
    if (opts.queue && body !== undefined) {
      await enqueue({ method: method as 'POST', path, body: JSON.stringify(body) });
      void track('offline_queued');
      throw new QueuedError();
    }
    throw e;
  }
  const fromCache = res.headers.get('x-sw-cache') === '1';
  lastFromCache = fromCache;
  if (!res.ok) {
    let code = `http_${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j.error) code = j.error;
    } catch {
      /* пусто */
    }
    throw new ApiError(res.status, code);
  }
  return { data: (await res.json()) as T, fromCache };
}

/** me и today одним махом, параллельно: на медленной сети это вдвое быстрее, чем по очереди. */
export async function loadState(): Promise<{ me: MeResponse; meCached: boolean; today: TodayResponse | null; todayCached: boolean; todayError: unknown }> {
  const [m, t] = await Promise.all([
    requestMeta<MeResponse>('GET', '/api/me'),
    requestMeta<TodayResponse>('GET', '/api/today').then(
      (r) => ({ ok: true as const, r }),
      (e: unknown) => ({ ok: false as const, e }),
    ),
  ]);
  return { me: m.data, meCached: m.fromCache, today: t.ok ? t.r.data : null, todayCached: t.ok ? t.r.fromCache : false, todayError: t.ok ? null : t.e };
}

export function deviceTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Moscow';
  } catch {
    return 'Europe/Moscow';
  }
}

export function clientId(): string {
  if ('randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const api = {
  createUser: (name: string, joinCode?: string, challengeCode?: string, ref?: string) =>
    request<{ token: string; me: MeResponse }>('POST', '/api/users', { name, tz: deviceTz(), joinCode, challengeCode, ref, attr: storedAttr() ?? undefined }),
  createCampaign: (key: string, body: { name: string; source?: string; budget?: number }) =>
    request<{ code: string; url: string }>('POST', `/api/campaigns?key=${encodeURIComponent(key)}`, body),
  updateCampaign: (key: string, id: string, body: { name?: string; budget?: number | null; archived?: boolean }) =>
    request<{ ok: true }>('PUT', `/api/campaigns/${id}?key=${encodeURIComponent(key)}`, body),
  recommend: () => request<{ code: string; url: string; host: string; image: string; title: string; description: string }>('GET', '/api/recommend'),
  recommendSent: (via: string, variant: string) => request<{ ok: true }>('POST', '/api/recommend/sent', { via, variant }),
  recommendInfo: (code: string, peek = false) =>
    request<{ names: string[]; days: number }>('GET', `/api/recommend/${encodeURIComponent(code)}${peek ? '?peek=1' : ''}`),
  me: () => request<MeResponse>('GET', '/api/me'),
  updateMe: (patch: { name?: string; notifMorning?: string; notifEvening?: string; notifEnabled?: boolean; tz?: string }) =>
    request<MeResponse>('PUT', '/api/me', patch),
  invite: () => request<{ code: string; url: string; text: string }>('GET', '/api/invite'),
  inviteSent: (via: string) => request<{ ok: true }>('POST', '/api/invite/sent', { via }),
  inviteInfo: (code: string, peek = false) =>
    request<{ inviterName: string | null; full: boolean; alreadyMember: boolean }>('GET', `/api/invite/${encodeURIComponent(code)}${peek ? '?peek=1' : ''}`),
  join: (code: string) => request<MeResponse>('POST', '/api/pair/join', { code }),
  today: () => request<TodayResponse>('GET', '/api/today'),
  round: (id: string) => request<RoundPublic>('GET', `/api/rounds/${id}`),
  answer: (roundId: string, choice: string, guess: string | null, cid: string) =>
    request<RoundPublic>('POST', `/api/rounds/${roundId}/answer`, { choice, guess, clientId: cid }, { queue: true }),
  why: (roundId: string, data: { whyText?: string; whyChip?: string }) => request<RoundPublic>('POST', `/api/rounds/${roundId}/why`, data, { queue: true }),
  topicOpened: (roundId: string) => request<{ ok: true }>('POST', `/api/rounds/${roundId}/topic-opened`),
  bonus: () => request<RoundPublic>('POST', '/api/rounds/bonus'),
  mark: (questionId: string, reasons: string[] = [], comment?: string) =>
    request<{ ok: true }>('POST', `/api/questions/${questionId}/mark`, { reasons, comment }),
  nudge: () => request<{ text: string; url: string; firstToday: boolean }>('POST', '/api/nudge'),
  sendGesture: (type: string, text: string, cid: string) => request<GesturePublic>('POST', '/api/gestures', { type, text, clientId: cid }, { queue: true }),
  gestures: () => request<{ gestures: GesturePublic[] }>('GET', '/api/gestures'),
  gestureSeen: (id: string) => request<{ ok: true }>('POST', `/api/gestures/${id}/seen`),
  deleteHistory: () => request<{ ok: true }>('DELETE', '/api/pair/history'),
  // Этап 2
  history: (before?: string | null, favorites = false, only?: 'rounds' | 'gestures') =>
    request<HistoryResponse>(
      'GET',
      `/api/history?limit=30${before ? `&before=${encodeURIComponent(before)}` : ''}${favorites ? '&favorites=1' : ''}${only ? `&only=${only}` : ''}`,
    ),
  toggleFavorite: (kind: 'round' | 'gesture', refId: string) => request<{ favorite: boolean }>('POST', '/api/favorites/toggle', { kind, refId }),
  milestoneSeen: (key: string) => request<{ ok: true }>('POST', `/api/milestones/${encodeURIComponent(key)}/seen`),
  skipRound: (roundId: string, reasons: string[], comment?: string) =>
    request<{ replaced: boolean; round: RoundPublic }>('POST', `/api/rounds/${roundId}/skip`, { reasons, comment }),
  customQuestions: () => request<{ questions: CustomQuestion[] }>('GET', '/api/questions/custom'),
  addQuestion: (data: { text: string; a: string; b: string; layer: string; topic?: string }) => request<CustomQuestion>('POST', '/api/questions', data),
  deleteQuestion: (id: string) => request<{ ok: true }>('DELETE', `/api/questions/${id}`),
  addTemplate: (type: string, text: string) => request<{ templates: GestureTemplate[] }>('POST', '/api/gesture-templates', { type, text }),
  deleteTemplate: (id: string) => request<{ templates: GestureTemplate[] }>('DELETE', `/api/gesture-templates/${id}`),
  setTheme: (theme: string | null) => request<MeResponse>('PUT', '/api/pair/theme', { theme }),
  // Этап 3
  week: (offset = 0) => request<WeekResponse>('GET', `/api/week?offset=${offset}`),
  /** Без offset — самые свежие итоги (в воскресенье — этой недели). */
  weekDigest: (offset?: number) => request<DigestResponse>('GET', `/api/week/digest${offset === undefined ? '' : `?offset=${offset}`}`),
  weekPublic: (code: string) => request<WeekPublic>('GET', `/api/week/public/${encodeURIComponent(code)}`),
  weekShared: (via: string) => request<{ ok: true }>('POST', `/api/week/x/shared`, { via }),
  uploadWeekImage: async (code: string, blob: Blob) => {
    const token = getToken();
    const res = await fetch(`/api/week/${code}/image`, {
      method: 'POST',
      headers: { 'content-type': 'image/png', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: blob,
    });
    if (!res.ok) throw new ApiError(res.status, 'upload');
  },
  createChallenge: () => request<{ code: string; url: string; text: string; compare: ChallengeCompare }>('POST', '/api/challenges'),
  challengeInfo: (code: string, peek = false) => request<ChallengeInfo>('GET', `/api/challenges/${encodeURIComponent(code)}${peek ? '?peek=1' : ''}`),
  joinChallenge: (code: string) => request<ChallengeCompare>('POST', `/api/challenges/${encodeURIComponent(code)}/join`),
  challengeCompare: (code: string) => request<ChallengeCompare>('GET', `/api/challenges/${encodeURIComponent(code)}/compare`),
  convertPair: () => request<MeResponse>('POST', '/api/pair/convert'),
  // Этап 4
  track: (type: string) => track(type),
  pushKey: () => request<{ enabled: boolean; key: string }>('GET', '/api/push/key'),
  pushSubscribe: (sub: { endpoint: string; keys: { p256dh: string; auth: string } }) => request<{ ok: true }>('POST', '/api/push/subscribe', sub),
  pushUnsubscribe: (endpoint?: string) => request<{ ok: true }>('DELETE', '/api/push/subscribe', endpoint ? { endpoint } : {}),
  pushStatus: () => request<{ subscribed: boolean; endpoints: string[] }>('GET', '/api/push/status'),
  insights: () =>
    request<{
      since: string | null;
      weekly: Array<{ weekStart: string; discoveries: number; right: number; total: number }>;
      calendar: Array<{ date: string; state: 'both' | 'one' | 'none' | 'before' | 'future' }>;
      bestTopic: { key: string; label: string; right: number; total: number } | null;
      discoveryTopic: { key: string; label: string; right: number; total: number } | null;
      favorites: number;
    }>('GET', '/api/insights'),
  topics: () => request<{ level: number; topics: TopicProgress[] }>('GET', '/api/topics'),
  repeat: () => request<RoundPublic>('POST', '/api/rounds/repeat'),
  capsules: () => request<{ prompts: string[]; capsules: CapsulePublic[]; level: number; terms: number[]; canCreate: boolean }>('GET', '/api/capsules'),
  createCapsule: (prompt: string, days: number) => request<CapsulePublic>('POST', '/api/capsules', { prompt, days }),
  hideChallenge: (code: string) => request<MeResponse>('POST', `/api/challenges/${code}/hide`, {}),
  memory: () => request<{ memory: MemoryCard | null }>('GET', '/api/memory'),
  setProfile: (patch: { stage?: PairStage | null; hasKids?: boolean | null }) => request<MeResponse>('PUT', '/api/pair/profile', patch),
  setPrefs: (patch: { intimacy?: boolean; careHints?: boolean }) => request<MeResponse>('PUT', '/api/me/prefs', patch),
  roundIdeas: (roundId: string) => request<{ ideas: RoundIdea[]; source: string; saved: boolean[] }>('GET', `/api/rounds/${roundId}/ideas`),
  ideas: () => request<{ ideas: Idea[] }>('GET', '/api/ideas'),
  addIdea: (text: string, kind: 'do' | 'talk' = 'do', roundId?: string, date?: string | null) =>
    request<Idea>('POST', '/api/ideas', { text, kind, roundId, date: date ?? undefined }),
  planIdea: (id: string, date: string | null, time?: string | null) => request<Idea>('POST', `/api/ideas/${id}/plan`, { date, time: time ?? undefined }),
  doneIdea: (id: string, done = true) => request<Idea>('POST', `/api/ideas/${id}/done`, { done }),
  removeIdea: (id: string) => request<{ ok: true }>('DELETE', `/api/ideas/${id}`),
  careHint: () => request<{ hint: CareHint | null }>('GET', '/api/care-hint'),
  careSeen: (id: string) => request<{ ok: true }>('POST', `/api/care-hint/${id}/seen`, {}),
  personalStatus: () => request<{ available: boolean; minLevel: number }>('GET', '/api/rounds/personal'),
  personal: () => request<RoundPublic>('POST', '/api/rounds/personal', {}),
  book: () => request<BookResponse>('GET', '/api/book'),
  writeCapsule: (id: string, text: string) => request<CapsulePublic>('POST', `/api/capsules/${id}/letter`, { text }),
  readCapsule: (id: string) => request<{ ok: true }>('POST', `/api/capsules/${id}/read`, {}),
  createHandoff: () => request<{ code: string; expiresAt: string }>('POST', '/api/login-codes/handoff'),
  createLoginCode: () => request<{ code: string; expiresAt: string }>('POST', '/api/login-codes'),
  redeemLoginCode: (code: string) => request<{ token: string; me: MeResponse }>('POST', '/api/login-codes/redeem', { code }),
  config: () => request<AppConfig>('GET', '/api/config'),
  createRecovery: () => request<{ phrase: string; createdAt: string }>('POST', '/api/recovery'),
  redeemRecovery: (phrase: string) => request<{ token: string; me: MeResponse }>('POST', '/api/recovery/redeem', { phrase }),
  revokeSessions: () => request<{ token: string; me: MeResponse }>('POST', '/api/sessions/revoke'),
  emailBind: (email: string) => request<{ ok: true; email: string }>('POST', '/api/email/bind', { email }),
  emailConfirm: (email: string, code: string) => request<MeResponse>('POST', '/api/email/bind/confirm', { email, code }),
  emailRemove: () => request<MeResponse>('DELETE', '/api/email'),
  emailLogin: (email: string) => request<{ ok: true }>('POST', '/api/email/login', { email }),
  emailLoginConfirm: (email: string, code: string) => request<{ token: string; me: MeResponse }>('POST', '/api/email/login/confirm', { email, code }),
  pushTest: () =>
    request<{ sent: number; failed: number; statuses: number[]; reasons?: string[]; tooSoon?: boolean; disabled?: boolean }>('POST', '/api/push/test'),
  stats: (key: string, days: number) => request<StatsResponse>('GET', `/api/stats?key=${encodeURIComponent(key)}&days=${days}`),
  statsExcludeMe: (key: string) => request<{ ok: true }>('POST', `/api/stats/exclude-me?key=${encodeURIComponent(key)}`, {}),
  statsExclude: (key: string, pairId: string) => request<{ ok: true }>('POST', `/api/stats/exclude/${pairId}?key=${encodeURIComponent(key)}`, {}),
  statsInclude: (key: string, pairId: string) => request<{ ok: true }>('DELETE', `/api/stats/exclude/${pairId}?key=${encodeURIComponent(key)}`),
  netReport: (body: Record<string, unknown>) => request<{ ok: true }>('POST', '/api/net/report', body),
  needs: (ranks: string[], other?: string, gender?: 'm' | 'f') => request<MeResponse>('POST', '/api/needs', { ranks, other, gender }),
  survey: (body: { disappoint: 'very' | 'somewhat' | 'not'; benefit?: string; missing?: string }) => request<MeResponse>('POST', '/api/survey', body),
};

export interface AppConfig {
  emailLogin: boolean;
  emailRequired?: boolean;
  dataLocation: string | null;
  contact: string | null;
  operator: string | null;
  ai: string | null;
}

/** Скачать всю историю пары файлом JSON. */
export async function downloadExport(): Promise<'ok' | 'error'> {
  const token = getToken();
  try {
    const res = await fetch('/api/export', { headers: token ? { authorization: `Bearer ${token}` } : {} });
    if (!res.ok) return 'error';
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'polovinka.json';
    const file = new File([blob], name, { type: 'application/json' });
    // На телефоне удобнее системное меню «Сохранить в Файлы»
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Наша история · Половинка' });
        return 'ok';
      } catch (e) {
        if ((e as Error).name === 'AbortError') return 'ok';
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    return 'ok';
  } catch {
    return 'error';
  }
}

function track(type: string): Promise<unknown> {
  return request('POST', '/api/events', { type }).catch(() => undefined);
}

const SCREEN_EVERY_MS = 10 * 60_000;
/** Просмотр экрана для статистики: не чаще раза в 10 минут на экран. */
export function trackScreen(name: string) {
  try {
    const k = `polovinka.screen.${name}`;
    const last = Number(sessionStorage.getItem(k) ?? 0);
    if (Date.now() - last < SCREEN_EVERY_MS) return;
    sessionStorage.setItem(k, String(Date.now()));
  } catch {
    /* приватный режим — всё равно отправим */
  }
  void request('POST', '/api/events', { type: 'screen', name }).catch(() => undefined);
}

export interface PmfResponse {
  excluded: Array<{ pairId: string; names: string[] }>;
  week: {
    activePairs: number;
    completePairs: number;
    medianDaysActive: number | null;
    medianSessions: number | null;
    activeUsers: number;
    daysHistogram: number[];
    sessionsHistogram: Array<{ label: string; n: number }>;
  };
  weekly: Array<{ weekStart: string; activePairs: number; completePairs: number; sessions: number }>;
  features: Array<{
    key: string;
    label: string;
    pairs: number;
    share: number | null;
    events: number;
    liftUsers: number;
    liftUsed: number | null;
    liftOthers: number | null;
  }>;
  cohorts: Array<{ weekStart: string; size: number; weeks: Array<number | null> }>;
  activation: Array<[string, number]>;
  access: Array<[string, number]>;
  stages: Array<{ stage: string; pairs: number; activeShare: number | null; avgDays: number | null }>;
  needs: {
    responses: number;
    shown: number;
    items: Array<{ key: string; label: string; score: number; first: number; top3: number }>;
    byStage: Array<{ stage: string; responses: number; top: string[] }>;
    byGender: Array<{ gender: 'm' | 'f'; responses: number; items: Array<{ key: string; label: string; score: number; first: number; top3: number }> }>;
    texts: Array<{ at: string; stage: string; gender: string | null; text: string; first: string }>;
  };
  survey: {
    responses: number;
    shown: number;
    very: number;
    somewhat: number;
    not: number;
    veryShare: number | null;
    byStage: Array<{ stage: string; responses: number; veryShare: number | null }>;
    texts: Array<{ at: string; disappoint: string; stage: string; benefit: string | null; missing: string | null }>;
  };
  pairs: Array<{
    pairId: string;
    names: string[];
    joinedAt: string;
    stage: string | null;
    hasKids: boolean | null;
    daysActive7: number;
    sessions7: number;
    discoveries: number;
    lastActive: string | null;
    features: number;
  }>;
}

export interface CampaignStats {
  id: string;
  code: string;
  name: string;
  source: string | null;
  url: string;
  budget: number | null;
  auto: boolean;
  archived: boolean;
  createdAt: string;
  visits: number;
  installs: number;
  signups: number;
  pairs: number;
  revealed: number;
  week2: number;
  week2Base: number;
  active7: number;
  surveyVery: number;
  surveyResponses: number;
}

export interface StatsResponse {
  pmf: PmfResponse;
  netReports: Array<{
    at: string;
    rtt: number | null;
    ttfb: number | null;
    kbps: number | null;
    nav: number | null;
    sw: boolean;
    snapshot: boolean;
    standalone: boolean;
    conn: string | null;
    note: string | null;
    ua: string;
  }>;
  badQuestions: {
    total: number;
    reasons: Record<string, number>;
    top: Array<{ id: string; text: string; category: string; marks: number; pairs: number; reasons: Record<string, number>; comments: string[] }>;
  };
  backup: { enabled: boolean; lastAt: string | null; lastKey: string | null; lastSize: number | null; error: string | null; errorAt: string | null };
  ads: { campaigns: CampaignStats[]; organic: Omit<CampaignStats, 'id' | 'code' | 'url' | 'budget' | 'auto' | 'archived' | 'createdAt' | 'source' | 'name'> };
  generatedAt: string;
  periodDays: number;
  totals: { users: number; pairsComplete: number; pairsGuest: number; pairsSolo: number; pushSubscribed: number };
  funnel: {
    invitesSent: number;
    invitesOpened: number;
    invitesAccepted: number;
    challengesSent: number;
    challengesOpened: number;
    challengePairsCreated: number;
    challengesConverted: number;
    weeklyShared: number;
    weeklyOpened: number;
    landingInstallShown: number;
    landingBrowser: number;
    desktopQrShown: number;
    qrOpened: number;
    standaloneLaunch: number;
    handoffRedeemed: number;
    refShared: number;
    refOpened: number;
    refSignups: number;
  };
  kFactor: { sharesPerUser: number; conversion: number; k: number };
  closeness: { daysBothShare: number | null; revealsWithWhyShare: number | null; gesturesPerPairWeek: number | null; activePairs: number };
  daily: Array<{ date: string; answers: number; reveals: number; gestures: number; users: number }>;
  push: {
    subscriptions: Array<{ service: string; n: number }>;
    recent: Array<{ at: string; kind: string; service: string; status: number; ok: boolean; reason: string | null }>;
    sent: number;
    failed: number;
  };
}
