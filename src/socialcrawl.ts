import type { ThreadsPost } from './types.js';

const n=(...values:any[]):number=>{
  for(const v of values){const x=Number(v);if(Number.isFinite(x))return x;}
  return 0;
};
const s=(...values:any[]):string=>{
  for(const v of values)if(typeof v==='string'&&v.trim())return v.trim();
  return '';
};
const isoDate=(d:Date)=>d.toISOString().slice(0,10);

export interface SocialCrawlPost extends ThreadsPost {
  likes:number;
  replies:number;
  shares:number;
  reposts:number;
  quotes:number;
  relevance:number|null;
}

export function parseSocialCrawlItems(body:any):SocialCrawlPost[]{
  const items=Array.isArray(body?.data?.items)?body.data.items:[];
  const out:SocialCrawlPost[]=[];
  for(const row of items){
    const p=row?.post??row;
    const id=s(p?.id,p?.post_id,p?.postId);
    const text=s(p?.content?.text,p?.text,p?.caption);
    const username=s(p?.author?.username,p?.username,p?.user?.username).replace(/^@/,'');
    const permalink=s(p?.url,p?.permalink,p?.post_url,p?.postUrl);
    const timestamp=s(p?.published_at,p?.created_at,p?.timestamp,p?.postedAt);
    if(!id||!text||!username||!permalink)continue;
    const e=p?.engagement??{};
    const ext=p?.ext??{};
    const rel=row?.computed?.relevance??p?.computed?.relevance;
    const relevance=Number.isFinite(Number(rel?.p))?Number(rel.p):Number.isFinite(Number(rel))?Number(rel):null;
    out.push({
      id,text,username,permalink,timestamp,
      likes:n(e?.likes,p?.like_count,p?.likeCount),
      replies:n(e?.comments,e?.replies,p?.reply_count,p?.replyCount),
      shares:n(e?.shares,p?.share_count,p?.shareCount),
      reposts:n(ext?.repost_count,p?.repost_count,p?.repostCount),
      quotes:n(ext?.quote_count,p?.quote_count,p?.quoteCount),
      relevance
    });
  }
  return out;
}

export class SocialCrawlClient {
  lastCreditsUsed:number|null=null;
  lastCreditsRemaining:number|null=null;

  constructor(private readonly apiKey:string,private readonly baseUrl:string){}
  get enabled(){return Boolean(this.apiKey);}

  async search(query:string,days=14):Promise<SocialCrawlPost[]>{
    if(!this.apiKey)return [];
    const end=new Date();
    const start=new Date(end.getTime()-Math.max(1,days)*86400_000);
    const url=new URL('/v1/threads/search',this.baseUrl);
    url.searchParams.set('query',query);
    url.searchParams.set('start_date',isoDate(start));
    url.searchParams.set('end_date',isoDate(end));
    url.searchParams.set('relevance','filter');
    url.searchParams.set('relevance_threshold','0.45');
    url.searchParams.set('judgments','on');

    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20_000);
    try{
      const res=await fetch(url,{headers:{'x-api-key':this.apiKey},signal:controller.signal,redirect:'error'});
      const body=await res.json().catch(()=>null) as any;
      if(!res.ok||body?.success===false)throw new Error(`SOCIALCRAWL_${body?.error?.type??res.status}`);
      this.lastCreditsUsed=Number.isFinite(Number(body?.credits_used))?Number(body.credits_used):null;
      this.lastCreditsRemaining=Number.isFinite(Number(body?.credits_remaining))?Number(body.credits_remaining):null;
      const posts=parseSocialCrawlItems(body);
      console.log(JSON.stringify({level:'info',event:'socialcrawl_search',query,posts:posts.length,creditsUsed:this.lastCreditsUsed,creditsRemaining:this.lastCreditsRemaining}));
      return posts;
    }finally{clearTimeout(timer);}
  }
}
