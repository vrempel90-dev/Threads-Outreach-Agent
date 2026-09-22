import type { LeadScore } from './types.js';

const COMMERCIAL = /(нужен|нужна|нужно|ищу|ищем|кто\\s+(?:сделает|разработает)|заказать|хочу\\s+(?:внедрить|автоматизировать)|стоимост|сколько\\s+стоит|цена|внедрить|подключить|керек|іздеймін|бағасы)/iu;
const EXPLICIT_FIT = /(чат[ -]?бот|telegram\\s*бот|телеграм\\s*бот|whatsapp\\s*бот|инстаграм.{0,15}бот|бот\\s+для|ai[ -]?агент|ии[ -]?агент|жі[ -]?агент|ai[ -]?ассистент|ии[ -]?ассистент|ai[ -]?администратор|ии[ -]?администратор|нейросет.{0,20}(?:бизнес|заяв|клиент|продаж|поддерж)|автоматизац|автоматтандыр|crm.{0,20}(?:автомат|интеграц)|интеграц.{0,20}crm)/iu;
const AUTOMATABLE_PAIN = /(не\\s+успева|долго\\s+отвеч|теря(?:ть|ем|ются?)\\s+(?:заяв|лид|клиент)|вручную|ручн(?:ая|ой)|рутин|много\\s+одинаков|менеджер.{0,30}(?:не\\s+успева|перегруж)|клиент.{0,30}(?:жд|уход)|заявк.{0,30}(?:direct|директ|whatsapp|telegram)|өтінім.{0,20}жоғал|қолмен|үлгерм)/iu;
const BUSINESS = /(бизнес|компан|клиник|стоматолог|салон|магазин|отдел\\s+продаж|агентств|школ|курс|риэлт|недвижим|автосервис|доставк|ресторан|кафе|юрист|бухгалтер|медцентр|онлайн[- ]?школ|кәсіп|компания|клиент)/iu;
const REGION = /(казахстан|қазақстан|алмат|астан|шымкент|караганд|қарағанд|актобе|ақтөбе|павлодар|костанай|қостанай|атырау|актау|ақтау|снг|кыргыз|қырғыз|узбекистан|өзбекстан)/iu;
const SELLER = /(делаю\\s+(?:бот|сайт|автоматизац)|разрабатываю|разрабатываем|мои\\s+услуг|наши\\s+услуг|предлагаю\\s+услуг|предлагаем\\s+услуг|разработчик\\s+(?:бот|ai|ии)|ai\\s+agency|automation\\s+agency|автоматизирую\\s+бизнес|автоматизируем\\s+бизнес|ищу\\s+клиентов|беру\\s+проекты|помогаю\\s+бизнесу.{0,30}автомат)/iu;
const JOB = /(ваканси|ищу\\s+работ|резюме|junior|стажиров|полная\\s+занятость|full[- ]?time|зарплат|оклад|hh\\.ru|headhunter)/iu;
const HUMAN_AGENT = /(агент\\s+по\\s+(?:недвижим|туризм|страхован|продажам недвижимости)|риелтор|турагент|страховой\\s+агент)/iu;
const GENERIC_AI = /^(?:.{0,25})?(?:что\\s+думаете|как\\s+вам|новости|интересно|обсудим).{0,80}(?:ai|ии|нейросет)/iu;
const KK = /[әғқңөұүһі]/u;

export function scorePost(text: string, threshold = 55): LeadScore {
  const n = text.normalize('NFKC').toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  const commercial = COMMERCIAL.test(n);
  const fit = EXPLICIT_FIT.test(n);
  const pain = AUTOMATABLE_PAIN.test(n);
  const business = BUSINESS.test(n);

  if (commercial) { score += 35; reasons.push('commercial_intent'); }
  if (fit) { score += 35; reasons.push('explicit_ai_automation_fit'); }
  if (pain) { score += 20; reasons.push('business_pain'); }
  if (business) { score += 10; reasons.push('business_context'); }
  if (REGION.test(n)) { score += 10; reasons.push('kz_cis_signal'); }
  if (SELLER.test(n)) { score -= 80; reasons.push('seller_or_competitor'); }
  if (JOB.test(n)) { score -= 70; reasons.push('job_seeker'); }
  if (HUMAN_AGENT.test(n)) { score -= 80; reasons.push('human_service_agent'); }
  if (GENERIC_AI.test(n) && !commercial && !pain) { score -= 30; reasons.push('generic_ai_discussion'); }

  score = Math.max(0, Math.min(100, score));
  const blocked = reasons.some(r => ['seller_or_competitor','job_seeker','human_service_agent'].includes(r));
  const shouldEngage = !blocked && score >= threshold && fit && (commercial || pain);
  return { score, reasons, language: KK.test(n) ? 'kk' : 'ru', shouldEngage };
}

export function isHotIntent(text: string): boolean {
  return /(сколько|стоимост|цена|прайс|демо|созвон|встреч|готов.{0,15}(?:подключ|начать|заказ)|срок|когда\s+можно|куда\s+написать|контакт|бағасы|кездесу)/iu.test(text);
}

export function isOptOut(text: string): boolean {
  return /^(не\s+пиши|не\s+пишите|не\s+интересно|не\s+нужно|отстань|stop|unsubscribe|жазба|керек\s+емес)[.!\s]*$/iu.test(text.trim());
}
