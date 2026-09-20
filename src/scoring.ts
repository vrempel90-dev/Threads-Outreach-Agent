import type { LeadScore } from './types.js';

const COMMERCIAL = /(нужен|нужна|нужно|ищу|ищем|хочу|планирую|интересует|посоветуйте|подскажите|кто\s+(?:сделает|разработает|внедрит|настроит|занимается)|к\s+кому\s+обратиться|заказать|разработчик|специалист|стоимост|сколько\s+стоит|цена|внедрить|подключить|автоматизировать|настроить|керек|іздеймін|бағасы)/iu;
const PAIN = /(не\s+успева|долго\s+отвеч|теря(?:ть|ем|ются?)\s+(?:заяв|лид)|много\s+(?:заяв|обращен)|вручную|ручн(?:ая|ой)|рутин|копир|таблиц|менеджер.{0,30}(?:не\s+успева|перегруж)|клиент.{0,30}(?:жд|уход)|нет\s+времени|обрабатыва.{0,20}заяв|өтінім.{0,20}жоғал|қолмен|үлгерм)/iu;
const FIT = /(чат[ -]?бот|telegram\s*бот|телеграм\s*бот|бот\s+для|ai[ -]?агент|ии[ -]?агент|нейросет|автоматизац|автоматизир|crm|лид|заявк|поддержк|продаж|запис|whatsapp|instagram|директ|автоответ|воронк|интеграц|amo(?:crm)?|битрикс|автоматтандыр|жасанды\s+интеллект)/iu;
const BUSINESS = /(бизнес|компан|клиник|стоматолог|салон|магазин|отдел\s+продаж|агентств|школ|курс|риэлт|недвижим|автосервис|доставк|ресторан|кафе|юрист|бухгалтер|кәсіп|компания|клиент|отдел|менеджер|заявк|лид)/iu;
const SELLER = /(делаю\s+(?:бот|сайт|автоматизац)|разрабатываю|мои\s+услуг|предлагаю\s+услуг|разработчик\s+(?:бот|ai)|ai\s+agency|автоматизирую\s+бизнес|ищу\s+клиентов|беру\s+заказы)/iu;
const JOB = /(ваканси|ищу\s+работ|резюме|junior|стажиров)/iu;
const KK = /[әғқңөұүһі]/u;

export function scorePost(text: string, threshold = 55): LeadScore {
  const n = text.normalize('NFKC').toLowerCase();
  let score = 0;
  const reasons: string[] = [];
  if (COMMERCIAL.test(n)) { score += 40; reasons.push('commercial_intent'); }
  if (PAIN.test(n)) { score += 25; reasons.push('business_pain'); }
  if (FIT.test(n)) { score += 20; reasons.push('automation_fit'); }
  if (BUSINESS.test(n)) { score += 15; reasons.push('business_context'); }
  if (SELLER.test(n)) { score -= 60; reasons.push('seller_or_competitor'); }
  if (JOB.test(n)) { score -= 50; reasons.push('job_seeker'); }
  score = Math.max(0, Math.min(100, score));
  const hasFit=reasons.includes('automation_fit');
  return { score, reasons, language: KK.test(n) ? 'kk' : 'ru', shouldEngage: score >= threshold && hasFit };
}

export function isHotIntent(text: string): boolean {
  return /(сколько|стоимост|цена|прайс|демо|созвон|встреч|готов.{0,15}(?:подключ|начать|заказ)|срок|когда\s+можно|куда\s+написать|контакт|бағасы|кездесу)/iu.test(text);
}

export function isOptOut(text: string): boolean {
  return /^(не\s+пиши|не\s+пишите|не\s+интересно|не\s+нужно|отстань|stop|unsubscribe|жазба|керек\s+емес)[.!\s]*$/iu.test(text.trim());
}
