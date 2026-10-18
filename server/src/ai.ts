import Anthropic from '@anthropic-ai/sdk';

/**
 * ИИ для персональных идей, подсказок заботы и вопросов по истории ответов.
 *
 * AI_PROVIDER:
 *   anthropic — Claude (ANTHROPIC_API_KEY; ANTHROPIC_BASE_URL — если нужен прокси; AI_MODEL)
 *   yandex    — YandexGPT (YANDEX_API_KEY, YANDEX_FOLDER_ID; YANDEX_MODEL, по умолчанию yandexgpt/latest)
 *   mock      — предсказуемые ответы для тестов
 * Без настройки всё работает на заранее написанных текстах.
 */

type Provider = 'anthropic' | 'yandex' | 'mock';

const TIMEOUT_MS = 25_000;
const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

let anthropic: Anthropic | null = null;

function provider(): Provider | null {
  const p = (process.env.AI_PROVIDER ?? '').trim().toLowerCase();
  if (p === 'mock') return 'mock';
  if (p === 'anthropic' && process.env.ANTHROPIC_API_KEY) return 'anthropic';
  if (p === 'yandex' && process.env.YANDEX_API_KEY && process.env.YANDEX_FOLDER_ID) return 'yandex';
  return null;
}

export function aiEnabled(): boolean {
  return provider() !== null;
}

/** Название для страницы «Что мы храним». */
export function aiProviderName(): string | null {
  const p = provider();
  return p === 'anthropic' ? 'Claude (Anthropic)' : p === 'yandex' ? 'YandexGPT (Яндекс)' : p === 'mock' ? 'тестовый режим' : null;
}

export type JsonSchema = Record<string, unknown>;

export interface AiTask {
  /** Короткое имя задачи — для логов и тестового режима. */
  name: 'ideas' | 'question' | 'care';
  system: string;
  user: string;
  schema: JsonSchema;
}

/** Общие правила тона для всех задач. */
export const TONE = `Ты пишешь для приложения «Половинка»: пара каждый день отвечает на один вопрос и угадывает ответ друг друга.
Правила:
- Только русский язык, тепло и просто, без канцелярита.
- Никаких диагнозов, оценок отношений, советов в духе психотерапевта и слов «проблема», «вам нужно».
- Никаких покупок, брендов, ссылок и рекламы.
- Коротко и конкретно: то, что можно сделать сегодня или на этой неделе.
- Не упоминай, что ты ИИ, и не пересказывай вопрос целиком.`;

/** Запрос к модели с ответом строго по JSON-схеме. null — если ИИ выключен или ответ не удался. */
export async function aiJson<T>(task: AiTask, log?: { warn: (s: string) => void }): Promise<T | null> {
  const p = provider();
  if (!p) return null;
  try {
    if (p === 'mock') return mockAnswer(task) as T;
    const text = p === 'anthropic' ? await callClaude(task) : await callYandex(task);
    if (!text) return null;
    return parseJson<T>(text);
  } catch (e) {
    log?.warn(`ИИ (${p}, ${task.name}): ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function callClaude(task: AiTask): Promise<string | null> {
  anthropic ??= new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
  const response = await anthropic.beta.messages.create({
    model: process.env.AI_MODEL?.trim() || DEFAULT_CLAUDE_MODEL,
    max_tokens: 4000,
    // При отказе модели запрос сам перезапускается на рекомендованной Anthropic модели
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: { type: 'json_schema', schema: task.schema } },
    system: task.system,
    messages: [{ role: 'user', content: task.user }],
  });
  if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
  for (const block of response.content) if (block.type === 'text') return block.text;
  return null;
}

async function callYandex(task: AiTask): Promise<string | null> {
  const folder = process.env.YANDEX_FOLDER_ID!.trim();
  const model = process.env.YANDEX_MODEL?.trim() || 'yandexgpt/latest';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch('https://llm.api.cloud.yandex.net/foundationModels/v1/completion', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Api-Key ${process.env.YANDEX_API_KEY!.trim()}`, 'x-folder-id': folder },
      body: JSON.stringify({
        modelUri: `gpt://${folder}/${model}`,
        completionOptions: { stream: false, temperature: 0.6, maxTokens: '1500' },
        messages: [
          { role: 'system', text: `${task.system}\n\nОтветь только JSON по этой схеме, без пояснений:\n${JSON.stringify(task.schema)}` },
          { role: 'user', text: task.user },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { result?: { alternatives?: Array<{ message?: { text?: string } }> } };
    return data.result?.alternatives?.[0]?.message?.text ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/** JSON из ответа: модели иногда оборачивают его в ```json … ```. */
function parseJson<T>(text: string): T | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

function mockAnswer(task: AiTask): unknown {
  if (task.name === 'ideas')
    return {
      ideas: [
        { kind: 'do', text: 'Персональная идея: устройте вечер, где каждый выбирает по одному пункту.' },
        { kind: 'talk', text: 'Спросите друг друга, что стоит за вашим выбором.' },
      ],
    };
  if (task.name === 'care') return { text: '{partner} радуется, когда ты рядом. Сегодня хороший день, чтобы сделать что-то маленькое просто так.' };
  return {
    text: 'Чего мне сейчас хочется больше:',
    a: 'Спокойного вечера вдвоём',
    b: 'Выбраться куда-то новое',
    topic: 'Как устроить ближайшие выходные, чтобы было хорошо обоим?',
    category: 'now',
  };
}
