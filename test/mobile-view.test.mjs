import assert from 'node:assert/strict';
import test from 'node:test';
import { briefView, cardMarkdown, cardView, proposalView, toolCardView, VIEW_KEY } from '../lib/card-text.mjs';
import { installMobileView, noteMobileView } from '../lib/mobile-view.mjs';
import { readCardInput } from '../lib/cards.mjs';

export const everyBlock = readCardInput({ title: '仪表盘', subtitle: '本周', note: '备注', blocks: [
  { type: 'stats', items: [{ label: '成功率', value: '96', delta: '+2', tone: 'success' }, { label: '耗时', value: '3 s' }] },
  { type: 'bars', title: '大小', unit: 'KB', items: [{ label: 'a', value: 3 }] },
  { type: 'line', points: [1, 2, 3], labels: ['一', '二', '三'] },
  { type: 'donut', items: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] },
  { type: 'steps', items: [{ label: '一', state: 'done' }, { label: '二', state: 'active', value: '中' }] },
  { type: 'table', columns: ['a', 'b|c'], rows: [['1', '2']] }] }).card;
const more = readCardInput({ title: '更多', blocks: [{ type: 'progress', items: [{ label: 'p', value: 3, max: 5 }] }, { type: 'tags', items: ['x'] },
  { type: 'rows', items: [{ label: 'k', value: 'v' }] }, { type: 'text', text: 't' }, { type: 'callout', text: 'c', tone: 'warn' }] }).card;

test('every block has a Markdown and a native form', () => {
  const text = cardMarkdown([...everyBlock.blocks, ...more.blocks]);
  for (const part of ['成功率', '3 KB', '一 1 → 二 2', '✓ 一', '| a | b\\|c |', 'p：3 / 5', '> c']) assert.ok(text.includes(part), part);
  const view = toolCardView([cardView({ ...everyBlock, phase: 'open' }, 'zh'), cardView({ ...more, phase: 'open' }, 'zh')], 'zh');
  const types = JSON.stringify(view);
  for (const type of ['metric', 'chart', 'steps', 'table', 'progress', 'keyValue', 'callout', 'text']) assert.ok(types.includes(`"type":"${type}"`), type);
});

test('a question section shows the options while open and the answers once given', () => {
  const version = { kind: 'question', title: 'Q', phase: 'open', questions: [{ id: 'a', prompt: '选哪个', type: 'single', options: [{ value: 'x', label: '甲' }] }] };
  assert.match(JSON.stringify(cardView(version, 'zh')), /等待你的回答/u);
  assert.match(JSON.stringify(cardView({ ...version, phase: 'answered', result: { answers: { a: 'x' } } }, 'zh')), /\["选哪个","甲"\]/u);
});

test('a tool card stays inside the DSH Go budget and says what it left out', () => {
  const big = Array.from({ length: 20 }, (_, index) => cardView({ title: '卡 ' + index, phase: 'open', blocks: [{ type: 'text', text: '字'.repeat(500) }] }, 'zh'));
  const view = toolCardView(big, 'zh');
  assert.ok(Buffer.byteLength(JSON.stringify(view)) <= 8192);
  assert.match(JSON.stringify(view), /另有 \d+ 张卡片/u);
  assert.equal(toolCardView([{ title: 'x', children: [] }], 'zh'), undefined);
  assert.ok(briefView({ rev: 2, items: [{ id: 'G1', text: 'a', status: 'done', basis: 'confirmed' }] }, 'zh').children.length);
  assert.ok(proposalView({ title: 'p', items: [{ text: 'a' }] }, 'zh').children.length);
});

test('the root run_code result carries the view; other results and failures stay as the host made them', async () => {
  let hook;
  const definition = { output: { render: () => [] } };
  const ctx = { logger: { warn: message => assert.fail(message) }, on: (_name, listener) => { hook = listener; },
    get: () => ({ selectExecutor: () => ({ requirePtcTransport: () => definition }) }) };
  installMobileView(ctx, { language: 'zh' });
  const agent = {};
  const root = { name: 'run_code', agent, callId: 'r', arguments: { code: '' } };
  const result = { isError: false, value: { logs: [] }, content: [{ type: 'text', text: 'ok' }] };
  const accept = () => Promise.resolve({ kind: 'accept' });
  assert.deepEqual(await hook(root, result, accept), { kind: 'accept' }, 'a call without cards is untouched');
  assert.equal(definition.output.presentationMeta, undefined);
  noteMobileView({ agent, callId: 'n', rootCallId: 'r' }, 'card:a', () => ({ title: 'A', children: [{ type: 'text', text: 'a' }] }));
  const decision = await hook(root, result, accept);
  assert.equal(decision.value, result.value, 'the same value renders the same content');
  assert.equal(definition.output.presentationMeta(root.arguments, result.value)[VIEW_KEY].title, 'A');
  assert.deepEqual(definition.output.presentationMeta({}, {}), {}, 'a parallel call gets no card');
  // A policy that already shaped the content keeps its decision.
  noteMobileView({ agent, callId: 'n', rootCallId: 'r' }, 'card:a', () => ({ title: 'A', children: [{ type: 'text', text: 'a' }] }));
  const shaped = { kind: 'accept', content: [] };
  assert.equal(await hook(root, result, async () => shaped), shaped);
});
