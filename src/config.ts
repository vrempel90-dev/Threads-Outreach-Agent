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
  'нужен чат бот','нужен AI агент','нужен ИИ агент','ищу разработчика чат бота',
  'AI агент','ИИ агент','автоматизация бизнеса','автоматизация заявок','теряем заявки',
  'автоматизация CRM','AI бизнес','әзірлеуші керек','автоматтандыру керек'
] as const;

export function loadConfig() {
  const modeRaw = optional('AGENT_MODE', 'review');
  if (!['review', 'autonomous'].includes(modeRaw)) throw new Error('INVALID_AGENT_MODE');
  const queries = optional('SEARCH_QUERIES').split('|').map(x => x.trim()).filter(Boolean);
  const model=optional('OPENAI_MODEL', 'gpt-5-mini');
  return Object.freeze({
    port: int('PORT', 3000, 1, 65535),
    databaseUrl: required('DATABASE_URL'),
    threads: {
      token: required('THREADS_ACCESS_TOKEN'),
      baseUrl: optional('THREADS_API_BASE_URL', 'https://graph.threads.net').replace(/\/$/, '')
    },
    socialCrawl: {
      apiKey: optional('SOCIALCRAWL_API_KEY'),
      baseUrl: optional('SOCIALCRAWL_BASE_URL','https://www.socialcrawl.dev').replace(/\/$/,'')
    },
    llm: {
      key: required('OPENAI_API_KEY'),
      baseUrl: optional('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, ''),
      model,
      webSearchModel: optional('OPENAI_WEB_SEARCH_MODEL', model)
    },
    mode: modeRaw as AgentMode,
    hunterIntervalMs: int('HUNTER_INTERVAL_SECONDS', 3600, 60, 3600) * 1000,
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
