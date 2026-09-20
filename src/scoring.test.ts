import test from 'node:test';
import assert from 'node:assert/strict';
import { scorePost, isHotIntent, isOptOut } from './scoring.js';

test('direct chatbot demand is a strong lead', () => {
  const r = scorePost('Ищу разработчика. Нужен чат-бот для бизнеса, чтобы не терять заявки.');
  assert.equal(r.shouldEngage, true);
  assert.ok(r.score >= 80);
});

test('recommendation-style automation demand is captured', () => {
  const r = scorePost('Подскажите специалиста, хочу автоматизировать ответы и заявки в CRM.');
  assert.equal(r.shouldEngage, true);
  assert.ok(r.reasons.includes('commercial_intent'));
  assert.ok(r.reasons.includes('automation_fit'));
});

test('business pain plus automation fit can be considered at lower configured threshold', () => {
  const r = scorePost('Менеджеры не успевают отвечать, заявки обрабатываем вручную. Нужна автоматизация продаж.', 45);
  assert.equal(r.shouldEngage, true);
});

test('competitor self-promotion is rejected', () => {
  const r = scorePost('Я разрабатываю AI агентов и делаю ботов для бизнеса, ищу клиентов');
  assert.equal(r.shouldEngage, false);
});

test('hot and opt-out intents are detected', () => {
  assert.equal(isHotIntent('Сколько стоит и когда можно начать?'), true);
  assert.equal(isOptOut('Не пишите'), true);
});

test('rejects human-service agent false positive',()=>{
  const s=scorePost('Нужен агент по недвижимости для бизнеса, ищу специалиста');
  assert.equal(s.shouldEngage,false);
  assert.equal(s.reasons.includes('automation_fit'),false);
});

test('accepts explicit chatbot buyer intent',()=>{
  const s=scorePost('Нужен чат бот для бизнеса, чтобы автоматизировать заявки');
  assert.equal(s.shouldEngage,true);
  assert.ok(s.score>=55);
});
