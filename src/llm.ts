import type { Language } from './types.js';

const parseJson=(text:string):any=>{
  const clean=text.trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  try{return JSON.parse(clean)}catch{}
  const a=clean.indexOf('{'),b=clean.lastIndexOf('}');
  if(a>=0&&b>a) return JSON.parse(clean.slice(a,b+1));
  throw new Error('LLM_INVALID_JSON');
};

const normalizeThreadsUrl=(raw:string):string=>{
  try{
    const u=new URL(raw);
    const host=u.hostname.toLowerCase().replace(/^www\./,'');
    if(host!=='threads.net')return '';
    const path=u.pathname.replace(/\/+$/,'');
    if(!/\/@[^/]+\/post\/[A-Za-z0-9_-]+/u.test(path))return '';
    return `https://threads.net${path}`;
  }catch{return '';}
};

const usernameFromThreadsUrl=(raw:string):string=>{
  try{
    const m=new URL(raw).pathname.match(/\/@([^/]+)\/post\//u);
    return m?.[1]?decodeURIComponent(m[1]).replace(/^@/,''):'';
  }catch{return '';}
};

const responseText=(x:any):string=>{
  const parts:string[]=[];
  for(const item of Array.isArray(x?.output)?x.output:[]){
    if(item?.type!=='message'||!Array.isArray(item.content))continue;
    for(const c of item.content)if(c?.type==='output_text'&&typeof c.text==='string')parts.push(c.text);
  }
  return parts.join('\n').trim();
};

const responseSources=(x:any):string[]=>{
  const urls:string[]=[];
  for(const item of Array.isArray(x?.output)?x.output:[]){
    if(item?.type!=='web_search_call')continue;
    const sources=item?.action?.sources;
    if(!Array.isArray(sources))continue;
    for(const s of sources)if(typeof s?.url==='string')urls.push(s.url);
  }
  return urls;
};

export interface ViralDraft {
  text:string;
  theme:string;
  confidence:number;
}

export interface LeadQualification {
  buyer:boolean;
  confidence:number;
  category:'buyer'|'seller'|'job'|'general'|'unclear';
  reason:string;
}

export interface WebThreadSignal {
  query:string;
  url:string;
  username:string;
  text:string;
  timestamp:string;
  confidence:number;
}

export class LlmClient {
  constructor(
    private readonly key:string,
    private readonly baseUrl:string,
    private readonly model:string,
    private readonly webSearchModel:string
  ){}

  private async complete(system:string,user:string):Promise<any>{
    const res=await fetch(`${this.baseUrl}/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${this.key}`,'content-type':'application/json'},body:JSON.stringify({model:this.model,max_completion_tokens:800,reasoning_effort:'minimal',messages:[{role:'system',content:system},{role:'user',content:user}],response_format:{type:'json_object'}})});
    const x=await res.json().catch(()=>null) as any;
    if(!res.ok) throw new Error(`LLM_${x?.error?.code??res.status}`);
    const text=x?.choices?.[0]?.message?.content; if(typeof text!=='string'||!text.trim()) throw new Error('LLM_EMPTY');
    return parseJson(text);
  }

  async webThreadSignals(queries:string[],purpose:'lead'|'trend',limit=8):Promise<WebThreadSignal[]>{
    const cleanQueries=queries.map(x=>x.trim()).filter(Boolean).slice(0,8);
    if(!cleanQueries.length)return [];
    const today=new Date().toISOString().slice(0,10);
    const task=purpose==='lead'
      ? 'Find recent public Threads posts written by potential buyers who are asking for, considering, or describing a business pain that could be solved by an AI agent, chatbot, CRM automation, lead handling, appointment automation, support automation, or sales automation.'
      : 'Find public Threads posts that show which AI, automation, chatbot, agent, CRM, sales or business-operations topics are actively being discussed right now. Prefer posts from the last 7 days and direct post permalinks.';
    const prompt=`You are a web research component for a Threads business agent. Today is ${today}.
You MUST use web search. Search only public pages on threads.net.

Task: ${task}

Queries/themes:
${cleanQueries.map((q,i)=>`${i+1}. ${q}`).join('\n')}

Return ONLY valid JSON:
{"signals":[{"query":"one of the supplied queries","url":"exact Threads post permalink from a web-search source","username":"Threads username without @","text":"short faithful excerpt or concise summary of what the author is asking/discussing","timestamp":"ISO date/time if visible, otherwise empty string","confidence":0}]}

Rules:
- maximum ${Math.max(1,Math.min(15,limit))} signals;
- every URL must be an exact public Threads POST permalink found in web search, never a profile URL;
- do not invent URLs, usernames, post text, dates, companies, demand, or intent;
- exclude our own marketing/seller posts when purpose is lead discovery;
- for lead discovery, include only posts with plausible buyer intent or a concrete operational pain;
- confidence is 0-100 for how well the source supports the extracted signal;
- if there are no qualifying public Threads post sources, return {"signals":[]}.
`;

    const models=[...new Set([this.webSearchModel,this.model].filter(Boolean))];
    let lastError='OPENAI_WEB_SEARCH_FAILED';
    for(const model of models){
      const res=await fetch(`${this.baseUrl}/responses`,{
        method:'POST',
        headers:{authorization:`Bearer ${this.key}`,'content-type':'application/json'},
        body:JSON.stringify({
          model,
          tools:[{type:'web_search',search_context_size:'low',filters:{allowed_domains:['threads.net']}}],
          tool_choice:'auto',
          include:['web_search_call.action.sources'],
          max_output_tokens:1200,
          input:prompt
        })
      });
      const x=await res.json().catch(()=>null) as any;
      if(!res.ok){
        lastError=`OPENAI_WEB_SEARCH_${x?.error?.code??res.status}`;
        continue;
      }
      const text=responseText(x);
      if(!text)return [];
      const out=parseJson(text);
      const sources=new Set(responseSources(x).map(normalizeThreadsUrl).filter(Boolean));
      const rows=Array.isArray(out?.signals)?out.signals:[];
      const unique=new Set<string>(),signals:WebThreadSignal[]=[];
      for(const row of rows){
        const url=normalizeThreadsUrl(typeof row?.url==='string'?row.url:'');
        if(!url||!sources.has(url)||unique.has(url))continue;
        const textValue=typeof row?.text==='string'?row.text.trim().slice(0,700):'';
        if(textValue.length<8)continue;
        const username=usernameFromThreadsUrl(url)||String(row?.username??'').trim().replace(/^@/,'');
        if(!username)continue;
        const query=cleanQueries.includes(String(row?.query??''))?String(row.query):cleanQueries[0]!;
        const confidence=Math.max(0,Math.min(100,Math.round(Number(row?.confidence)||0)));
        unique.add(url);
        signals.push({query,url,username,text:textValue,timestamp:typeof row?.timestamp==='string'?row.timestamp.trim():'',confidence});
        if(signals.length>=limit)break;
      }
      console.log(JSON.stringify({level:'info',event:'openai_web_search',purpose,model,queries:cleanQueries.length,sources:sources.size,signals:signals.length}));
      return signals;
    }
    throw new Error(lastError);
  }

  async qualifyLead(postText:string,username:string,query:string):Promise<LeadQualification>{
    const system=`You are a strict B2B lead qualification classifier for a developer who sells AI agents, chatbots and business automation. Return JSON only: {"buyer":true,"confidence":0,"category":"buyer","reason":"..."}. Categories: buyer, seller, job, general, unclear.

A buyer is someone plausibly asking for a provider or solution for an AI agent, chatbot, AI assistant, AI administrator, CRM/workflow automation, lead handling, support automation, appointment automation or sales automation; OR describing a concrete operational pain and explicitly wanting to automate it.
Prioritize direct commercial signals such as "нужен", "ищу", "кто сделает", "сколько стоит", "хотим внедрить", "керек", "бағасы".
Reject human-service professions that merely use the word "agent" (real-estate agent, travel agent, insurance agent, talent agent, etc.), sellers/agencies/developers promoting their own AI or automation services, recruiters/job-seekers, generic educational/news posts, engagement bait, and vague mentions with no buying or operational intent.
A post from Kazakhstan/CIS is strategically relevant, but location alone NEVER makes it a buyer.
Do not infer buyer intent merely because the post contains AI, automation, CRM, chatbot, business, developer, sales or lead keywords.
Use confidence 0-100. Keep reason under 120 characters.`;
    const out=await this.complete(system,`SEARCH QUERY: ${query}\nUSERNAME: @${username}\nPOST:\n${postText}`);
    const category=String(out?.category??'unclear') as LeadQualification['category'];
    const confidence=Math.max(0,Math.min(100,Math.round(Number(out?.confidence)||0)));
    const buyer=Boolean(out?.buyer)&&category==='buyer'&&confidence>=70;
    const reason=typeof out?.reason==='string'?out.reason.trim().slice(0,120):'';
    return {buyer,confidence,category:['buyer','seller','job','general','unclear'].includes(category)?category:'unclear',reason};
  }

  async outreach(postText:string,language:Language):Promise<string>{
    const system=`You write one Threads reply for B2B lead generation for a developer who builds AI agents, chatbots and business automations. Language: ${language}. Return JSON {"reply":"..."}. Rules: 1) respond to the exact post, 2) useful before promotional, 3) never invent clients, metrics, prices, integrations or results, 4) no fake personal story, 5) no manipulative urgency, 6) at most one natural question, 7) do not say "we use AI" unless relevant, 8) do not open with generic praise, 9) max 420 characters, 10) if the author explicitly seeks a developer/solution, it is acceptable to say you build these systems and can show an approach; otherwise diagnose the process first. The goal is a genuine business conversation, not engagement spam.`;
    const out=await this.complete(system,postText);
    const reply=typeof out?.reply==='string'?out.reply.trim():''; if(!reply||[...reply].length>450) throw new Error('LLM_BAD_REPLY'); return reply;
  }

  async followUp(context:string,inbound:string,language:Language):Promise<string>{
    const system=`You continue a Threads B2B conversation about AI agents, chatbots or business automation. Language: ${language}. Return JSON {"reply":"..."}. Be concise, answer what the person actually wrote, ask at most one next qualifying question, never invent price/results/cases, and never pressure. Max 420 characters.`;
    const out=await this.complete(system,`CONTEXT:\n${context}\n\nNEW REPLY:\n${inbound}`);
    const reply=typeof out?.reply==='string'?out.reply.trim():''; if(!reply||[...reply].length>450) throw new Error('LLM_BAD_REPLY'); return reply;
  }

  async expertContent(theme:string):Promise<ViralDraft>{
    const system=`You are a Threads editor for a specialist who builds AI agents, chatbots and business automations. Write ONE original Russian post based only on the supplied theme.

Return exactly JSON {"text":"...","theme":"...","confidence":0}.

Rules:
- text MUST be 220-430 characters, never above 450;
- confidence is writing-quality confidence, 0-100;
- do not invent news, statistics, clients, revenue, prices, integrations or results;
- no fake personal experience or fabricated case study;
- make the first line concrete and scroll-stopping without clickbait;
- give one practical business insight involving leads, sales, support, appointments, CRM or repetitive work;
- end with either one sharp question OR one low-pressure invitation, never both;
- avoid generic AI hype and phrases like "AI will change everything";
- optimize for saves, replies and qualified inbound interest, but never claim virality.`;

    const out=await this.complete(system,`THEME:\n${theme}`);
    const text=typeof out?.text==='string'?out.text.trim():'';
    const draftTheme=typeof out?.theme==='string'?out.theme.trim():theme;
    const confidence=Math.max(0,Math.min(100,Math.round(Number(out?.confidence)||0)));
    const len=[...text].length;
    if(!text||len<80||len>450)throw new Error('LLM_BAD_EXPERT_DRAFT');
    return {text,theme:draftTheme||theme,confidence};
  }

  async viralContent(evidence:string):Promise<ViralDraft>{
    const system=`You are a real-time Threads editor for a specialist who builds AI agents, chatbots and business automations. You receive live evidence collected from public Threads posts. Infer ONE topic that is genuinely active now, then write an ORIGINAL Russian Threads post connecting it to a concrete business implication.

Return exactly JSON {"text":"...","theme":"...","confidence":0}.

Hard rules:
- text MUST be 280-430 characters, never above 450;
- confidence is 0-100 and reflects evidence strength;
- never invent news, launches, statistics, clients, revenue, prices or results;
- never copy or closely paraphrase source posts;
- no generic motivational AI hype, "AI will change everything", or empty engagement bait;
- first line must create a specific curiosity gap, tension, mistake, cost, or counterintuitive observation grounded in the evidence;
- make the body useful to a business owner: show one concrete operational implication involving leads, sales, support, appointments, CRM or repetitive work;
- end with either one sharp question OR one low-pressure invitation to discuss the process; never use both;
- vary structures across posts: contrarian observation, mini teardown, costly mistake, before/after process, practical checklist insight;
- do not claim a post will go viral; optimize for relevance, specificity, saves, replies and qualified inbound interest;
- if evidence is weak or conflicting, confidence must be below 70.`;

    const parseDraft=(out:any):ViralDraft|null=>{
      const text=typeof out?.text==='string'?out.text.trim():'';
      const theme=typeof out?.theme==='string'?out.theme.trim():'';
      const confidence=Number(out?.confidence);
      if(!text||!theme||!Number.isFinite(confidence)||confidence<0||confidence>100)return null;
      const len=[...text].length;
      if(len<80||len>500)return null;
      return {text,theme,confidence:Math.round(confidence)};
    };

    const first=await this.complete(system,evidence);
    const draft=parseDraft(first);
    if(draft)return draft;

    console.warn(JSON.stringify({
      level:'warn',event:'viral_draft_repair',
      textLength:typeof first?.text==='string'?[...first.text.trim()].length:null,
      hasTheme:typeof first?.theme==='string'&&Boolean(first.theme.trim()),
      confidence:Number.isFinite(Number(first?.confidence))?Number(first.confidence):null
    }));

    const repaired=await this.complete(
      `Repair a Threads draft into valid JSON only: {"text":"...","theme":"...","confidence":0}. Keep the factual meaning. text MUST be 350-430 characters and never exceed 450. Do not add facts, statistics, claims, clients, prices or results that were not already supported. confidence must be 0-100.`,
      JSON.stringify(first)
    );
    const fixed=parseDraft(repaired);
    if(!fixed)throw new Error('LLM_BAD_VIRAL_DRAFT');
    return fixed;
  }
}
