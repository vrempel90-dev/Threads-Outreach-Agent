import type { AgentMode } from './types.js';

const required = (key: string): string => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key}_REQUIRED`);
  return value;
};
const optional = (key: string, fallback = ''): string => process.env[key]?.trim() || fallback;
const int = (key: string, fallback: number, min: number, max: number): number => {
  const raw = process.env[key];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`INVALID_${key}`);
  return value;
};

export const DEFAULT_SEARCH_QUERIES = [
  // Direct buyer demand — RU
  'нужен чат бот','нужен чат-бот','нужен AI агент','нужен ИИ агент',
  'ищу разработчика чат бота','ищу разработчика AI агента','ищу разработчика ИИ агента',
  'кто сделает чат бота','кто разработает AI агента','заказать чат бота',
  'бот для WhatsApp бизнес','бот для Telegram бизнес','бот для Instagram Direct',
  'AI администратор для бизнеса','ИИ администратор для бизнеса',
  'AI для отдела продаж','AI для поддержки клиентов','AI для обработки заявок',
  'автоматизировать заявки','автоматизация отдела продаж','автоматизация поддержки клиентов',
  'автоматизация записи клиентов','автоматизация CRM','интеграция CRM с AI',
  'теряем заявки автоматизация','медленно отвечаем клиентам автоматизация',
  // Direct buyer demand — KZ
  'чат бот керек','AI агент керек','ИИ агент керек','ЖИ агент керек',
  'бизнеске чат бот керек','бизнеске AI агент керек','әзірлеуші керек чат бот',
  'бизнесті автоматтандыру керек','өтінімдерді автоматтандыру','сатуды автоматтандыру',
  'клиенттерге жауап беретін бот','WhatsApp бот керек','Telegram бот керек'
] as const;

export function loadConfig() {
  const modeRaw = optional('AGENT_MODE', 'review');
  if (!['review', 'autonomous'].includes(modeRaw)) throw new Error('INVALID_AGENT_MODE');
  const queries = optional('SEARCH_QUERIES').split('|').map(x => x.trim()).filter(Boolean);
  const model=optional('OPENAI_MODEL', 'gpt-5-mini');
  return Object.freeze({
    port: int('PORT', 3000, 1, 65535),
    databaseUrl: optional('DATABASE_URL'),
    threads: {
      token: optional('THREADS_ACCESS_TOKEN'),
      baseUrl: optional('THREADS_API_BASE_URL', 'https://graph.threads.net').replace(/\/$/, '')
    },
    llm: {
      key: optional('OPENAI_API_KEY'),
      baseUrl: optional('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, ''),
      model,
      webSearchModel: optional('OPENAI_WEB_SEARCH_MODEL', model)
    },
    mode: modeRaw as AgentMode,
    hunterIntervalMs: int('HUNTER_INTERVAL_SECONDS', 300, 60, 3600) * 1000,
    leadLookbackDays: int('LEAD_LOOKBACK_DAYS', 7, 1, 30),
    inboundIntervalMs: int('INBOUND_INTERVAL_SECONDS', 90, 60, 3600) * 1000,
    contentIntervalMs: int('CONTENT_INTERVAL_HOURS', 4, 1, 24) * 3600_000,
    trendQueriesPerCycle: int('TREND_QUERIES_PER_CYCLE', 2, 1, 4),
    minLeadScore: int('MIN_LEAD_SCORE', 55, 1, 100),
    maxPerHour: int('MAX_OUTREACH_PER_HOUR', 3, 1, 50),
    maxPerDay: int('MAX_OUTREACH_PER_DAY', 10, 1, 200),
    userCooldownDays: int('USER_COOLDOWN_DAYS', 7, 1, 90),
    queries: queries.length ? queries : [...DEFAULT_SEARCH_QUERIES],
    telegram: {
      token: optional('OWNER_TELEGRAM_BOT_TOKEN'),
      chatId: optional('OWNER_TELEGRAM_CHAT_ID'),
      bindCode: optional('TELEGRAM_BIND_CODE')
    },
    dashboardToken: optional('DASHBOARD_TOKEN')
  });
}
export type Config = ReturnType<typeof loadConfig>;
