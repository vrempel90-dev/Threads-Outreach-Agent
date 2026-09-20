import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { LeadRow } from './types.js';

const { Pool } = pg;

export class Database {
  readonly pool: pg.Pool;
  constructor(url: string) { this.pool = new Pool({ connectionString: url, max: 5, options: '-c search_path=threads_outreach,public' }); }

  async migrate() {
    await this.pool.query(`
      CREATE SCHEMA IF NOT EXISTS threads_outreach;
      CREATE TABLE IF NOT EXISTS leads (
        username text PRIMARY KEY,
        score integer NOT NULL DEFAULT 0,
        stage text NOT NULL DEFAULT 'COLD',
        source_post_id text,
        source_permalink text,
        last_message text,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS seen_posts (
        post_id text PRIMARY KEY,
        seen_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS blocked_users (
        username text PRIMARY KEY,
        reason text NOT NULL DEFAULT 'opt_out',
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS outreach (
        id uuid PRIMARY KEY,
        kind text NOT NULL CHECK(kind IN ('REPLY','CONTENT')),
        username text,
        source_post_id text,
        source_permalink text,
        source_text text,
        text text NOT NULL,
        score integer NOT NULL DEFAULT 0,
        status text NOT NULL CHECK(status IN ('DRAFT','QUEUED','SENT','FAILED')),
        external_id text,
        error_code text,
        created_at timestamptz NOT NULL DEFAULT now(),
        sent_at timestamptz
      );
      CREATE UNIQUE INDEX IF NOT EXISTS outreach_unique_source_reply
        ON outreach(source_post_id) WHERE kind='REPLY' AND source_post_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS inbound (
        post_id text PRIMARY KEY,
        username text NOT NULL,
        parent_external_id text,
        text text NOT NULL,
        permalink text,
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS runtime_state (
        key text PRIMARY KEY,
        value text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
  }

  async health(): Promise<boolean> {
    try { await this.pool.query('SELECT 1'); return true; } catch { return false; }
  }
  async close() { await this.pool.end(); }

  async seen(postId: string) { return Boolean((await this.pool.query('SELECT 1 FROM seen_posts WHERE post_id=$1',[postId])).rowCount); }
  async markSeen(postId: string) { await this.pool.query('INSERT INTO seen_posts(post_id) VALUES($1) ON CONFLICT DO NOTHING',[postId]); }
  async blocked(username: string) { return Boolean((await this.pool.query('SELECT 1 FROM blocked_users WHERE username=$1',[username.toLowerCase()])).rowCount); }
  async block(username: string, reason='opt_out') { await this.pool.query('INSERT INTO blocked_users(username,reason) VALUES($1,$2) ON CONFLICT(username) DO UPDATE SET reason=excluded.reason',[username.toLowerCase(),reason]); }

  async upsertLead(input:{username:string;score:number;stage:string;sourcePostId?:string;sourcePermalink?:string;lastMessage?:string}) {
    await this.pool.query(`INSERT INTO leads(username,score,stage,source_post_id,source_permalink,last_message)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(username) DO UPDATE SET score=GREATEST(leads.score,excluded.score), stage=excluded.stage,
      source_post_id=COALESCE(excluded.source_post_id,leads.source_post_id), source_permalink=COALESCE(excluded.source_permalink,leads.source_permalink),
      last_message=COALESCE(excluded.last_message,leads.last_message), updated_at=now()`,
      [input.username.toLowerCase(),input.score,input.stage,input.sourcePostId??null,input.sourcePermalink??null,input.lastMessage??null]);
  }

  async recentContact(username:string, days:number):Promise<boolean>{
    const r=await this.pool.query(`SELECT 1 FROM outreach WHERE username=$1 AND status IN ('QUEUED','SENT') AND created_at>now()-($2::text||' days')::interval LIMIT 1`,[username.toLowerCase(),String(days)]);
    return Boolean(r.rowCount);
  }
  async sentCount(hours:number):Promise<number>{
    const r=await this.pool.query<{count:string}>(`SELECT count(*)::text count FROM outreach WHERE status='SENT' AND sent_at>now()-($1::text||' hours')::interval`,[String(hours)]);
    return Number(r.rows[0]?.count??0);
  }
  async createOutreach(input:{kind:'REPLY'|'CONTENT';username?:string;sourcePostId?:string;sourcePermalink?:string;sourceText?:string;text:string;score?:number;status:'DRAFT'|'QUEUED'}){
    const id=randomUUID();
    await this.pool.query(`INSERT INTO outreach(id,kind,username,source_post_id,source_permalink,source_text,text,score,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [id,input.kind,input.username?.toLowerCase()??null,input.sourcePostId??null,input.sourcePermalink??null,input.sourceText??null,input.text,input.score??0,input.status]);
    return id;
  }
  async pending(limit=10){ return (await this.pool.query(`SELECT * FROM outreach WHERE status='QUEUED' ORDER BY created_at ASC LIMIT $1`,[limit])).rows; }
  async markSent(id:string,externalId:string){ await this.pool.query(`UPDATE outreach SET status='SENT',external_id=$2,sent_at=now(),error_code=NULL WHERE id=$1`,[id,externalId]); }
  async markFailed(id:string,code:string){ await this.pool.query(`UPDATE outreach SET status='FAILED',error_code=$2 WHERE id=$1`,[id,code.slice(0,200)]); }
  async publishedTargets(){ return (await this.pool.query(`SELECT id,kind,external_id,text,username FROM outreach WHERE status='SENT' AND external_id IS NOT NULL AND sent_at>now()-interval '14 days' ORDER BY sent_at DESC LIMIT 80`)).rows; }
  async recordInbound(input:{postId:string;username:string;parentExternalId?:string;text:string;permalink?:string}){
    const r=await this.pool.query(`INSERT INTO inbound(post_id,username,parent_external_id,text,permalink) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING post_id`,[input.postId,input.username.toLowerCase(),input.parentExternalId??null,input.text,input.permalink??null]);
    return Boolean(r.rowCount);
  }
  async listLeads(limit=100):Promise<LeadRow[]>{ return (await this.pool.query<LeadRow>('SELECT * FROM leads ORDER BY score DESC, updated_at DESC LIMIT $1',[limit])).rows; }
  async listOutreach(limit=100){ return (await this.pool.query('SELECT * FROM outreach ORDER BY created_at DESC LIMIT $1',[limit])).rows; }
  async counts(){
    const r=await this.pool.query(`SELECT
      (SELECT count(*) FROM leads)::int leads,
      (SELECT count(*) FROM leads WHERE stage='HOT')::int hot,
      (SELECT count(*) FROM outreach WHERE status='DRAFT')::int drafts,
      (SELECT count(*) FROM outreach WHERE status='SENT')::int sent`);
    return r.rows[0] as {leads:number;hot:number;drafts:number;sent:number};
  }
  async getState(key:string){ const r=await this.pool.query<{value:string}>('SELECT value FROM runtime_state WHERE key=$1',[key]); return r.rows[0]?.value??null; }
  async setState(key:string,value:string){ await this.pool.query(`INSERT INTO runtime_state(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=now()`,[key,value]); }
}
