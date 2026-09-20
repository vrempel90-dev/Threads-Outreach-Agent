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

  async viralContent(evidence:string):Promise<ViralDraft>{
    const system=`You are a real-time Threads editor for a specialist who builds AI agents, chatbots and business automations. You receive live web evidence from public Threads post sources. First infer ONE topic that is genuinely active now from repeated/strong evidence. Then write an ORIGINAL Russian Threads post that connects that topic to a concrete business implication.

Return exactly JSON {"text":"...","theme":"...","confidence":0}. confidence is 0-100 and must reflect how strongly the supplied evidence supports that this theme is active now.

Rules:
- Never claim a trend unless it is supported by the supplied evidence.
- Never copy or closely paraphrase a source post.
- Never invent news, launches, statistics, client cases, revenue, prices or results.
- If evidence conflicts or is weak, confidence must be below 70.
- Strong hook in the first line; specific insight; one tension/contrarian angle where justified.
- Make the reader want to comment from their own business experience.
- No generic motivational AI hype.
- The post must still make sense if the reader has not seen the source posts.
- Max 480 characters.
- End with one concise question that reveals a real business problem.`;
    const out=await this.complete(system,evidence);
    const text=typeof out?.text==='string'?out.text.trim():'';
    const theme=typeof out?.theme==='string'?out.theme.trim():'';
    const confidence=Number(out?.confidence);
    if(!text||[...text].length>500||!theme||!Number.isFinite(confidence)||confidence<0||confidence>100) throw new Error('LLM_BAD_VIRAL_DRAFT');
    return {text,theme,confidence:Math.round(confidence)};
  }
}
