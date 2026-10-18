import { enqueue } from './queue';
import type { BookResponse, CapsulePublic, CareHint, Idea, MemoryCard, PairStage, RoundIdea, TopicProgress } from '@polovinka/shared';
import type { ChallengeCompare, ChallengeInfo, CustomQuestion, GesturePublic, GestureTemplate, HistoryResponse, MeResponse, RoundPublic, TodayResponse, WeekPublic, WeekResponse } from '@polovinka/shared';

const TOKEN_KEY = 'polovinka.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* приватный режим */
  }
}

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
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
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    if (opts.queue && body !== undefined) {
      await enqueue({ method: method as 'POST', path, body: JSON.stringify(body) });
      void track('offline_queued');
      throw new QueuedError();
    }
    throw e;
  }
  lastFromCache = res.headers.get('x-sw-cache') === '1';
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
  return (await res.json()) as T;
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
    request<{ token: string; me: MeResponse }>('POST', '/api/users', { name, tz: deviceTz(), joinCode, challengeCode, ref }),
  recommend: () => request<{ code: string; url: string; host: string; image: string; title: string; description: string }>('GET', '/api/recommend'),
  recommendSent: (via: string, variant: string) => request<{ ok: true }>('POST', '/api/recommend/sent', { via, variant }),
  recommendInfo: (code: string) => request<{ names: string[]; days: number }>('GET', `/api/recommend/${encodeURIComponent(code)}`),
  me: () => request<MeResponse>('GET', '/api/me'),
  updateMe: (patch: { name?: string; notifMorning?: string; notifEvening?: string; notifEnabled?: boolean; tz?: string }) => request<MeResponse>('PUT', '/api/me', patch),
  invite: () => request<{ code: string; url: string; text: string }>('GET', '/api/invite'),
  inviteSent: (via: string) => request<{ ok: true }>('POST', '/api/invite/sent', { via }),
  inviteInfo: (code: string) => request<{ inviterName: string | null; full: boolean; alreadyMember: boolean }>('GET', `/api/invite/${encodeURIComponent(code)}`),
  join: (code: string) => request<MeResponse>('POST', '/api/pair/join', { code }),
  today: () => request<TodayResponse>('GET', '/api/today'),
  round: (id: string) => request<RoundPublic>('GET', `/api/rounds/${id}`),
  answer: (roundId: string, choice: string, guess: string | null, cid: string) =>
    request<RoundPublic>('POST', `/api/rounds/${roundId}/answer`, { choice, guess, clientId: cid }, { queue: true }),
  why: (roundId: string, data: { whyText?: string; whyChip?: string }) => request<RoundPublic>('POST', `/api/rounds/${roundId}/why`, data, { queue: true }),
  topicOpened: (roundId: string) => request<{ ok: true }>('POST', `/api/rounds/${roundId}/topic-opened`),
  bonus: () => request<RoundPublic>('POST', '/api/rounds/bonus'),
  mark: (questionId: string) => request<{ ok: true }>('POST', `/api/questions/${questionId}/mark`),
  nudge: () => request<{ text: string; url: string; firstToday: boolean }>('POST', '/api/nudge'),
  sendGesture: (type: string, text: string, cid: string) => request<GesturePublic>('POST', '/api/gestures', { type, text, clientId: cid }, { queue: true }),
  gestures: () => request<{ gestures: GesturePublic[] }>('GET', '/api/gestures'),
  gestureSeen: (id: string) => request<{ ok: true }>('POST', `/api/gestures/${id}/seen`),
  deleteHistory: () => request<{ ok: true }>('DELETE', '/api/pair/history'),
  // Этап 2
  history: (before?: string | null, favorites = false, only?: 'rounds' | 'gestures') =>
    request<HistoryResponse>('GET', `/api/history?limit=30${before ? `&before=${encodeURIComponent(before)}` : ''}${favorites ? '&favorites=1' : ''}${only ? `&only=${only}` : ''}`),
  toggleFavorite: (kind: 'round' | 'gesture', refId: string) => request<{ favorite: boolean }>('POST', '/api/favorites/toggle', { kind, refId }),
  milestoneSeen: (key: string) => request<{ ok: true }>('POST', `/api/milestones/${encodeURIComponent(key)}/seen`),
  skipRound: (roundId: string) => request<{ replaced: boolean; round: RoundPublic }>('POST', `/api/rounds/${roundId}/skip`),
  customQuestions: () => request<{ questions: CustomQuestion[] }>('GET', '/api/questions/custom'),
  addQuestion: (data: { text: string; a: string; b: string; layer: string; topic?: string }) => request<CustomQuestion>('POST', '/api/questions', data),
  deleteQuestion: (id: string) => request<{ ok: true }>('DELETE', `/api/questions/${id}`),
  addTemplate: (type: string, text: string) => request<{ templates: GestureTemplate[] }>('POST', '/api/gesture-templates', { type, text }),
  deleteTemplate: (id: string) => request<{ templates: GestureTemplate[] }>('DELETE', `/api/gesture-templates/${id}`),
  setTheme: (theme: string | null) => request<MeResponse>('PUT', '/api/pair/theme', { theme }),
  // Этап 3
  week: (offset = 0) => request<WeekResponse>('GET', `/api/week?offset=${offset}`),
  weekPublic: (code: string) => request<WeekPublic>('GET', `/api/week/public/${encodeURIComponent(code)}`),
  weekShared: (via: string) => request<{ ok: true }>('POST', `/api/week/x/shared`, { via }),
  uploadWeekImage: async (code: string, blob: Blob) => {
    const token = getToken();
    const res = await fetch(`/api/week/${code}/image`, { method: 'POST', headers: { 'content-type': 'image/png', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: blob });
    if (!res.ok) throw new ApiError(res.status, 'upload');
  },
  createChallenge: () => request<{ code: string; url: string; text: string; compare: ChallengeCompare }>('POST', '/api/challenges'),
  challengeInfo: (code: string) => request<ChallengeInfo>('GET', `/api/challenges/${encodeURIComponent(code)}`),
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
  memory: () => request<{ memory: MemoryCard | null }>('GET', '/api/memory'),
  setProfile: (patch: { stage?: PairStage | null; hasKids?: boolean | null }) => request<MeResponse>('PUT', '/api/pair/profile', patch),
  setPrefs: (patch: { intimacy?: boolean; careHints?: boolean }) => request<MeResponse>('PUT', '/api/me/prefs', patch),
  roundIdeas: (roundId: string) => request<{ ideas: RoundIdea[]; source: string; saved: boolean[] }>('GET', `/api/rounds/${roundId}/ideas`),
  ideas: () => request<{ ideas: Idea[] }>('GET', '/api/ideas'),
  addIdea: (text: string, kind: 'do' | 'talk' = 'do', roundId?: string) => request<Idea>('POST', '/api/ideas', { text, kind, roundId }),
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
  pushTest: () => request<{ sent: number; failed: number; statuses: number[]; reasons?: string[]; tooSoon?: boolean; disabled?: boolean }>('POST', '/api/push/test'),
  stats: (key: string, days: number) => request<StatsResponse>('GET', `/api/stats?key=${encodeURIComponent(key)}&days=${days}`),
};

export interface AppConfig {
  emailLogin: boolean;
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

export interface StatsResponse {
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
