import type { Config } from './config.js';
import { Database } from './db.js';
import { ThreadsClient } from './threads.js';
import { LlmClient } from './llm.js';
import { SocialCrawlClient, type SocialCrawlPost } from './socialcrawl.js';
import { OwnerNotifier } from './notifier.js';
import { scorePost,isHotIntent,isOptOut } from './scoring.js';
import { contentSlot, selectTrendQueries, formatTrendEvidence, type TrendEvidence } from './content.js';
import type { ThreadsPost } from './types.js';

const sleep=(ms:number,signal:AbortSignal)=>new Promise<void>(resolve=>{if(signal.aborted)return resolve();const t=setTimeout(done,ms);function done(){clearTimeout(t);signal.removeEventListener('abort',done);resolve()}signal.addEventListener('abort',done,{once:true})});
const virality=(p:SocialCrawlPost)=>p.likes+p.replies*2+p.shares*3+p.reposts*3+p.quotes*3;

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
  discoverySource='socialcrawl_threads_search';

  constructor(
    readonly config:Config,
    readonly db:Database,
    readonly threads:ThreadsClient,
    readonly llm:LlmClient,
    readonly socialCrawl:SocialCrawlClient,
    readonly notifier:OwnerNotifier
  ){}

  async start(signal:AbortSignal){
    const p=await this.threads.profile(); this.ownUsername=p.username.toLowerCase();
    await this.db.setState('threads_username',p.username);
    const scopes=await this.threads.debugScopes();
    if(scopes){
      const threadScopes=scopes.filter(s=>s.startsWith('threads_')).sort();
      console.log(JSON.stringify({level:'info',event:'threads_token_scopes',scopes:threadScopes}));
    }
    if(!this.socialCrawl.enabled){
      this.publicDiscoveryHealthy=false;
      this.discoveryIssue='SOCIALCRAWL_API_KEY_REQUIRED';
      console.warn(JSON.stringify({level:'warn',event:'socialcrawl_not_configured'}));
    }
    if(await this.db.getState('legacy_seen_release_v1')!=='done'){
      const released=await this.db.releaseLegacySeen();
      await this.db.setState('legacy_seen_release_v1','done');
      console.log(JSON.stringify({level:'info',event:'legacy_seen_released',released}));
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
    if(!this.socialCrawl.enabled){
      this.publicDiscoveryHealthy=false;
      this.discoveryIssue='SOCIALCRAWL_API_KEY_REQUIRED';
      this.lastHunterAt=new Date().toISOString();
      console.warn(JSON.stringify({level:'warn',event:'hunter_skipped',reason:this.discoveryIssue}));
      return;
    }
    const query=this.config.queries[this.queryCursor++%this.config.queries.length]!;
    let posts:SocialCrawlPost[];
    try{
      posts=await this.socialCrawl.search(query,14);
      this.publicDiscoveryHealthy=true;
      this.discoveryIssue=posts.length?'':'NO_MATCHES_THIS_QUERY';
    }catch(e){
      this.publicDiscoveryHealthy=false;
      this.discoveryIssue=e instanceof Error?e.message:'SOCIALCRAWL_FAILED';
      throw e;
    }

    let candidates=0,drafted=0,resolved=0,discoveredOnly=0;
    for(const post of posts){
      if(post.username.toLowerCase()===this.ownUsername||await this.db.seen(post.id))continue;
      await this.db.markSeen(post.id);
      if(await this.db.blocked(post.username))continue;
      const scored=scorePost(post.text,this.config.minLeadScore);
      console.log(JSON.stringify({level:'info',event:'lead_score',query,username:post.username,score:scored.score,reasons:scored.reasons,relevance:post.relevance,engagement:{likes:post.likes,replies:post.replies,shares:post.shares,reposts:post.reposts,quotes:post.quotes}}));
      if(!scored.shouldEngage)continue;
      const qualified=await this.llm.qualifyLead(post.text,post.username,query);
      console.log(JSON.stringify({level:'info',event:'lead_qualification',query,username:post.username,buyer:qualified.buyer,confidence:qualified.confidence,category:qualified.category,reason:qualified.reason}));
      if(!qualified.buyer)continue;
      candidates++;

      const official=await this.threads.resolveCandidate(post.id,post.permalink);
      const sourcePostId=official?.id??post.id;
      const permalink=official?.permalink||post.permalink;
      const username=official?.username||post.username;
      const text=official?.text||post.text;

      await this.db.upsertLead({
        username,score:scored.score,stage:scored.score>=80?'QUALIFIED':'WARM',
        sourcePostId,sourcePermalink:permalink,lastMessage:text,
        searchQuery:query,aiCategory:qualified.category,aiConfidence:qualified.confidence,aiReason:qualified.reason,
        officiallyResolved:Boolean(official)
      });
      console.log(JSON.stringify({level:'info',event:'lead_found',source:'socialcrawl',query,username,score:scored.score,officiallyResolved:Boolean(official),permalink}));

      if(!official){discoveredOnly++;continue;}
      resolved++;
      if(!await this.allowedByRate(username))continue;
      const reply=await this.llm.outreach(text,scored.language);
      await this.db.createOutreach({kind:'REPLY',username,sourcePostId:official.id,sourcePermalink:permalink,sourceText:text,text:reply,score:scored.score,status:this.config.mode==='autonomous'?'QUEUED':'DRAFT'});
      drafted++;
    }
    this.lastHunterAt=new Date().toISOString();
    console.log(JSON.stringify({level:'info',event:'hunter_cycle',source:'socialcrawl',query,posts:posts.length,candidates,resolved,discoveredOnly,drafted,creditsRemaining:this.socialCrawl.lastCreditsRemaining,mode:this.config.mode}));
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
    if(!this.socialCrawl.enabled)return [];
    const queries=selectTrendQueries(this.trendCursor,this.config.trendQueriesPerCycle);
    this.trendCursor=(this.trendCursor+this.config.trendQueriesPerCycle)%16;
    const groups=await Promise.all(queries.map(async query=>{
      const posts=await this.socialCrawl.search(query,7);
      return posts
        .filter(p=>p.username.toLowerCase()!==this.ownUsername)
        .sort((a,b)=>virality(b)-virality(a))
        .slice(0,8)
        .map((p,idx):TrendEvidence=>({
          query,type:'TOP',rank:idx+1,
          text:`[likes=${p.likes} replies=${p.replies} shares=${p.shares} reposts=${p.reposts} quotes=${p.quotes}] ${p.text}`,
          username:p.username,timestamp:p.timestamp,permalink:p.permalink
        }));
    }));
    const seen=new Set<string>(),out:TrendEvidence[]=[];
    for(const row of groups.flat()){
      if(!row.text.trim()||seen.has(row.permalink))continue;
      seen.add(row.permalink);out.push(row);
    }
    console.log(JSON.stringify({level:'info',event:'trend_socialcrawl',queries:queries.length,evidence:out.length,creditsRemaining:this.socialCrawl.lastCreditsRemaining}));
    return out;
  }

  async contentOnce(){
    const hours=Math.max(1,Math.round(this.config.contentIntervalMs/3600_000));
    const slot=contentSlot(new Date(),hours);
    if(await this.db.getState('content_slot')===slot||await this.db.getState('content_attempt_slot')===slot)return;
    await this.db.setState('content_attempt_slot',slot);
    if(!this.socialCrawl.enabled){
      console.warn(JSON.stringify({level:'warn',event:'content_skipped',reason:'SOCIALCRAWL_API_KEY_REQUIRED'}));
      return;
    }
    let evidence:TrendEvidence[];
    try{evidence=await this.collectTrendEvidence();}
    catch(e){console.error(JSON.stringify({level:'error',event:'trend_socialcrawl_failed',code:e instanceof Error?e.message:'UNKNOWN'}));return;}

    const queries=new Set(evidence.map(x=>x.query)).size;
    if(evidence.length<6||queries<2){
      console.log(JSON.stringify({level:'info',event:'viral_skip_weak_evidence',slot,evidence:evidence.length,queries}));
      return;
    }
    const evidenceText=formatTrendEvidence(evidence).slice(0,14000);
    const draft=await this.llm.viralContent(evidenceText);
    if(draft.confidence<70){
      console.log(JSON.stringify({level:'info',event:'viral_skip_low_confidence',slot,theme:draft.theme,confidence:draft.confidence}));
      return;
    }
    await this.db.createOutreach({kind:'CONTENT',sourceText:evidenceText,text:draft.text,score:draft.confidence,status:this.config.mode==='autonomous'?'QUEUED':'DRAFT'});
    await this.db.setState('content_slot',slot);
    this.lastContentAt=new Date().toISOString();
    console.log(JSON.stringify({level:'info',event:'viral_content_drafted',slot,theme:draft.theme,confidence:draft.confidence,evidence:evidence.length,mode:this.config.mode}));
  }
}
