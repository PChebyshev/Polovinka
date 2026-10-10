export type Layer = 'light' | 'us' | 'deep';
export type QuestionFormat = 'ab' | 'scale' | 'who' | 'from_partner';
export type Choice = 'a' | 'b';
export type GestureType = 'thanks' | 'thinking' | 'proud';
export type RoundKind = 'daily' | 'bonus' | 'challenge';

export interface Question {
  id: string;
  layer: Layer;
  category: string;
  format: QuestionFormat;
  /** Текст с плейсхолдерами {me} и {partner}. */
  text: string;
  a: string;
  b: string;
  whyChips?: string[];
  topic?: string;
  /** Свой вопрос пары. */
  pairId?: string | null;
  authorId?: string | null;
}

export interface UserPublic {
  id: string;
  name: string;
  tz: string;
  notifMorning: string;
  notifEvening: string;
  notifEnabled: boolean;
  createdAt: string;
}

export interface PairPublic {
  id: string;
  tz: string;
  createdAt: string;
  isGuest: boolean;
}

export interface Counters {
  discoveries: number;
  matches: number;
  guessesRight: number;
  daysTogether: number;
  gestures: number;
}

export interface AnswerPublic {
  userId: string;
  choice: string;
  guess: string | null;
  whyText: string | null;
  whyChip: string | null;
  createdAt: string;
}

export interface RoundPublic {
  id: string;
  kind: RoundKind;
  date: string;
  status: 'open' | 'revealed';
  revealedAt: string | null;
  question: {
    id: string;
    layer: Layer;
    category: string;
    format: QuestionFormat;
    text: string;
    a: string;
    b: string;
    whyChips: string[];
    topic: string | null;
    isCustom: boolean;
  };
  /** Мой ответ, если есть. */
  mine: AnswerPublic | null;
  /** Ответил ли партнёр. */
  partnerAnswered: boolean;
  /** Ответ партнёра, виден только после раскрытия. */
  partner: AnswerPublic | null;
}

export interface GesturePublic {
  id: string;
  fromUserId: string;
  toUserId: string;
  type: GestureType;
  text: string;
  createdAt: string;
  seenAt: string | null;
}

export interface MeResponse {
  user: UserPublic;
  pair: PairPublic;
  partner: UserPublic | null;
  counters: Counters;
  inviteCode: string;
  unseenGestures: GesturePublic[];
}

export interface TodayResponse {
  date: string;
  daily: RoundPublic;
  bonus: RoundPublic[];
  bonusLeft: number;
  /** Старые раунды, где партнёр ждёт мой ответ. */
  pending: RoundPublic[];
}

export type ServerEvent =
  | { type: 'pair_joined'; partnerName: string }
  | { type: 'partner_answered'; roundId: string }
  | { type: 'revealed'; roundId: string }
  | { type: 'why_added'; roundId: string }
  | { type: 'bonus_added'; roundId: string }
  | { type: 'gesture'; gesture: GesturePublic }
  | { type: 'history_deleted' }
  | { type: 'ping' };

export const GESTURE_LABELS: Record<GestureType, string> = {
  thanks: 'Спасибо за…',
  thinking: 'Думаю о тебе',
  proud: 'Горжусь тобой',
};

export const GESTURE_CHIPS: Record<GestureType, string[]> = {
  thanks: ['…утренний кофе', '…что выслушал(а)', '…вчерашний вечер', '…что ты рядом', '…терпение', '…смех'],
  thinking: ['Скучаю', 'Хочу обнять', 'Жду вечера', 'Ты сейчас где-то там, а я тут улыбаюсь', 'Вспомнил(а) тебя — и стало теплее'],
  proud: ['Ты справляешься', 'Вижу, как ты стараешься', 'Ты сегодня молодец', 'Горжусь тем, какой(ая) ты', 'Ты сильнее, чем думаешь'],
};
