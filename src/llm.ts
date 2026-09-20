import type { Language } from './types.js';

const parseJson=(text:string):any=>{
  const clean=text.trim().replace(/^```(?:json)?/i,'').replace(/```$/,'').trim();
  try{return JSON.parse(clean)}catch{}
  const a=clean.indexOf('{'),b=clean.lastIndexOf('}');
  if(a>=0&&b>a) return JSON.parse(clean.slice(a,b+1));
  throw new Error('LLM_INVALID_JSON');
};

export interface ViralDraft {
  text:string;
  theme:string;
  confidence:number;
}

export class LlmClient {
  constructor(private readonly key:string, private readonly baseUrl:string, private readonly model:string){}
  private async complete(system:string,user:string):Promise<any>{
    const res=await fetch(`${this.baseUrl}/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${this.key}`,'content-type':'application/json'},body:JSON.stringify({model:this.model,max_completion_tokens:800,reasoning_effort:'minimal',messages:[{role:'system',content:system},{role:'user',content:user}],response_format:{type:'json_object'}})});
    const x=await res.json().catch(()=>null) as any;
    if(!res.ok) throw new Error(`LLM_${x?.error?.code??res.status}`);
    const text=x?.choices?.[0]?.message?.content; if(typeof text!=='string'||!text.trim()) throw new Error('LLM_EMPTY');
    return parseJson(text);
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
    const system=`You are a real-time Threads editor for a specialist who builds AI agents, chatbots and business automations. You receive live evidence collected from Threads TOP and RECENT keyword search. First infer ONE topic that is genuinely active now from repeated/strong evidence. Then write an ORIGINAL Russian Threads post that connects that topic to a concrete business implication.

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
