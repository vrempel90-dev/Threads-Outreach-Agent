import type { Database } from './db.js';

const wait=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{if(signal.aborted)return resolve();const t=setTimeout(done,ms);function done(){clearTimeout(t);signal.removeEventListener('abort',done);resolve()}signal.addEventListener('abort',done,{once:true})});

export class OwnerNotifier {
  constructor(
    private readonly token:string,
    private readonly configuredChatId:string,
    private readonly bindCode:string,
    private readonly db:Database
  ){}

  get enabled(){return Boolean(this.token)}

  private async chatId():Promise<string>{
    if(this.configuredChatId) return this.configuredChatId;
    return await this.db.getState('telegram_owner_chat_id') ?? '';
  }

  async send(text:string){
    const chatId=await this.chatId();
    if(!this.token||!chatId)return;
    const res=await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})});
    if(!res.ok) console.error(JSON.stringify({level:'warn',event:'telegram_notify_failed',status:res.status}));
  }

  private async pollOnce(){
    if(!this.token||this.configuredChatId||await this.db.getState('telegram_owner_chat_id'))return;
    const rawOffset=await this.db.getState('telegram_update_offset');
    const offset=rawOffset?Number(rawOffset):0;
    const url=new URL(`https://api.telegram.org/bot${this.token}/getUpdates`);
    url.searchParams.set('timeout','10');
    if(Number.isFinite(offset)&&offset>0)url.searchParams.set('offset',String(offset));
    const res=await fetch(url,{signal:AbortSignal.timeout(15_000)});
    const body=await res.json().catch(()=>null) as any;
    if(!res.ok||!body?.ok||!Array.isArray(body.result))throw new Error('TELEGRAM_GETUPDATES_FAILED');
    let next=offset;
    for(const update of body.result){
      const id=Number(update?.update_id); if(Number.isFinite(id))next=Math.max(next,id+1);
      const msg=update?.message;
      const text=typeof msg?.text==='string'?msg.text.trim():'';
      const chatId=msg?.chat?.id;
      if(!chatId||!this.bindCode)continue;
      if(text===`/start ${this.bindCode}`||text===`/bind ${this.bindCode}`){
        await this.db.setState('telegram_owner_chat_id',String(chatId));
        await this.db.setState('telegram_bound_at',new Date().toISOString());
        await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:chatId,text:'✅ Threads Outreach Agent подключён. Буду присылать HOT-лиды и публикации.'})});
        console.log(JSON.stringify({level:'info',event:'telegram_owner_bound'}));
        break;
      }
    }
    if(next>offset)await this.db.setState('telegram_update_offset',String(next));
  }

  async start(signal:AbortSignal){
    if(!this.token)return;
    while(!signal.aborted){
      try{await this.pollOnce()}catch(e){console.error(JSON.stringify({level:'warn',event:'telegram_poll_error',code:e instanceof Error?e.message:'UNKNOWN'}))}
      await wait(15_000,signal);
    }
  }
}
