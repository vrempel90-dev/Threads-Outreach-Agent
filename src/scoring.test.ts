import test from 'node:test';
import assert from 'node:assert/strict';
import { scorePost, isHotIntent, isOptOut } from './scoring.js';

test('direct chatbot demand is a strong lead', () => {
  const r = scorePost('Ищу разработчика. Нужен чат-бот для бизнеса, чтобы не терять заявки.');
  assert.equal(r.shouldEngage, true);
  assert.ok(r.score >= 80);
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


test('rejects sales job vacancy even when sales keyword is present',()=> {
  const s=scorePost('Нужен менеджер по продажам в офис, зарплата 500 000 тенге');
  assert.equal(s.shouldEngage,false);
  assert.ok(s.reasons.includes('job_seeker'));
});

test('rejects AI agency self promotion',()=> {
  const s=scorePost('Мы разрабатываем AI агентов и автоматизируем бизнес. Беру новые проекты');
  assert.equal(s.shouldEngage,false);
  assert.ok(s.reasons.includes('seller_or_competitor'));
});

test('accepts business pain with explicit automation intent',()=> {
  const s=scorePost('У нас клиника в Алматы. Заявки из Instagram отвечаем вручную и теряем клиентов. Хотим автоматизировать Direct через AI.');
  assert.equal(s.shouldEngage,true);
  assert.ok(s.reasons.includes('kz_cis_signal'));
  assert.ok(s.score>=70);
});

test('accepts Kazakh chatbot buyer intent',()=> {
  const s=scorePost('Бизнеске чат бот керек, клиенттерге автоматты жауап беру үшін. Қазақстандамыз.');
  assert.equal(s.shouldEngage,true);
  assert.equal(s.language,'kk');
});

test('rejects generic AI discussion without buying intent',()=> {
  const s=scorePost('Что думаете, ИИ заменит людей через пять лет? Интересно обсудить');
  assert.equal(s.shouldEngage,false);
});
