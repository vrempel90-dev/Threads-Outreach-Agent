import test from 'node:test';
import assert from 'node:assert/strict';
import { contentSlot } from './content.js';

test('content slot is deterministic',()=>{
  assert.equal(contentSlot(new Date('2026-09-20T00:00:00Z'),6),contentSlot(new Date('2026-09-20T05:59:59Z'),6));
  assert.notEqual(contentSlot(new Date('2026-09-20T05:59:59Z'),6),contentSlot(new Date('2026-09-20T06:00:00Z'),6));
});
