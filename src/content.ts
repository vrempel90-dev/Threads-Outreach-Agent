export const TREND_QUERIES = [
  'ChatGPT', 'OpenAI', 'автоматизация', 'AI агент', 'ИИ агент', 'нейросеть',
  'бизнес', 'чат-бот', 'продажи', 'CRM', 'Gemini', 'Claude',
  'AI бизнес', 'ИИ для бизнеса', 'AI', 'ИИ'
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
