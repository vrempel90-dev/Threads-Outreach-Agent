import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.js';

test('startup configuration allows missing external API keys', () => {
  const previous = { ...process.env };
  try {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
    delete process.env.THREADS_ACCESS_TOKEN;
    delete process.env.OPENAI_API_KEY;
    delete process.env.SEARCH_QUERIES;
    process.env.AGENT_MODE = 'review';
    const cfg = loadConfig();
    assert.equal(cfg.threads.token, '');
    assert.equal(cfg.llm.key, '');
    assert.equal(cfg.mode, 'review');
    assert.ok(cfg.queries.length > 10);
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in previous)) delete process.env[key];
    }
    Object.assign(process.env, previous);
  }
});
