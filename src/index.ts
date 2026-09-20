import { loadConfig } from './config.js';
import { Database } from './db.js';
import { ThreadsClient } from './threads.js';
import { LlmClient } from './llm.js';
import { OwnerNotifier } from './notifier.js';
import { OutreachAgent } from './agent.js';
import { createHttp } from './http.js';

const config=loadConfig();
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
