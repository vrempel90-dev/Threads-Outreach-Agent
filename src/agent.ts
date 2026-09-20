import type { Config } from './config.js';
import { Database } from './db.js';
import { ThreadsClient } from './threads.js';
import { LlmClient } from './llm.js';
import { OwnerNotifier } from './notifier.js';
import { scorePost,isHotIntent,isOptOut } from './scoring.js';
import { contentSlot, selectTrendQueries, formatTrendEvidence, type TrendEvidence } from './content.js';
import type { ThreadsPost } from './types.js';

const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{if(signal.aborted)return resolve();const t=setTimeout(done,ms);function done(){clearTimeout(t);signal.removeEventListener('abort',done);resolve()}signal.addEventListener('abort',done,{once:true})});

export class OutreachAgent {
  private queryCursor=0;
  private trendCursor=0;
  ownUsername='';
  lastHunterAt:string|null=null;
  lastInboundAt:string|null=null;
  lastContentAt:string|null=null;
  lastError:string|null=null;
  publicDiscoveryHealthy:boolean|null=null;
  discoveryIssue:string|null=null;
  discoverySource='openai_web_search';

  constructor(readonly config:Config,readonly db:Database,readonly threads:ThreadsClient,readonly llm:LlmClient,readonly notifier:OwnerNotifier){}

  async start(signal:AbortSignal){
    const p=await this.threads.profile(); this.ownUsername=p.username.toLowerCase();
    await this.db.setState('threads_username',p.username);
    const scopes=await this.threads.debugScopes();
    if(scopes){
      const threadScopes=scopes.filter(s=>s.startsWith('threads_')).sort();
      console.log(JSON.stringify({level:'info',event:'threads_token_scopes',scopes:threadScopes}));
    }
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
    let signals;
    try{
      signals=await this.llm.webThreadSignals([query],'lead',8);
      this.publicDiscoveryHealthy=true;
      this.discoveryIssue=signals.length?'': 'WEB_SEARCH_NO_MATCHES';
    }catch(e){
      this.publicDiscoveryHealthy=false;
      this.discoveryIssue=e instanceof Error?e.message:'OPENAI_WEB_SEARCH_FAILED';
      throw e;
    }
    let candidates=0,drafted=0,resolved=0,discoveredOnly=0;
    for(const signal of signals){
      if(signal.username.toLowerCase()===this.ownUsername)continue;
      const resolvedPost=await this.threads.resolvePermalink(signal.url);
      const seenKey=resolvedPost?.id??`web:${signal.url}`;
      if(await this.db.seen(seenKey))continue;
      await this.db.markSeen(seenKey);
      if(await this.db.blocked(signal.username))continue;
      const text=resolvedPost?.text||signal.text;
      const scored=scorePost(text,this.config.minLeadScore);
      if(!scored.shouldEngage)continue;
      candidates++;
      const postId=resolvedPost?.id;
      const permalink=resolvedPost?.permalink||signal.url;
      const username=resolvedPost?.username||signal.username;
      await this.db.upsertLead({username,score:scored.score,stage:scored.score>=80?'QUALIFIED':'WARM',sourcePostId:postId,sourcePermalink:permalink,lastMessage:text});
      console.log(JSON.stringify({level:'info',event:'web_lead_found',query,username,score:scored.score,resolved:Boolean(postId),permalink}));
      if(!postId){discoveredOnly++;continue;}
      resolved++;
      if(!await this.allowedByRate(username))continue;
      const reply=await this.llm.outreach(text,scored.language);
      await this.db.createOutreach({kind:'REPLY',username,sourcePostId:postId,sourcePermalink:permalink,sourceText:text,text:reply,score:scored.score,status:this.config.mode==='autonomous'?'QUEUED':'DRAFT'});
      drafted++;
    }
    this.lastHunterAt=new Date().toISOString();
    console.log(JSON.stringify({level:'info',event:'hunter_cycle',source:'openai_web_search',query,signals:signals.length,candidates,resolved,discoveredOnly,drafted,mode:this.config.mode}));
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
        const sourceId=row.kind==='REPLY'&&row.source_post_id?String(row.source_post_id):undefined;
        if(row.kind==='REPLY'&&!sourceId){await this.db.markFailed(String(row.id),'REPLY_SOURCE_ID_MISSING');continue;}
        const externalId=await this.threads.publish(String(row.text),sourceId);
        await this.db.markSent(String(row.id),externalId);
        console.log(JSON.stringify({level:'info',event:'threads_sent',kind:row.kind,id:row.id,externalId}));
        if(row.kind==='CONTENT') await this.notifier.send(`🚀 Threads post published\n${row.text}`);
      }catch(e){const code=e instanceof Error?e.message:'SEND_FAILED';await this.db.markFailed(String(row.id),code);throw e;}
    }
  }

  private async collectTrendEvidence():Promise<TrendEvidence[]>{
    const queries=selectTrendQueries(this.trendCursor,this.config.trendQueriesPerCycle);
    this.trendCursor=(this.trendCursor+this.config.trendQueriesPerCycle)%16;
    const signals=await this.llm.webThreadSignals(queries,'trend',14);
    console.log(JSON.stringify({level:'info',event:'trend_web_search',queries:queries.length,signals:signals.length}));
    return signals.map((s,idx):TrendEvidence=>({
      query:s.query,
      type:'RECENT',
      rank:idx+1,
      text:s.text,
      username:s.username,
      timestamp:s.timestamp||new Date().toISOString(),
      permalink:s.url
    }));
  }

  async contentOnce(){
    const hours=Math.max(1,Math.round(this.config.contentIntervalMs/3600_000));
    const slot=contentSlot(new Date(),hours);
    if(await this.db.getState('content_slot')===slot)return;
    let evidence:TrendEvidence[];
    try{
      evidence=await this.collectTrendEvidence();
    }catch(e){
      console.error(JSON.stringify({level:'error',event:'trend_web_search_failed',code:e instanceof Error?e.message:'UNKNOWN'}));
      return;
    }
    const queries=new Set(evidence.map(x=>x.query)).size;
    const fresh=evidence.length;
    if(evidence.length<6||queries<2||fresh<4){
      console.log(JSON.stringify({level:'info',event:'viral_retry_weak_evidence',slot,evidence:evidence.length,queries,fresh}));
      return;
    }
    const evidenceText=formatTrendEvidence(evidence).slice(0,14000);
    const draft=await this.llm.viralContent(evidenceText);
    if(draft.confidence<70){
      console.log(JSON.stringify({level:'info',event:'viral_retry_low_confidence',slot,theme:draft.theme,confidence:draft.confidence}));
      return;
    }
    await this.db.createOutreach({kind:'CONTENT',sourceText:evidenceText,text:draft.text,score:draft.confidence,status:this.config.mode==='autonomous'?'QUEUED':'DRAFT'});
    await this.db.setState('content_slot',slot);
    this.lastContentAt=new Date().toISOString();
    console.log(JSON.stringify({level:'info',event:'viral_content_drafted',slot,theme:draft.theme,confidence:draft.confidence,evidence:evidence.length,mode:this.config.mode}));
  }
}
