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
  level: number;
  /** Открытий до следующего уровня; null на последнем. */
  nextLevelAt: number | null;
  levelStartAt: number;
}

export interface Celebration {
  key: string;
  title: string;
  subtitle: string;
}

export interface CustomQuestion {
  id: string;
  text: string;
  a: string;
  b: string;
  layer: Layer;
  topic: string | null;
  authorId: string;
  createdAt: string;
  used: boolean;
}

export interface GestureTemplate {
  id: string;
  type: GestureType;
  text: string;
  createdAt: string;
}

export interface HistoryRound {
  type: 'round';
  at: string;
  round: RoundPublic;
  favoriteMine: boolean;
  favoritePartner: boolean;
}

export interface HistoryGesture {
  type: 'gesture';
  at: string;
  gesture: GesturePublic;
  favoriteMine: boolean;
  favoritePartner: boolean;
}

export type HistoryItem = HistoryRound | HistoryGesture;

export interface HistoryResponse {
  items: HistoryItem[];
  nextBefore: string | null;
}

export const LEVELS = [0, 5, 10, 25, 50, 100, 200, 365];

export const CATEGORY_LABELS: Record<string, string> = {
  food: 'Еда',
  rest: 'Отдых',
  home: 'Быт',
  weird: 'Странное',
  whatif: 'А если бы',
  memories: 'Воспоминания',
  habits: 'Привычки',
  joy: 'Что радует',
  dreams: 'Мечты',
  values: 'Ценности',
  support: 'Поддержка',
};

export const LAYER_LABELS: Record<Layer, string> = { light: 'Лёгкий', us: 'Про нас', deep: 'Поглубже' };

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
    /** Имя автора своего вопроса, если это не я. */
    authorName: string | null;
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
  celebrations: Celebration[];
  weekTheme: string | null;
  gestureTemplates: GestureTemplate[];
  challenges: MyChallenge[];
}

export interface TodayResponse {
  date: string;
  /** null у гостевой пары, пока она не стала постоянной. */
  daily: RoundPublic | null;
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
  | { type: 'round_replaced'; roundId: string }
  | { type: 'pair_updated' }
  | { type: 'challenge_update'; code: string }
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

// --- Этап 3 ---------------------------------------------------------------

export interface WeekStats {
  weekStart: string;
  weekEnd: string;
  discoveries: number;
  matches: number;
  matchPercent: number | null;
  guessesRight: number;
  daysBoth: number;
  gestures: number;
}

export interface WeekResponse {
  code: string;
  names: [string, string | null];
  stats: WeekStats;
  isCurrent: boolean;
  hasImage: boolean;
}

export interface WeekPublic {
  names: [string, string | null];
  stats: WeekStats;
  hasImage: boolean;
}

export interface ChallengeQuestionCompare {
  questionId: string;
  text: string;
  a: string;
  b: string;
  /** Выборы каждой пары: [первый, второй] либо null, пока пара не раскрыла. */
  mine: [string, string] | null;
  theirs: [string, string] | null;
  mineMatch: boolean | null;
  theirsMatch: boolean | null;
  /** Все четверо выбрали одно и то же. */
  allSame: boolean | null;
}

export interface ChallengeInfo {
  code: string;
  fromNames: [string, string | null];
  questionsCount: number;
  /** Я участник (отправитель или принявший). */
  participant: boolean;
  isSender: boolean;
}

export interface ChallengeCompare {
  code: string;
  myPairNames: [string, string | null];
  otherPairNames: [string, string | null] | null;
  isSender: boolean;
  /** Мои раунды вызова, которые ещё надо пройти. */
  rounds: RoundPublic[];
  questions: ChallengeQuestionCompare[];
  myDone: boolean;
  theirsDone: boolean;
  /** Сколько вопросов из N совпало у обеих пар. */
  bothSame: number;
}

export interface MyChallenge {
  code: string;
  isSender: boolean;
  fromNames: [string, string | null];
  answered: number;
  total: number;
  otherJoined: boolean;
}
