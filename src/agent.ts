import type { Config } from './config.js';
import { Database } from './db.js';
import { ThreadsClient } from './threads.js';
import { LlmClient } from './llm.js';
import { OwnerNotifier } from './notifier.js';
import { scorePost,isHotIntent,isOptOut } from './scoring.js';
import { contentSlot, selectTrendQueries, formatTrendEvidence, evergreenTheme, type TrendEvidence } from './content.js';
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
  discoverySource='threads_keyword_search';
  private nextContentAttemptAt=0;

  constructor(
    readonly config:Config,
    readonly db:Database,
    readonly threads:ThreadsClient,
    readonly llm:LlmClient,
    readonly notifier:OwnerNotifier
  ){}

  async start(signal:AbortSignal){
    const missing:string[]=[];
    if(!this.config.threads.token) missing.push('THREADS_ACCESS_TOKEN');
    if(!this.config.llm.key) missing.push('OPENAI_API_KEY');
    if(missing.length){
      this.publicDiscoveryHealthy=false;
      this.discoveryIssue='SETUP_PENDING_'+missing.join(',');
      console.warn(JSON.stringify({level:'warn',event:'setup_pending',missing}));
      return;
    }
    const p=await this.threads.profile(); this.ownUsername=p.username.toLowerCase();
    await this.db.setState('threads_username',p.username);
    const scopes=await this.threads.debugScopes();
    if(scopes){
      const threadScopes=scopes.filter(s=>s.startsWith('threads_')).sort();
      console.log(JSON.stringify({level:'info',event:'threads_token_scopes',scopes:threadScopes}));
    }
    if(await this.db.getState('legacy_seen_release_v1')!=='done'){
      const released=await this.db.releaseLegacySeen();
      await this.db.setState('legacy_seen_release_v1','done');
      console.log(JSON.stringify({level:'info',event:'legacy_seen_released',released}));
    }
    if(await this.db.getState('direct_reply_probe_release_v1')!=='done'){
      const released=await this.db.releaseUnresolvedBuyerSeen();
      await this.db.setState('direct_reply_probe_release_v1','done');
      console.log(JSON.stringify({level:'info',event:'direct_reply_probe_seen_released',released}));
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
    let posts:ThreadsPost[];
    try{
      const raw=await this.threads.search(query,'RECENT',50);
      const cutoff=Date.now()-this.config.leadLookbackDays*24*3600_000;
      posts=raw.filter(post=>{
        const ts=Date.parse(post.timestamp);
        return !Number.isNaN(ts)&&ts>=cutoff;
      });
      this.publicDiscoveryHealthy=true;
      this.discoveryIssue=posts.length?'':'NO_MATCHES_THIS_QUERY';
    }catch(e){
      this.publicDiscoveryHealthy=false;
      this.discoveryIssue=e instanceof Error?e.message:'THREADS_KEYWORD_SEARCH_FAILED';
      this.lastHunterAt=new Date().toISOString();
      throw e;
    }

    let candidates=0,drafted=0;
    for(const post of posts){
      if(post.username.toLowerCase()===this.ownUsername||await this.db.seen(post.id))continue;
      await this.db.markSeen(post.id);
      if(await this.db.blocked(post.username))continue;

      const scored=scorePost(post.text,this.config.minLeadScore);
      console.log(JSON.stringify({level:'info',event:'lead_score',source:'threads_api',query,username:post.username,score:scored.score,reasons:scored.reasons}));
      if(!scored.shouldEngage)continue;

      const qualified=await this.llm.qualifyLead(post.text,post.username,query);
      console.log(JSON.stringify({level:'info',event:'lead_qualification',query,username:post.username,buyer:qualified.buyer,confidence:qualified.confidence,category:qualified.category,reason:qualified.reason}));
      if(!qualified.buyer)continue;
      candidates++;

      await this.db.upsertLead({
        username:post.username,score:scored.score,stage:scored.score>=80?'QUALIFIED':'WARM',
        sourcePostId:post.id,sourcePermalink:post.permalink,lastMessage:post.text,
        searchQuery:query,aiCategory:qualified.category,aiConfidence:qualified.confidence,aiReason:qualified.reason,
        officiallyResolved:true
      });
      console.log(JSON.stringify({level:'info',event:'lead_found',source:'threads_api',query,username:post.username,score:scored.score,permalink:post.permalink}));

      if(!await this.allowedByRate(post.username))continue;
      const reply=await this.llm.outreach(post.text,scored.language);
      await this.db.createOutreach({
        kind:'REPLY',username:post.username,sourcePostId:post.id,sourcePermalink:post.permalink,
        sourceText:post.text,text:reply,score:scored.score,status:this.config.mode==='autonomous'?'QUEUED':'DRAFT'
      });
      drafted++;
    }

    this.lastHunterAt=new Date().toISOString();
    console.log(JSON.stringify({level:'info',event:'hunter_cycle',source:'threads_api',query,posts:posts.length,candidates,drafted,mode:this.config.mode}));
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

    const groups=await Promise.all(queries.map(async query=>{
      const [top,recent]=await Promise.all([
        this.threads.search(query,'TOP',12),
        this.threads.search(query,'RECENT',12)
      ]);
      const mapRows=(rows:ThreadsPost[],type:'TOP'|'RECENT'):TrendEvidence[]=>rows
        .filter(p=>p.username.toLowerCase()!==this.ownUsername&&Boolean(p.text.trim()))
        .map((p,idx)=>({
          query,type,rank:idx+1,text:p.text,username:p.username,timestamp:p.timestamp,permalink:p.permalink
        }));
      return [...mapRows(top,'TOP'),...mapRows(recent,'RECENT')];
    }));

    const seen=new Set<string>(),out:TrendEvidence[]=[];
    for(const row of groups.flat()){
      const key=row.permalink||`${row.username}:${row.timestamp}:${row.text.slice(0,80)}`;
      if(seen.has(key))continue;
      seen.add(key);
      out.push(row);
    }
    console.log(JSON.stringify({level:'info',event:'trend_threads_api',queries:queries.length,evidence:out.length}));
    return out;
  }

  async contentOnce(){
    const hours=Math.max(1,Math.round(this.config.contentIntervalMs/3600_000));
    const slot=contentSlot(new Date(),hours);
    if(await this.db.getState('content_slot')===slot)return;
    if(Date.now()<this.nextContentAttemptAt)return;
    this.nextContentAttemptAt=Date.now()+20*60_000;

    let evidence:TrendEvidence[];
    try{evidence=await this.collectTrendEvidence();}
    catch(e){console.error(JSON.stringify({level:'error',event:'trend_threads_api_failed',code:e instanceof Error?e.message:'UNKNOWN'}));return;}

    const queries=new Set(evidence.map(x=>x.query)).size;

    try{
      const hasLiveEvidence=evidence.length>=6&&queries>=2;
      const evidenceText=hasLiveEvidence?formatTrendEvidence(evidence).slice(0,14000):'';
      const draft=hasLiveEvidence
        ? await this.llm.viralContent(evidenceText)
        : await this.llm.expertContent(evergreenTheme(slot));

      const minimumConfidence=hasLiveEvidence?70:75;
      if(draft.confidence<minimumConfidence){
        console.log(JSON.stringify({level:'info',event:'content_retry_low_confidence',slot,source:hasLiveEvidence?'threads_trends':'evergreen',theme:draft.theme,confidence:draft.confidence,retryMinutes:20}));
        return;
      }

      await this.db.createOutreach({
        kind:'CONTENT',
        sourceText:hasLiveEvidence?evidenceText:`EVERGREEN_THEME: ${evergreenTheme(slot)}`,
        text:draft.text,
        score:draft.confidence,
        status:this.config.mode==='autonomous'?'QUEUED':'DRAFT'
      });
      await this.db.setState('content_slot',slot);
      this.nextContentAttemptAt=0;
      this.lastContentAt=new Date().toISOString();
      console.log(JSON.stringify({
        level:'info',event:'content_drafted',slot,
        source:hasLiveEvidence?'threads_trends':'evergreen',
        theme:draft.theme,confidence:draft.confidence,evidence:evidence.length,mode:this.config.mode
      }));
    }catch(e){
      console.error(JSON.stringify({level:'error',event:'content_failed',slot,code:e instanceof Error?e.message:'UNKNOWN',retryMinutes:20}));
    }
  }
}
