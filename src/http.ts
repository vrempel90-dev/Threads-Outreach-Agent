import { createServer } from 'node:http';
import type { OutreachAgent } from './agent.js';

const json=(res:any,status:number,data:unknown)=>{res.statusCode=status;res.setHeader('content-type','application/json; charset=utf-8');res.setHeader('cache-control','no-store');res.end(JSON.stringify(data));};
const authorized=(req:any,token:string)=>!token||req.headers.authorization===`Bearer ${token}`;

export function createHttp(agent:OutreachAgent){
  return createServer(async(req,res)=>{
    try{
      const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
      if(url.pathname==='/healthz'){json(res,200,{ok:true});return;}
      if(url.pathname==='/readyz'){
        const db=await agent.db.health();
        let threads=false;try{await agent.threads.profile();threads=true}catch{}
        json(res,db&&threads?200:503,{ready:db&&threads,db,threads,mode:agent.config.mode});return;
      }
      if(url.pathname==='/'){
        const counts=await agent.db.counts();
        res.statusCode=200;res.setHeader('content-type','text/html; charset=utf-8');
        res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Threads Outreach Agent</title><style>body{font-family:system-ui;max-width:900px;margin:48px auto;padding:0 20px}code{background:#eee;padding:2px 6px;border-radius:5px}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{border:1px solid #ddd;border-radius:12px;padding:18px}.n{font-size:32px;font-weight:700}</style></head><body><h1>Threads Outreach Agent</h1><p>Mode: <code>${agent.config.mode}</code> · Threads: <code>@${agent.ownUsername||'starting'}</code></p><div class="grid"><div class="card"><div class="n">${counts.leads}</div>Leads</div><div class="card"><div class="n">${counts.hot}</div>HOT</div><div class="card"><div class="n">${counts.drafts}</div>Drafts</div><div class="card"><div class="n">${counts.sent}</div>Sent</div></div><p>Hunter: ${agent.lastHunterAt??'—'}<br>Inbound: ${agent.lastInboundAt??'—'}<br>Content: ${agent.lastContentAt??'—'}<br>Last error: ${agent.lastError??'—'}</p><p>Private API: <code>/api/leads</code>, <code>/api/outreach</code>, <code>/api/run-hunter</code>, <code>/api/run-content</code>.</p></body></html>`);return;
      }
      if(url.pathname.startsWith('/api/')&&!authorized(req,agent.config.dashboardToken)){json(res,401,{error:'unauthorized'});return;}
      if(url.pathname==='/api/status'){json(res,200,{mode:agent.config.mode,username:agent.ownUsername,lastHunterAt:agent.lastHunterAt,lastInboundAt:agent.lastInboundAt,lastContentAt:agent.lastContentAt,lastError:agent.lastError,counts:await agent.db.counts()});return;}
      if(url.pathname==='/api/leads'){json(res,200,{data:await agent.db.listLeads()});return;}
      if(url.pathname==='/api/outreach'){json(res,200,{data:await agent.db.listOutreach()});return;}
      if(req.method==='POST'&&url.pathname==='/api/run-hunter'){await agent.hunterOnce();json(res,200,{ok:true});return;}
      if(req.method==='POST'&&url.pathname==='/api/run-content'){await agent.contentOnce();json(res,200,{ok:true});return;}
      json(res,404,{error:'not_found'});
    }catch(e){console.error(e);json(res,500,{error:e instanceof Error?e.message:'internal_error'});}
  });
}
