import type { ThreadsPost } from './types.js';

export class ThreadsApiError extends Error {
  constructor(readonly code:string, readonly status:number){ super(code); }
}

const normalizePermalink=(raw:string):string=>{
  try{
    const u=new URL(raw);
    const host=u.hostname.toLowerCase().replace(/^www\./,'');
    const path=u.pathname.replace(/\/+$/,'');
    if(host==='threads.com'||host==='threads.net')return `threads${path}`;
    return `${host}${path}`;
  }catch{return raw.trim().replace(/\/+$/,'');}
};

const usernameFromPermalink=(raw:string):string=>{
  try{
    const m=new URL(raw).pathname.match(/\/@([^/]+)\/post\//u);
    return m?.[1]?decodeURIComponent(m[1]):'';
  }catch{return '';}
};

export class ThreadsClient {
  constructor(private readonly token:string, private readonly baseUrl:string) {}
  private async call(path:string, params:Record<string,string>={}, method:'GET'|'POST'='GET'){
    const qs=new URLSearchParams({...params,access_token:this.token});
    const url=`${this.baseUrl}${path}${method==='GET'?'?'+qs.toString():''}`;
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const res=await fetch(url,{method,signal:controller.signal,redirect:'error',...(method==='POST'?{headers:{'content-type':'application/x-www-form-urlencoded'},body:qs.toString()}:{})});
      const body=await res.json().catch(()=>null) as any;
      if(!res.ok||body?.error){ const code=String(body?.error?.code??res.status); throw new ThreadsApiError(`THREADS_${code}`,res.status); }
      return body;
    } finally { clearTimeout(timer); }
  }
  private post(x:any):ThreadsPost|null{
    if(!x||typeof x.id!=='string'||typeof x.username!=='string'||typeof x.timestamp!=='string') return null;
    return {id:x.id,text:typeof x.text==='string'?x.text:'',username:x.username,permalink:typeof x.permalink==='string'?x.permalink:'',timestamp:x.timestamp};
  }
  async profile(){ const x=await this.call('/me',{fields:'id,username'}); if(!x?.id||!x?.username) throw new Error('INVALID_THREADS_PROFILE'); return {id:String(x.id),username:String(x.username)}; }
  async debugScopes():Promise<string[]|null>{
    try{
      const x=await this.call('/debug_token',{input_token:this.token});
      const scopes=Array.isArray(x?.data?.scopes)?x.data.scopes.filter((v:any)=>typeof v==='string'):null;
      return scopes;
    }catch{return null;}
  }
  async search(query:string,searchType:'RECENT'|'TOP'='RECENT',limit=25):Promise<ThreadsPost[]>{
    const x=await this.call('/keyword_search',{q:query,search_type:searchType,search_mode:'KEYWORD',fields:'id,text,username,permalink,timestamp',limit:String(Math.max(1,Math.min(50,limit)))});
    return Array.isArray(x?.data)?x.data.map((v:any)=>this.post(v)).filter(Boolean) as ThreadsPost[]:[];
  }
  async profilePosts(username:string,limit=50):Promise<ThreadsPost[]>{
    const x=await this.call('/profile_posts',{username,fields:'id,text,username,permalink,timestamp',limit:String(Math.max(1,Math.min(50,limit)))});
    return Array.isArray(x?.data)?x.data.map((v:any)=>this.post(v)).filter(Boolean) as ThreadsPost[]:[];
  }
  async resolveCandidate(id:string,permalink:string):Promise<ThreadsPost|null>{
    if(id){
      try{
        const x=await this.call(`/${encodeURIComponent(id)}`,{fields:'id,text,username,permalink,timestamp'});
        const p=this.post(x);
        if(p)return p;
      }catch{}
    }
    return this.resolvePermalink(permalink);
  }
  async resolvePermalink(permalink:string):Promise<ThreadsPost|null>{
    const username=usernameFromPermalink(permalink);
    if(!username)return null;
    try{
      const target=normalizePermalink(permalink);
      const posts=await this.profilePosts(username,50);
      return posts.find(p=>normalizePermalink(p.permalink)===target)??null;
    }catch{return null;}
  }
  async probeReplyTarget(replyToId:string):Promise<string>{
    if(!replyToId.trim())throw new Error('INVALID_REPLY_TARGET');
    const created=await this.call('/me/threads',{
      media_type:'TEXT',
      text:'Спасибо за вопрос.',
      reply_to_id:replyToId
    },'POST');
    if(!created?.id)throw new Error('INVALID_THREADS_REPLY_PROBE');
    return String(created.id);
  }
  async mentions():Promise<ThreadsPost[]>{
    const x=await this.call('/me/mentions',{fields:'id,text,username,permalink,timestamp',limit:'50'});
    return Array.isArray(x?.data)?x.data.map((v:any)=>this.post(v)).filter(Boolean) as ThreadsPost[]:[];
  }
  async replies(postId:string):Promise<ThreadsPost[]>{
    const x=await this.call(`/${encodeURIComponent(postId)}/replies`,{fields:'id,text,username,permalink,timestamp',reverse:'true',limit:'50'});
    return Array.isArray(x?.data)?x.data.map((v:any)=>this.post(v)).filter(Boolean) as ThreadsPost[]:[];
  }
  async publish(text:string,replyToId?:string):Promise<string>{
    if(!text.trim()||[...text].length>500) throw new Error('INVALID_THREADS_TEXT');
    const created=await this.call('/me/threads',{media_type:'TEXT',text,...(replyToId?{reply_to_id:replyToId}:{})},'POST');
    if(!created?.id) throw new Error('INVALID_THREADS_CONTAINER');
    const published=await this.call('/me/threads_publish',{creation_id:String(created.id)},'POST');
    if(!published?.id) throw new Error('INVALID_THREADS_PUBLISH');
    return String(published.id);
  }
}
