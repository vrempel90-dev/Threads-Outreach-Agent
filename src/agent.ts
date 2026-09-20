import type { Config } from './config.js';
import { Database } from './db.js';
import { ThreadsClient } from './threads.js';
import { LlmClient } from './llm.js';
import { OwnerNotifier } from './notifier.js';
import { scorePost,isHotIntent,isOptOut } from './scoring.js';
import { CONTENT_SEEDS,contentSlot } from './content.js';
import type { ThreadsPost } from './types.js';

const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{if(signal.aborted)return resolve();const t=setTimeout(done,ms);function done(){clearTimeout(t);signal.removeEventListener('abort',done);resolve()}signal.addEventListener('abort',done,{once:true})});

export class OutreachAgent {
  private queryCursor=0;
  private seedCursor=0;
  ownUsername='';
  lastHunterAt:string|null=null;
  lastInboundAt:string|null=null;
  lastContentAt:string|null=null;
  lastError:string|null=null;

  constructor(readonly config:Config,readonly db:Database,readonly threads:ThreadsClient,readonly llm:LlmClient,readonly notifier:OwnerNotifier){}

  async start(signal:AbortSignal){
    const p=await this.threads.profile(); this.ownUsername=p.username.toLowerCase();
    await this.db.setState('threads_username',p.username);
    return Promise.all([
      this.loop('hunter',this.config.hunterIntervalMs,signal,()=>this.hunterOnce()),
      this.loop('inbound',this.config.inboundIntervalMs,signal,()=>this.inboundOnce()),
      this.loop('outbox',15_000,signal,()=>this.outboxOnce()),
      this.loop('content',Math.min(this.config.contentIntervalMs,300_000),signal,()=>this.contentOnce())
    ]);
  }
  private async loop(name:string,interval:number,signal:AbortSignal,fn:()=>Promise<void>){
    while(!signal.aborted){
      try{await fn();this.lastError=null}catch(e){this.lastError=e instanceof Error?e.message:'UNKNOWN';console.error(JSON.stringify({level:'error',worker:name,code:this.lastError}));}
      await sleep(interval,signal);
    }
  }
  private allowedByRate(username:string){return Promise.all([this.db.sentCount(1),this.db.sentCount(24),this.db.recentContact(username,this.config.userCooldownDays)]).then(([hour,day,recent])=>!recent&&hour<this.config.maxPerHour&&day<this.config.maxPerDay);}

  async hunterOnce(){
    const query=this.config.queries[this.queryCursor++%this.config.queries.length]!;
    const posts=await this.threads.search(query);
    let candidates=0,drafted=0;
    for(const post of posts){
      if(post.username.toLowerCase()===this.ownUsername||await this.db.seen(post.id))continue;
      await this.db.markSeen(post.id);
      if(await this.db.blocked(post.username))continue;
      const scored=scorePost(post.text,this.config.minLeadScore);
      if(!scored.shouldEngage)continue;
      candidates++;
      await this.db.upsertLead({username:post.username,score:scored.score,stage:scored.score>=80?'QUALIFIED':'WARM',sourcePostId:post.id,sourcePermalink:post.permalink,lastMessage:post.text});
      if(!await this.allowedByRate(post.username))continue;
      const reply=await this.llm.outreach(post.text,scored.language);
      await this.db.createOutreach({kind:'REPLY',username:post.username,sourcePostId:post.id,sourcePermalink:post.permalink,sourceText:post.text,text:reply,score:scored.score,status:this.config.mode==='autonomous'?'QUEUED':'DRAFT'});
      drafted++;
    }
    this.lastHunterAt=new Date().toISOString();
    console.log(JSON.stringify({level:'info',event:'hunter_cycle',query,posts:posts.length,candidates,drafted,mode:this.config.mode}));
  }

  private async handleInbound(post:ThreadsPost,parentId:string,context:string){
    if(post.username.toLowerCase()===this.ownUsername)return;
    const fresh=await this.db.recordInbound({postId:post.id,username:post.username,parentExternalId:parentId,text:post.text,permalink:post.permalink});
    if(!fresh)return;
    if(isOptOut(post.text)){await this.db.block(post.username);await this.db.upsertLead({username:post.username,score:0,stage:'REJECTED',lastMessage:post.text});return;}
    const score=isHotIntent(post.text)?95:75;
    const stage=isHotIntent(post.text)?'HOT':'ENGAGED';
    await this.db.upsertLead({username:post.username,score,stage,lastMessage:post.text,sourcePermalink:post.permalink});
    if(stage==='HOT')await this.notifier.send(`🔥 HOT lead from Threads\n@${post.username}\n${post.text}\n${post.permalink||''}`);
    const language=/[әғқңөұүһі]/u.test(post.text)?'kk':'ru';
    const reply=await this.llm.followUp(context,post.text,language);
    await this.db.createOutreach({kind:'REPLY',username:post.username,sourcePostId:post.id,sourcePermalink:post.permalink,sourceText:post.text,text:reply,score,status:this.config.mode==='autonomous'?'QUEUED':'DRAFT'});
  }

  async inboundOnce(){
    const targets=await this.db.publishedTargets();
    for(const t of targets){
      const replies=await this.threads.replies(String(t.external_id));
      for(const p of replies)await this.handleInbound(p,String(t.external_id),String(t.text));
    }
    const mentions=await this.threads.mentions();
    for(const p of mentions)await this.handleInbound(p,p.id,'The person mentioned the account directly.');
    this.lastInboundAt=new Date().toISOString();
    console.log(JSON.stringify({level:'info',event:'inbound_cycle',targets:targets.length,mentions:mentions.length}));
  }

  async outboxOnce(){
    if(this.config.mode!=='autonomous')return;
    for(const row of await this.db.pending(5)){
      try{
        const externalId=await this.threads.publish(String(row.text),row.kind==='REPLY'?String(row.source_post_id):undefined);
        await this.db.markSent(String(row.id),externalId);
        console.log(JSON.stringify({level:'info',event:'threads_sent',kind:row.kind,id:row.id,externalId}));
      }catch(e){const code=e instanceof Error?e.message:'SEND_FAILED';await this.db.markFailed(String(row.id),code);throw e;}
    }
  }

  async contentOnce(){
    const hours=Math.max(1,Math.round(this.config.contentIntervalMs/3600_000));
    const slot=contentSlot(new Date(),hours);
    if(await this.db.getState('content_slot')===slot)return;
    const seed=CONTENT_SEEDS[this.seedCursor++%CONTENT_SEEDS.length]!;
    const text=await this.llm.content(seed);
    await this.db.createOutreach({kind:'CONTENT',text,score:0,status:this.config.mode==='autonomous'?'QUEUED':'DRAFT'});
    await this.db.setState('content_slot',slot);
    this.lastContentAt=new Date().toISOString();
    console.log(JSON.stringify({level:'info',event:'content_drafted',slot,mode:this.config.mode}));
  }
}
