import { all, one } from './db.js';
import { addDays } from './time.js';
import { notExcluded } from './pmf.js';

export interface StatsResponse {
  generatedAt: string;
  periodDays: number;
  totals: {
    users: number;
    pairsComplete: number;
    pairsGuest: number;
    pairsSolo: number;
    pushSubscribed: number;
  };
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
  };
  kFactor: {
    sharesPerUser: number;
    conversion: number;
    k: number;
  };
  closeness: {
    daysBothShare: number | null;
    revealsWithWhyShare: number | null;
    gesturesPerPairWeek: number | null;
    activePairs: number;
  };
  daily: Array<{ date: string; answers: number; reveals: number; gestures: number; users: number }>;
  push: {
    subscriptions: Array<{ service: string; n: number }>;
    recent: Array<{ at: string; kind: string; service: string; status: number; ok: boolean; reason: string | null }>;
    sent: number;
    failed: number;
  };
}

function count(type: string, since: string): number {
  return Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM events WHERE type = ? AND created_at >= ? AND ${notExcluded('pair_id')}`, type, since)?.n ?? 0);
}

export function computeStats(periodDays = 30): StatsResponse {
  const today = new Date().toISOString().slice(0, 10);
  const sinceDate = addDays(today, -periodDays);
  const since = `${sinceDate}T00:00:00.000Z`;

  const users = Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE ${notExcluded('pair_id')}`)?.n ?? 0);
  const pairsComplete = Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM (SELECT pair_id FROM users WHERE ${notExcluded('pair_id')} GROUP BY pair_id HAVING COUNT(*) >= 2)`)?.n ?? 0);
  const pairsGuest = Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM pairs WHERE is_guest = 1 AND ${notExcluded('id')}`)?.n ?? 0);
  const pairsSolo = Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM (SELECT pair_id FROM users WHERE ${notExcluded('pair_id')} GROUP BY pair_id HAVING COUNT(*) = 1)`)?.n ?? 0);
  const pushSubscribed = Number(one<{ n: number }>(`SELECT COUNT(DISTINCT s.user_id) AS n FROM push_subscriptions s JOIN users u ON u.id = s.user_id WHERE ${notExcluded('u.pair_id')}`)?.n ?? 0);

  const funnel = {
    invitesSent: count('invite_sent', since),
    invitesOpened: count('invite_opened', since),
    invitesAccepted: count('invite_accepted', since),
    challengesSent: count('challenge_sent', since),
    challengesOpened: count('challenge_opened', since),
    challengePairsCreated: count('challenge_pair_created', since),
    challengesConverted: count('challenge_converted', since),
    weeklyShared: count('weekly_shared', since),
    weeklyOpened: count('weekly_opened', since),
    landingInstallShown: count('landing_install_shown', since),
    landingBrowser: count('landing_browser', since),
    desktopQrShown: count('desktop_qr_shown', since),
    qrOpened: count('qr_open', since),
    standaloneLaunch: count('standalone_launch', since),
    handoffRedeemed: count('handoff_redeemed', since) + count('login_code_redeemed', since),
    refShared: count('ref_shared', since),
    refOpened: count('ref_opened', since),
    refSignups: count('ref_signup', since),
  };

  const usersInPeriod = Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE created_at >= ? AND ${notExcluded('pair_id')}`, since)?.n ?? 0) || users;
  const shares = funnel.invitesSent + funnel.challengesSent + funnel.weeklyShared + funnel.refShared;
  const converted = funnel.invitesAccepted + funnel.challengePairsCreated * 2 + funnel.refSignups;
  const sharesPerUser = usersInPeriod ? shares / usersInPeriod : 0;
  const conversion = shares ? converted / shares : 0;
  const kFactor = { sharesPerUser: round(sharesPerUser), conversion: round(conversion), k: round(sharesPerUser * conversion) };

  // Близость: только полные пары, последние periodDays дней.
  const completePairs = all<{ pair_id: string }>(`SELECT pair_id FROM users WHERE ${notExcluded('pair_id')} GROUP BY pair_id HAVING COUNT(*) >= 2`).map((r) => r.pair_id);
  let daysAny = 0;
  let daysBoth = 0;
  let revealedAnswers = 0;
  let withWhy = 0;
  let gestures = 0;
  let activePairs = 0;
  for (const pid of completePairs) {
    const rows = all<{ date: string; n: number }>(
      `SELECT r.date AS date, COUNT(DISTINCT a.user_id) AS n FROM rounds r JOIN answers a ON a.round_id = r.id
        WHERE r.pair_id = ? AND r.kind != 'challenge' AND r.date >= ? GROUP BY r.date`,
      pid,
      sinceDate,
    );
    if (rows.length === 0) continue;
    activePairs++;
    daysAny += rows.length;
    daysBoth += rows.filter((r) => Number(r.n) >= 2).length;
    const w = one<{ total: number; why: number }>(
      `SELECT COUNT(*) AS total, SUM(CASE WHEN a.why_text IS NOT NULL OR a.why_chip IS NOT NULL THEN 1 ELSE 0 END) AS why
         FROM answers a JOIN rounds r ON r.id = a.round_id WHERE r.pair_id = ? AND r.status = 'revealed' AND r.date >= ?`,
      pid,
      sinceDate,
    );
    revealedAnswers += Number(w?.total ?? 0);
    withWhy += Number(w?.why ?? 0);
    gestures += Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM gestures WHERE pair_id = ? AND created_at >= ?', pid, since)?.n ?? 0);
  }
  const weeks = periodDays / 7;
  const closeness = {
    daysBothShare: daysAny ? round(daysBoth / daysAny) : null,
    revealsWithWhyShare: revealedAnswers ? round(withWhy / revealedAnswers) : null,
    gesturesPerPairWeek: activePairs ? round(gestures / activePairs / weeks) : null,
    activePairs,
  };

  const daily: StatsResponse['daily'] = [];
  for (let i = Math.min(periodDays, 30) - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    const from = `${d}T00:00:00.000Z`;
    const to = `${addDays(d, 1)}T00:00:00.000Z`;
    const ev = (type: string) => Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM events WHERE type = ? AND created_at >= ? AND created_at < ? AND ${notExcluded('pair_id')}`, type, from, to)?.n ?? 0);
    const u = Number(one<{ n: number }>(`SELECT COUNT(DISTINCT user_id) AS n FROM events WHERE user_id IS NOT NULL AND created_at >= ? AND created_at < ? AND ${notExcluded('pair_id')}`, from, to)?.n ?? 0);
    daily.push({ date: d, answers: ev('answer'), reveals: ev('reveal'), gestures: ev('gesture_sent'), users: u });
  }

  const subsRows = all<{ endpoint: string }>('SELECT endpoint FROM push_subscriptions');
  const bySvc = new Map<string, number>();
  for (const r of subsRows) {
    let svc = 'unknown';
    try {
      const h = new URL(r.endpoint).hostname;
      svc = h.endsWith('push.apple.com') ? 'apple' : h.endsWith('googleapis.com') ? 'google' : h.includes('mozilla') ? 'mozilla' : h;
    } catch {
      /* пусто */
    }
    bySvc.set(svc, (bySvc.get(svc) ?? 0) + 1);
  }
  const recent = all<{ created_at: string; kind: string; service: string; status: number; ok: number; reason: string | null }>(
    'SELECT * FROM push_log ORDER BY id DESC LIMIT 30',
  ).map((r) => ({ at: r.created_at, kind: r.kind, service: r.service, status: r.status, ok: !!r.ok, reason: r.reason }));
  const push = {
    subscriptions: [...bySvc.entries()].map(([service, n]) => ({ service, n })),
    recent,
    sent: Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM push_log WHERE ok = 1 AND created_at >= ?', since)?.n ?? 0),
    failed: Number(one<{ n: number }>('SELECT COUNT(*) AS n FROM push_log WHERE ok = 0 AND created_at >= ?', since)?.n ?? 0),
  };

  return {
    push,
    generatedAt: new Date().toISOString(),
    periodDays,
    totals: { users, pairsComplete, pairsGuest, pairsSolo, pushSubscribed },
    funnel,
    kFactor,
    closeness,
    daily,
  };
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
