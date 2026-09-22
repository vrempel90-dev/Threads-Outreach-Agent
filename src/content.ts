export const TREND_QUERIES = [
  'AI','ИИ','чатбот','чат-бот',
  'автоматизация бизнеса','нейросети для бизнеса','AI агент','ИИ агент',
  'WhatsApp бот','Telegram бот','CRM','отдел продаж',
  'лиды','заявки','поддержка клиентов','AI для бизнеса'
] as const;

export const EVERGREEN_THEMES = [
  'почему бизнес теряет заявки, когда первый ответ клиенту зависит от занятого менеджера',
  'где AI-агент реально полезнее обычного чат-бота в продажах и поддержке',
  'какие повторяющиеся действия в CRM стоит автоматизировать в первую очередь',
  'почему автоматизация без нормального процесса только ускоряет хаос',
  'как AI-администратор может разгрузить запись клиентов без выдуманных обещаний',
  'какие задачи нельзя отдавать AI-агенту без контроля человека',
  'почему хороший чат-бот должен доводить диалог до следующего действия, а не просто отвечать',
  'как понять, что бизнесу уже пора автоматизировать обработку заявок'
] as const;

export interface TrendEvidence {
  query: string;
  type: 'TOP' | 'RECENT';
  rank: number;
  text: string;
  username: string;
  timestamp: string;
  permalink: string;
}

export function contentSlot(now=new Date(),hours=4):string{
  return String(Math.floor(now.getTime()/(hours*3600_000)));
}

export function selectTrendQueries(cursor:number,count=4):string[]{
  const out:string[]=[];
  for(let i=0;i<count;i++) out.push(TREND_QUERIES[(cursor+i)%TREND_QUERIES.length]!);
  return out;
}

export function formatTrendEvidence(rows:TrendEvidence[]):string{
  return rows
    .sort((a,b)=>a.query.localeCompare(b.query)||a.type.localeCompare(b.type)||a.rank-b.rank)
    .map(x=>`[${x.query} | ${x.type} #${x.rank} | ${x.timestamp}] @${x.username}: ${x.text.slice(0,420)}`)
    .join('\n');
}


export function evergreenTheme(slot:string):string{
  let hash=0;
  for(const ch of slot) hash=(hash*31+ch.charCodeAt(0))>>>0;
  return EVERGREEN_THEMES[hash%EVERGREEN_THEMES.length]!;
}
