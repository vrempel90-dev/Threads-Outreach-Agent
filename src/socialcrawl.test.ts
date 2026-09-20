import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSocialCrawlItems } from './socialcrawl.js';

test('parses SocialCrawl Threads unified schema',()=>{
  const rows=parseSocialCrawlItems({
    data:{items:[{post:{
      id:'123',url:'https://www.threads.net/@buyer/post/ABC',published_at:'2026-09-20T10:00:00Z',
      content:{text:'Нужен AI агент для обработки заявок'},
      author:{username:'buyer'},
      engagement:{likes:12,comments:3,shares:2},
      ext:{repost_count:1,quote_count:4}
    },computed:{relevance:{p:0.91}}}]}
  });
  assert.equal(rows.length,1);
  assert.equal(rows[0]?.username,'buyer');
  assert.equal(rows[0]?.likes,12);
  assert.equal(rows[0]?.replies,3);
  assert.equal(rows[0]?.relevance,0.91);
});

test('drops incomplete SocialCrawl rows',()=>{
  const rows=parseSocialCrawlItems({data:{items:[{post:{id:'1',content:{text:'x'}}}]}});
  assert.equal(rows.length,0);
});
