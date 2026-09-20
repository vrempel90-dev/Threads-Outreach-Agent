import type { ThreadsPost } from './types.js';

export class ThreadsApiError extends Error {
  constructor(readonly code:string, readonly status:number){ super(code); }
}

export class ThreadsClient {
  constructor(private readonly token:string, private readonly baseUrl:string) {}
  private async call(path:string, params:Record<string,string>={}, method:'GET'|'POST'='GET'){
    const qs=new URLSearchParams({...params,access_token:this.token});
    const url=`${this.baseUrl}${path}${method==='GET'?'?'+qs.toString():''}`;
    const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),12000);
    try{
      const res=await fetch(url,{method,signal:controller.signal,redirect:'error',...(method==='POST'?{headers:{'content-type':'application/x-www-form-urlencoded'},body:qs.toString()}:{})});
      const body=await res.json().catch(()=>null) as any;
      if(!res.ok||body?.error){ const c=String(body?.error?.code??res.status); throw new ThreadsApiError(`THREADS_${c}`,res.status); }
      return body;
    } finally { clearTimeout(timer); }
  }
  private post(x:any):ThreadsPost|null{
    if(!x||typeof x.id!=='string'||typeof x.username!=='string'||typeof x.timestamp!=='string') return null;
    return {id:x.id,text:typeof x.text==='string'?x.text:'',username:x.username,permalink:typeof x.permalink==='string'?x.permalink:'',timestamp:x.timestamp};
  }
  async profile(){ const x=await this.call('/me',{fields:'id,username'}); if(!x?.id||!x?.username) throw new Error('INVALID_THREADS_PROFILE'); return {id:String(x.id),username:String(x.username)}; }
  async search(query:string):Promise<ThreadsPost[]>{
    const x=await this.call('/keyword_search',{q:query,search_type:'RECENT',fields:'id,text,username,permalink,timestamp',limit:'25'});
    return Array.isArray(x?.data)?x.data.map((v:any)=>this.post(v)).filter(Boolean) as ThreadsPost[]:[];
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
