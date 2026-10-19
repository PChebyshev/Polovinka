export type Layer = 'light' | 'us' | 'deep';
export type QuestionFormat = 'ab' | 'scale' | 'who' | 'from_partner';
export type Choice = 'a' | 'b';
export type GestureType = 'thanks' | 'thinking' | 'proud' | 'hug';
export type RoundKind = 'daily' | 'bonus' | 'challenge' | 'repeat';

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
  /** Сколько вместе: lt1 | 1to3 | 3to10 | 10plus, null — ещё не ответили. */
  stage: PairStage | null;
  /** Есть ли дети: null — не ответили. */
  hasKids: boolean | null;
}

export type PairStage = 'lt1' | '1to3' | '3to10' | '10plus';

/** Личные настройки, которые влияют на вопросы и подсказки. */
export interface Prefs {
  /** Я согласен(на) на набор «Близость». */
  intimacy: boolean;
  /** Половинка согласна на набор «Близость». Набор включается, только когда оба «да». */
  partnerIntimacy: boolean;
  /** Можно подсказывать половинке, что меня радует. */
  careHints: boolean;
}

/** Идея после раскрытия: сделать что-то вместе или поговорить. */
export interface RoundIdea {
  kind: 'do' | 'talk';
  text: string;
}

/** Запись в списке «Хотим вместе». */
export interface Idea {
  id: string;
  text: string;
  kind: 'do' | 'talk';
  source: 'round' | 'manual' | 'ai';
  roundId: string | null;
  createdBy: string;
  createdAt: string;
  doneAt: string | null;
  /** Запланировано на дату YYYY-MM-DD (в часовом поясе пары). */
  plannedFor: string | null;
  /** Время HH:MM, необязательно. */
  plannedTime: string | null;
}

/** Подсказка заботы: что радует половинку, по её ответам. */
export interface CareHint {
  id: string;
  text: string;
  roundId: string;
}

export type StreakDay = 'done' | 'grace' | 'missed' | 'today' | 'before';

export interface Streak {
  current: number;
  best: number;
  todayDone: boolean;
  /** Последние 7 дней, от старого к сегодняшнему. */
  week: Array<{ date: string; state: StreakDay }>;
}

export interface TopicProgress {
  key: string;
  label: string;
  unlocked: boolean;
  unlockLevel: number;
  explored: number;
  right: number;
  total: number;
  badgeExplored: boolean;
  badgeKnow: boolean;
  /** Вопросов темы, которые ещё не задавали паре. */
  remaining: number;
}

export interface CapsuleLetterPublic {
  userId: string;
  text: string | null;
  createdAt: string;
}

export interface CapsulePublic {
  id: string;
  prompt: string;
  createdAt: string;
  opensAt: string;
  opened: boolean;
  /** Кто уже написал (до открытия текста не видно). */
  wroteIds: string[];
  letters: CapsuleLetterPublic[];
}

export interface Counters {
  discoveries: number;
  /** Раунды, где оба выбрали одно и то же. */
  matches: number;
  /** Угаданные выборы партнёра — из них считается «Совпадаем на X%». */
  guessesRight: number;
  guessesTotal: number;
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
  childhood: 'Детство',
  future: 'Наше будущее',
  again: 'Если бы встретились снова',
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
  money: 'Деньги',
  roles: 'Быт и роли',
  now: 'Что сейчас',
  parents: 'Мы родители',
  intimacy: 'Близость',
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
    /** 'ai' — вопрос составлен по истории ответов пары. */
    source: 'ai' | null;
  };
  /** Для «Повтора»: как пара ответила на этот вопрос в прошлый раз. */
  origin: { date: string; mine: AnswerPublic | null; partner: AnswerPublic | null } | null;
  /** Мой ответ, если есть. */
  mine: AnswerPublic | null;
  /** Ответил ли партнёр. */
  partnerAnswered: boolean;
  /** Ответ партнёра, виден только после раскрытия. */
  partner: AnswerPublic | null;
  /** Как ответили другие пары — только после раскрытия и если пар достаточно. */
  crowd: CrowdStats | null;
}

/**
 * Ответы других пар на тот же вопрос, без чьих-либо имён.
 *  ab:    a — доля выбравших первый вариант, %
 *  who:   a — доля назвавших себя, %
 *  scale: avg — среднее от 1 до 5
 */
export interface CrowdStats {
  people: number;
  a: number;
  avg: number | null;
}

export interface MemoryCard {
  /** 30, 182 или 365 */
  daysAgo: number;
  round: RoundPublic;
}

export interface BookResponse {
  names: string[];
  since: string;
  counters: Counters;
  entries: BookEntry[];
}

export type BookEntry =
  | { type: 'round'; at: string; round: RoundPublic }
  | { type: 'gesture'; at: string; gesture: GesturePublic }
  | { type: 'capsule'; at: string; capsule: CapsulePublic }
  | { type: 'milestone'; at: string; key: string; title: string }
  | { type: 'idea'; at: string; idea: Idea };

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
  streak: Streak;
  badges: number;
  capsule: { active: CapsulePublic | null; unreadOpened: CapsulePublic | null; canCreate: boolean };
  /** Способы вернуть доступ: код восстановления и почта. */
  access: AccessState;
  prefs: Prefs;
  /** Включены ли ИИ-функции на сервере: персональные идеи и вопросы по истории. */
  ai: boolean;
  /** Сколько идей в списке «Хотим вместе» ещё не сделано. */
  ideasOpen: number;
  /** Ближайшие планы пары: сегодня и в ближайшие 7 дней. */
  upcoming: Idea[];
  /** Пора показать короткий опрос о Половинке. */
  surveyDue: boolean;
}

export interface AccessState {
  email: string | null;
  /** На сервере настроена отправка писем. */
  emailEnabled: boolean;
  hasRecovery: boolean;
  recoveryCreatedAt: string | null;
}

export interface TodayResponse {
  date: string;
  /** null у гостевой пары, пока она не стала постоянной. */
  daily: RoundPublic | null;
  bonus: RoundPublic[];
  bonusLeft: number;
  /** Можно взять «Повтор» сегодня. */
  repeatAvailable: boolean;
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
  hug: 'Обнимаю',
};

export const GESTURE_CHIPS: Record<GestureType, string[]> = {
  thanks: ['…утренний кофе', '…что выслушал(а)', '…вчерашний вечер', '…что ты рядом', '…терпение', '…смех'],
  thinking: ['Скучаю', 'Хочу обнять', 'Жду вечера', 'Ты сейчас где-то там, а я тут улыбаюсь', 'Вспомнил(а) тебя — и стало теплее'],
  proud: ['Ты справляешься', 'Вижу, как ты стараешься', 'Ты сегодня молодец', 'Горжусь тем, какой(ая) ты', 'Ты сильнее, чем думаешь'],
  hug: ['Крепко-крепко', 'Обниму вечером', 'Держу тебя', 'Всё будет хорошо', 'Иди сюда'],
};

// --- Этап 3 ---------------------------------------------------------------

export interface WeekStats {
  weekStart: string;
  weekEnd: string;
  discoveries: number;
  matches: number;
  /** Доля угаданных выборов партнёра за неделю. */
  matchPercent: number | null;
  guessesRight: number;
  guessesTotal: number;
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
