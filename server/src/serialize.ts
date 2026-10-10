import type { AnswerPublic, Counters, GesturePublic, Layer, PairPublic, QuestionFormat, RoundPublic, UserPublic } from '../../shared/src/types.js';
import { renderText } from '../../shared/src/text.js';
import { all, one, type AnswerRow, type GestureRow, type PairRow, type QuestionRow, type RoundRow, type UserRow } from './db.js';

export const DEFAULT_WHY_CHIPS: Record<string, string[]> = {
  food: ['Просто вкуснее', 'Привычка с детства', 'Настроение такое', 'Так уютнее', 'Не могу объяснить, но да'],
  rest: ['Так отдыхаю лучше', 'Хочется движения', 'Хочется тишины', 'Давно не делали', 'Это весело'],
  home: ['Так уютнее', 'Привычка', 'Так удобнее', 'Так меньше хлопот', 'Не могу объяснить, но да'],
  weird: ['Это весело', 'Звучит как приключение', 'Так безопаснее', 'Представил(а) и улыбнулся(ась)', 'Интуиция'],
  whatif: ['Давно мечтаю', 'Звучит как приключение', 'Так спокойнее', 'Это про нас', 'Интуиция'],
  memories: ['Так и было', 'Это точно про нас', 'Вспомнил(а) один момент', 'Сердце подсказало'],
  habits: ['Так и есть', 'Это точно про нас', 'Хотелось бы чаще', 'Сердце подсказало'],
  joy: ['Так теплее', 'Это про нас', 'Хотелось бы чаще', 'Вспомнил(а) один момент', 'Сердце подсказало'],
  dreams: ['Давно об этом думаю', 'Это важно для меня', 'Представил(а) и захотелось', 'Сложно словами, обсудим'],
  values: ['Так я чувствую', 'Это важно для меня', 'Так было в детстве', 'Понял(а) это недавно', 'Сложно словами, обсудим'],
  support: ['Так мне легче', 'Проверено на опыте', 'Понял(а) это недавно', 'Сложно словами, обсудим'],
  light: ['Просто так', 'Настроение такое', 'Это весело', 'Не могу объяснить, но да'],
  us: ['Так и есть', 'Это точно про нас', 'Сердце подсказало'],
  deep: ['Так я чувствую', 'Это важно для меня', 'Сложно словами, обсудим'],
};

export function userPublic(u: UserRow): UserPublic {
  return {
    id: u.id,
    name: u.name,
    tz: u.tz,
    notifMorning: u.notif_morning,
    notifEvening: u.notif_evening,
    notifEnabled: !!u.notif_enabled,
    createdAt: u.created_at,
  };
}

export function pairPublic(p: PairRow): PairPublic {
  return { id: p.id, tz: p.tz, createdAt: p.created_at, isGuest: !!p.is_guest };
}

export function answerPublic(a: AnswerRow): AnswerPublic {
  return {
    userId: a.user_id,
    choice: a.choice,
    guess: a.guess,
    whyText: a.why_text,
    whyChip: a.why_chip,
    createdAt: a.created_at,
  };
}

export function gesturePublic(g: GestureRow): GesturePublic {
  return {
    id: g.id,
    fromUserId: g.from_user_id,
    toUserId: g.to_user_id,
    type: g.type as GesturePublic['type'],
    text: g.text,
    createdAt: g.created_at,
    seenAt: g.seen_at,
  };
}

export function partnerOf(user: UserRow): UserRow | undefined {
  return one<UserRow>('SELECT * FROM users WHERE pair_id = ? AND id != ? LIMIT 1', user.pair_id, user.id);
}

export function roundPublic(round: RoundRow, viewer: UserRow, partner: UserRow | undefined): RoundPublic {
  const q = one<QuestionRow>('SELECT * FROM questions WHERE id = ?', round.question_id)!;
  const answers = all<AnswerRow>('SELECT * FROM answers WHERE round_id = ?', round.id);
  const mine = answers.find((a) => a.user_id === viewer.id);
  const theirs = partner ? answers.find((a) => a.user_id === partner.id) : undefined;
  const me = viewer.name;
  const them = partner?.name ?? 'половинка';
  const chips = q.why_chips ? (JSON.parse(q.why_chips) as string[]) : DEFAULT_WHY_CHIPS[q.category] ?? DEFAULT_WHY_CHIPS[q.layer] ?? DEFAULT_WHY_CHIPS.light;
  return {
    id: round.id,
    kind: round.kind as RoundPublic['kind'],
    date: round.date,
    status: round.status as RoundPublic['status'],
    revealedAt: round.revealed_at,
    question: {
      id: q.id,
      layer: q.layer as Layer,
      category: q.category,
      format: q.format as QuestionFormat,
      text: renderText(q.text, me, them),
      a: renderText(q.a, me, them),
      b: renderText(q.b, me, them),
      whyChips: chips,
      topic: q.topic ? renderText(q.topic, me, them) : null,
      isCustom: !!q.pair_id,
    },
    mine: mine ? answerPublic(mine) : null,
    partnerAnswered: !!theirs,
    partner: round.status === 'revealed' && theirs ? answerPublic(theirs) : null,
  };
}

export function counters(pairId: string): Counters {
  const discoveries = one<{ n: number }>(`SELECT COUNT(*) AS n FROM rounds WHERE pair_id = ? AND status = 'revealed' AND kind != 'challenge'`, pairId);
  const matches = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM rounds r
      WHERE r.pair_id = ? AND r.status = 'revealed' AND r.kind != 'challenge'
        AND (SELECT COUNT(DISTINCT choice) FROM answers WHERE round_id = r.id) = 1`,
    pairId,
  );
  const guesses = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM answers a
       JOIN rounds r ON r.id = a.round_id
       JOIN answers p ON p.round_id = r.id AND p.user_id != a.user_id
      WHERE r.pair_id = ? AND r.status = 'revealed' AND a.guess IS NOT NULL AND a.guess = p.choice`,
    pairId,
  );
  const days = one<{ n: number }>(
    `SELECT COUNT(DISTINCT r.date) AS n FROM rounds r JOIN answers a ON a.round_id = r.id WHERE r.pair_id = ?`,
    pairId,
  );
  const gestures = one<{ n: number }>('SELECT COUNT(*) AS n FROM gestures WHERE pair_id = ?', pairId);
  return {
    discoveries: Number(discoveries?.n ?? 0),
    matches: Number(matches?.n ?? 0),
    guessesRight: Number(guesses?.n ?? 0),
    daysTogether: Number(days?.n ?? 0),
    gestures: Number(gestures?.n ?? 0),
  };
}
