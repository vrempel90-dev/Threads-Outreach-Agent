import test from 'node:test';
import assert from 'node:assert/strict';
import { contentSlot, selectTrendQueries, formatTrendEvidence } from './content.js';

test('content slot is deterministic',()=>{
  assert.equal(contentSlot(new Date('2026-09-20T00:00:00Z'),4),contentSlot(new Date('2026-09-20T03:59:59Z'),4));
  assert.notEqual(contentSlot(new Date('2026-09-20T03:59:59Z'),4),contentSlot(new Date('2026-09-20T04:00:00Z'),4));
});

test('trend query rotation is deterministic',()=>{
  assert.deepEqual(selectTrendQueries(0,2),['ChatGPT','OpenAI']);
  assert.equal(selectTrendQueries(11,2).length,2);
});

test('trend evidence contains rank and source context',()=>{
  const text=formatTrendEvidence([{query:'AI агент',type:'TOP',rank:1,text:'example',username:'u',timestamp:'2026-09-20T00:00:00Z',permalink:''}]);
  assert.match(text,/TOP #1/);
  assert.match(text,/example/);
});
