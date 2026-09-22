import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { Database } from './db.js';
import { ThreadsClient } from './threads.js';
import { LlmClient } from './llm.js';
import { OwnerNotifier } from './notifier.js';
import { OutreachAgent } from './agent.js';
import { createHttp } from './http.js';

const config=loadConfig();

if(!config.databaseUrl){
  const server=createServer((req,res)=>{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    res.setHeader('cache-control','no-store');
    if(url.pathname==='/healthz'){
      res.statusCode=200;
      res.setHeader('content-type','application/json; charset=utf-8');
      res.end(JSON.stringify({ok:true,setupPending:true}));
      return;
    }
    if(url.pathname==='/readyz'){
      res.statusCode=503;
      res.setHeader('content-type','application/json; charset=utf-8');
      res.end(JSON.stringify({ready:false,setupPending:true,missing:['DATABASE_URL',...(!config.threads.token?['THREADS_ACCESS_TOKEN']:[]),...(!config.llm.key?['OPENAI_API_KEY']:[])]}));
      return;
    }
    res.statusCode=200;
    res.setHeader('content-type','text/html; charset=utf-8');
    res.end('<!doctype html><meta charset="utf-8"><title>Threads Outreach Agent</title><body style="font-family:system-ui;background:#0b0c10;color:#f4f4f5;padding:40px"><h1>Threads Outreach Agent</h1><p>Infrastructure is ready. Setup is pending required credentials.</p><p>Agent mode: <strong>review</strong>. No outreach or publishing is running.</p></body>');
  });
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'0.0.0.0',()=>resolve());});
  console.warn(JSON.stringify({level:'warn',event:'setup_pending',missing:['DATABASE_URL',...(!config.threads.token?['THREADS_ACCESS_TOKEN']:[]),...(!config.llm.key?['OPENAI_API_KEY']:[])]}));
  const stop=(signal:string)=>{console.log(JSON.stringify({level:'info',event:'shutdown',signal}));server.close(()=>process.exit(0));};
  process.once('SIGTERM',()=>stop('SIGTERM'));
  process.once('SIGINT',()=>stop('SIGINT'));
}else{
  const db=new Database(config.databaseUrl);
  await db.migrate();
  const threads=new ThreadsClient(config.threads.token,config.threads.baseUrl);
  const llm=new LlmClient(config.llm.key,config.llm.baseUrl,config.llm.model,config.llm.webSearchModel);
  const notifier=new OwnerNotifier(config.telegram.token,config.telegram.chatId,config.telegram.bindCode,db);
  const agent=new OutreachAgent(config,db,threads,llm,notifier);
  const abort=new AbortController();
  const server=createHttp(agent);
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'0.0.0.0',()=>resolve());});
  console.log(JSON.stringify({level:'info',event:'http_started',port:config.port,mode:config.mode}));
  const loops=Promise.all([agent.start(abort.signal),notifier.start(abort.signal)]);
  let stopping=false;
  async function stop(signal:string){if(stopping)return;stopping=true;console.log(JSON.stringify({level:'info',event:'shutdown',signal}));abort.abort();await new Promise<void>(r=>server.close(()=>r()));await Promise.allSettled([loops]);await db.close();}
  process.once('SIGTERM',()=>void stop('SIGTERM'));process.once('SIGINT',()=>void stop('SIGINT'));
}
