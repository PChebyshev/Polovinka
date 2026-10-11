import { enqueue } from './queue';
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
  createUser: (name: string, joinCode?: string, challengeCode?: string) =>
    request<{ token: string; me: MeResponse }>('POST', '/api/users', { name, tz: deviceTz(), joinCode, challengeCode }),
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
  history: (before?: string | null, favorites = false) =>
    request<HistoryResponse>('GET', `/api/history?limit=30${before ? `&before=${encodeURIComponent(before)}` : ''}${favorites ? '&favorites=1' : ''}`),
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
  stats: (key: string, days: number) => request<StatsResponse>('GET', `/api/stats?key=${encodeURIComponent(key)}&days=${days}`),
};

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
  };
  kFactor: { sharesPerUser: number; conversion: number; k: number };
  closeness: { daysBothShare: number | null; revealsWithWhyShare: number | null; gesturesPerPairWeek: number | null; activePairs: number };
  daily: Array<{ date: string; answers: number; reveals: number; gestures: number; users: number }>;
}
