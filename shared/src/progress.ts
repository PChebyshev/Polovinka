/** Уровни, темы, наборы и значки — общее для сервера и клиента. */

export interface LevelInfo {
  level: number;
  /** Открытий, нужных для уровня. */
  at: number;
  name: string;
  /** Что открывает уровень — коротко, для полоски и списка. */
  unlock: string;
  /** Ещё не сделано: показываем «скоро». */
  soon?: boolean;
}

export const LEVEL_INFO: LevelInfo[] = [
  { level: 1, at: 0, name: 'Знакомство', unlock: 'Базовые вопросы' },
  { level: 2, at: 5, name: 'Свои люди', unlock: 'набор вопросов «Детство»' },
  { level: 3, at: 10, name: 'Команда', unlock: 'капсула времени' },
  { level: 4, at: 25, name: 'Близкие', unlock: 'набор «Наше будущее» и жест «Обнимаю»' },
  { level: 5, at: 50, name: 'Одна волна', unlock: '«Повтор»: старые вопросы возвращаются' },
  { level: 6, at: 100, name: 'Родные души', unlock: '«Книга пары»: вся ваша история одной книгой' },
  { level: 7, at: 200, name: 'Половинки', unlock: 'набор «Если бы мы встретились снова»' },
  { level: 8, at: 365, name: 'Легенда пары', unlock: 'годовой итог', soon: true },
];

export const LEVEL_CAPSULE = 3;
export const LEVEL_HUG = 4;
export const LEVEL_REPEAT = 5;
export const LEVEL_BOOK = 6;

export function levelName(level: number): string {
  return LEVEL_INFO[level - 1]?.name ?? '';
}

/** Темы-наборы, которые открываются с уровнем. */
export const PACK_LEVEL: Record<string, number> = { childhood: 2, future: 4, again: 7 };

export function isCategoryUnlocked(category: string, level: number): boolean {
  return (PACK_LEVEL[category] ?? 1) <= level;
}

export interface TopicDef {
  key: string;
  label: string;
  /** Значок «Исследовали»: раскрыто EXPLORE_AT вопросов темы. */
  explored: string;
  /** Значок «Знаем друг друга»: KNOW_MIN_GUESSES догадок и от KNOW_RATIO угаданных. */
  know: string;
}

export const EXPLORE_AT = 5;
export const KNOW_MIN_GUESSES = 8;
export const KNOW_RATIO = 0.75;

export const TOPICS: TopicDef[] = [
  { key: 'food', label: 'Еда', explored: 'Попробовали всё', know: 'Знатоки вкусов' },
  { key: 'rest', label: 'Отдых', explored: 'Разведчики выходных', know: 'Мастера отдыха' },
  { key: 'home', label: 'Быт', explored: 'Обжились', know: 'Хранители уюта' },
  { key: 'weird', label: 'Странное', explored: 'Два чудака', know: 'На одной волне' },
  { key: 'whatif', label: 'А если бы', explored: 'Мечтатели', know: 'Читаем мысли' },
  { key: 'memories', label: 'Воспоминания', explored: 'Летописцы', know: 'Помним всё' },
  { key: 'habits', label: 'Привычки', explored: 'Изучили повадки', know: 'Знаем наизусть' },
  { key: 'joy', label: 'Что радует', explored: 'Ловцы радости', know: 'Знаем, что радует' },
  { key: 'dreams', label: 'Мечты', explored: 'Заглянули в мечты', know: 'Хранители мечтаний' },
  { key: 'values', label: 'Ценности', explored: 'Говорили о главном', know: 'Знаем главное' },
  { key: 'support', label: 'Поддержка', explored: 'Плечо рядом', know: 'Опора друг друга' },
  { key: 'childhood', label: 'Детство', explored: 'Вспомнили детство', know: 'Знаем друг друга с детства' },
  { key: 'future', label: 'Наше будущее', explored: 'Заглянули вперёд', know: 'Знаем планы друг друга' },
  { key: 'again', label: 'Если бы встретились снова', explored: 'Встретились снова', know: 'Узнали бы друг друга' },
];

export function topicOf(key: string): TopicDef | undefined {
  return TOPICS.find((t) => t.key === key);
}

/** Мягкая серия: один пропуск в 7 дней прощается. */
export const STREAK_GRACE_EVERY_DAYS = 7;
export const STREAK_MILESTONES = [7, 30, 100];
