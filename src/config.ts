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
  'нужен чат бот', 'ищу разработчика бота', 'нужен AI агент', 'нужен ИИ агент',
  'нужна автоматизация', 'как автоматизировать заявки', 'теряем заявки',
  'менеджеры не успевают отвечать', 'бот для Telegram', 'бот для бизнеса',
  'автоматизация CRM', 'AI для бизнеса', 'ии для бизнеса', 'чат бот керек',
  'автоматтандыру керек', 'әзірлеуші керек'
] as const;

export function loadConfig() {
  const modeRaw = optional('AGENT_MODE', 'review');
  if (!['review', 'autonomous'].includes(modeRaw)) throw new Error('INVALID_AGENT_MODE');
  const queries = optional('SEARCH_QUERIES').split('|').map(x => x.trim()).filter(Boolean);
  return Object.freeze({
    port: int('PORT', 3000, 1, 65535),
    databaseUrl: required('DATABASE_URL'),
    threads: {
      token: required('THREADS_ACCESS_TOKEN'),
      baseUrl: optional('THREADS_API_BASE_URL', 'https://graph.threads.net').replace(/\/$/, '')
    },
    llm: {
      key: required('OPENAI_API_KEY'),
      baseUrl: optional('OPENAI_BASE_URL', 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: optional('OPENAI_MODEL', 'gpt-5-mini')
    },
    mode: modeRaw as AgentMode,
    hunterIntervalMs: int('HUNTER_INTERVAL_SECONDS', 180, 60, 3600) * 1000,
    inboundIntervalMs: int('INBOUND_INTERVAL_SECONDS', 90, 60, 3600) * 1000,
    contentIntervalMs: int('CONTENT_INTERVAL_HOURS', 6, 1, 24) * 3600_000,
    minLeadScore: int('MIN_LEAD_SCORE', 55, 1, 100),
    maxPerHour: int('MAX_OUTREACH_PER_HOUR', 3, 1, 50),
    maxPerDay: int('MAX_OUTREACH_PER_DAY', 10, 1, 200),
    userCooldownDays: int('USER_COOLDOWN_DAYS', 7, 1, 90),
    queries: queries.length ? queries : [...DEFAULT_SEARCH_QUERIES],
    telegram: {
      token: optional('OWNER_TELEGRAM_BOT_TOKEN'),
      chatId: optional('OWNER_TELEGRAM_CHAT_ID')
    },
    dashboardToken: optional('DASHBOARD_TOKEN')
  });
}
export type Config = ReturnType<typeof loadConfig>;
