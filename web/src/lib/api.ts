import type { GesturePublic, MeResponse, RoundPublic, TodayResponse } from '@polovinka/shared';

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

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
  createUser: (name: string, joinCode?: string) => request<{ token: string; me: MeResponse }>('POST', '/api/users', { name, tz: deviceTz(), joinCode }),
  me: () => request<MeResponse>('GET', '/api/me'),
  updateMe: (patch: { name?: string; notifMorning?: string; notifEvening?: string; notifEnabled?: boolean; tz?: string }) => request<MeResponse>('PUT', '/api/me', patch),
  invite: () => request<{ code: string; url: string; text: string }>('GET', '/api/invite'),
  inviteSent: (via: string) => request<{ ok: true }>('POST', '/api/invite/sent', { via }),
  inviteInfo: (code: string) => request<{ inviterName: string | null; full: boolean; alreadyMember: boolean }>('GET', `/api/invite/${encodeURIComponent(code)}`),
  join: (code: string) => request<MeResponse>('POST', '/api/pair/join', { code }),
  today: () => request<TodayResponse>('GET', '/api/today'),
  round: (id: string) => request<RoundPublic>('GET', `/api/rounds/${id}`),
  answer: (roundId: string, choice: 'a' | 'b', guess: 'a' | 'b' | null, cid: string) =>
    request<RoundPublic>('POST', `/api/rounds/${roundId}/answer`, { choice, guess, clientId: cid }),
  why: (roundId: string, data: { whyText?: string; whyChip?: string }) => request<RoundPublic>('POST', `/api/rounds/${roundId}/why`, data),
  topicOpened: (roundId: string) => request<{ ok: true }>('POST', `/api/rounds/${roundId}/topic-opened`),
  bonus: () => request<RoundPublic>('POST', '/api/rounds/bonus'),
  mark: (questionId: string) => request<{ ok: true }>('POST', `/api/questions/${questionId}/mark`),
  nudge: () => request<{ text: string; url: string; firstToday: boolean }>('POST', '/api/nudge'),
  sendGesture: (type: string, text: string, cid: string) => request<GesturePublic>('POST', '/api/gestures', { type, text, clientId: cid }),
  gestures: () => request<{ gestures: GesturePublic[] }>('GET', '/api/gestures'),
  gestureSeen: (id: string) => request<{ ok: true }>('POST', `/api/gestures/${id}/seen`),
  deleteHistory: () => request<{ ok: true }>('DELETE', '/api/pair/history'),
};
