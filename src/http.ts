import { createServer } from 'node:http';
import type { OutreachAgent } from './agent.js';

const json=(res:any,status:number,data:unknown)=>{res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(data));};
const authorized=(req:any,token:string)=>!token||req.headers.authorization===`Bearer ${token}`;
const esc=(value:unknown)=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));
const threadsHref=(raw:unknown):string=>{
  try{
    const u=new URL(String(raw??''));
    const host=u.hostname.toLowerCase().replace(/^www\./,'');
    return u.protocol==='https:'&&(host==='threads.net'||host==='threads.com')?u.toString():'';
  }catch{return '';}
};
const excerpt=(value:unknown,max=180)=>{const s=String(value??'').replace(/\s+/g,' ').trim();return s.length>max?s.slice(0,max-1)+'…':s;};

export function createHttp(agent:OutreachAgent){
  return createServer(async(req,res)=>{
    try{
      const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
      if(url.pathname==='/healthz'){json(res,200,{ok:true});return;}
      if(url.pathname==='/readyz'){
        const db=await agent.db.health();
        const configured=Boolean(agent.config.threads.token&&agent.config.llm.key);
        let threads=false;
        if(agent.config.threads.token){try{await agent.threads.profile();threads=true}catch{}}
        json(res,db&&configured&&threads?200:503,{ready:db&&configured&&threads,db,configured,threads,mode:agent.config.mode,missing:[
          ...(!agent.config.threads.token?['THREADS_ACCESS_TOKEN']:[]),
          ...(!agent.config.llm.key?['OPENAI_API_KEY']:[])
        ]});return;
      }
      if(url.pathname==='/'){
        const [counts,leads]=await Promise.all([agent.db.counts(),agent.db.listDashboardLeads(30)]);
        const rows=leads.map(lead=>{
          const href=threadsHref(lead.source_permalink);
          const link=href?`<a class="open" href="${esc(href)}" target="_blank" rel="noopener noreferrer">Открыть пост ↗</a>`:'<span class="muted">Нет ссылки</span>';
          const api=lead.officially_resolved?'<span class="pill ok">API ID ✓</span>':'<span class="pill wait">только лид</span>';
          return `<tr>
            <td><strong>@${esc(lead.username)}</strong><div class="small">${esc(lead.search_query||'—')}</div></td>
            <td><span class="stage">${esc(lead.stage)}</span></td>
            <td class="score">${esc(lead.score)}</td>
            <td><strong>${esc(lead.ai_confidence??'—')}%</strong><div class="small">${esc(lead.ai_reason||'—')}</div></td>
            <td><div class="message">${esc(excerpt(lead.last_message))}</div></td>
            <td>${api}<div class="link">${link}</div></td>
            <td><time datetime="${esc(lead.updated_at)}">${esc(lead.updated_at)}</time></td>
          </tr>`;
        }).join('');
        const empty=rows?'':`<tr><td colspan="7" class="empty">Подтверждённых buyer-лидов пока нет. Агент продолжает поиск автоматически.</td></tr>`;
        res.statusCode=200;
        res.setHeader('content-type','text/html; charset=utf-8');
        res.setHeader('cache-control','no-store');
        res.setHeader('x-robots-tag','noindex, nofollow');
        res.end(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><meta name="robots" content="noindex,nofollow"><title>Threads Outreach Agent</title><style>
          :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b0c10;color:#f4f4f5;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:1280px;margin:0 auto;padding:36px 20px 60px}h1{margin:0 0 8px;font-size:32px}.sub{color:#a1a1aa;margin-bottom:26px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}.card,.panel{background:#12141a;border:1px solid #272a33;border-radius:14px}.card{padding:18px}.n{font-size:32px;font-weight:800}.label,.small,.muted{color:#a1a1aa;font-size:13px}.panel{padding:18px;margin-top:14px}.status{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;font-size:14px}.status b{display:block;margin-top:4px;color:#fff}.table-wrap{overflow:auto;margin-top:12px;border:1px solid #272a33;border-radius:12px}table{width:100%;border-collapse:collapse;min-width:1050px;background:#101218}th,td{padding:13px 12px;text-align:left;vertical-align:top;border-bottom:1px solid #242731}th{font-size:12px;color:#a1a1aa;text-transform:uppercase;letter-spacing:.05em;background:#151820;position:sticky;top:0}tr:last-child td{border-bottom:0}.score{font-size:20px;font-weight:800}.stage,.pill{display:inline-block;border-radius:999px;padding:4px 8px;font-size:12px;font-weight:700;background:#252936}.pill.ok{background:#123c2c;color:#9ff5c7}.pill.wait{background:#3b3012;color:#f3d77a}.message{max-width:340px;line-height:1.4}.open{display:inline-block;margin-top:7px;color:#8ab4ff;text-decoration:none}.open:hover{text-decoration:underline}.link{white-space:nowrap}.empty{text-align:center;color:#a1a1aa;padding:28px}code{background:#222630;padding:2px 6px;border-radius:5px}@media(max-width:800px){.grid{grid-template-columns:repeat(2,1fr)}.status{grid-template-columns:1fr}.wrap{padding-top:24px}}
        </style></head><body><main class="wrap">
          <h1>Threads Outreach Agent</h1>
          <div class="sub">Автономный поиск buyer-лидов · Threads <code>@${esc(agent.ownUsername||'starting')}</code> · режим <code>${esc(agent.config.mode)}</code></div>
          <section class="grid">
            <div class="card"><div class="n">${counts.leads}</div><div class="label">Всего лидов</div></div>
            <div class="card"><div class="n">${counts.hot}</div><div class="label">HOT</div></div>
            <div class="card"><div class="n">${leads.length}</div><div class="label">Подтверждено AI</div></div>
            <div class="card"><div class="n">${counts.sent}</div><div class="label">Отправлено</div></div>
          </section>
          <section class="panel"><div class="status">
            <div><span class="label">Источник поиска</span><b>${esc(agent.discoverySource)}</b></div>
            <div><span class="label">Public discovery</span><b>${agent.publicDiscoveryHealthy===true?'OK':agent.publicDiscoveryHealthy===false?'WAITING':'UNKNOWN'}${agent.discoveryIssue?' · '+esc(agent.discoveryIssue):''}</b></div>
            <div><span class="label">Последний hunter</span><b><time datetime="${esc(agent.lastHunterAt??'')}">${esc(agent.lastHunterAt??'—')}</time></b></div>
          </div></section>
          <section class="panel"><h2>Найденные лиды</h2><div class="small">Показываются только лиды, подтверждённые AI как потенциальные покупатели. Обновление страницы — раз в 60 секунд.</div>
            <div class="table-wrap"><table><thead><tr><th>Threads</th><th>Стадия</th><th>Score</th><th>AI оценка</th><th>Сигнал</th><th>Пост</th><th>Обновлён</th></tr></thead><tbody>${rows||empty}</tbody></table></div>
          </section>
          <section class="panel small">Inbound: ${esc(agent.lastInboundAt??'—')} · Content: ${esc(agent.lastContentAt??'—')} · Last error: ${esc(agent.lastError??'—')}</section>
        </main><script>for(const el of document.querySelectorAll('time[datetime]')){const d=new Date(el.getAttribute('datetime'));if(!Number.isNaN(d.getTime()))el.textContent=d.toLocaleString();}</script></body></html>`);
        return;
      }
      if(url.pathname.startsWith('/api/')&&!authorized(req,agent.config.dashboardToken)){json(res,401,{error:'unauthorized'});return;}
      if(url.pathname==='/api/status'){json(res,200,{mode:agent.config.mode,username:agent.ownUsername,discoverySource:agent.discoverySource,lastHunterAt:agent.lastHunterAt,lastInboundAt:agent.lastInboundAt,lastContentAt:agent.lastContentAt,lastError:agent.lastError,publicDiscoveryHealthy:agent.publicDiscoveryHealthy,discoveryIssue:agent.discoveryIssue,counts:await agent.db.counts()});return;}
      if(url.pathname==='/api/leads'){json(res,200,{data:await agent.db.listLeads()});return;}
      if(url.pathname==='/api/outreach'){json(res,200,{data:await agent.db.listOutreach()});return;}
      if(req.method==='POST'&&url.pathname==='/api/run-hunter'){await agent.hunterOnce();json(res,200,{ok:true});return;}
      if(req.method==='POST'&&url.pathname==='/api/run-content'){await agent.contentOnce();json(res,200,{ok:true});return;}
      json(res,404,{error:'not_found'});
    }catch(e){console.error(e);json(res,500,{error:e instanceof Error?e.message:'internal_error'});}
  });
}
