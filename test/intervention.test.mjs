import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { setTimeout as wait } from 'node:timers/promises';
import { briefToolDefinition } from '../lib/brief-context.mjs';
import { CARDS_EVENT, blankCards, foldCardsState, records } from '../lib/card-state.mjs';
import { cardDecisions } from '../lib/decisions.mjs';
import { foldInterventions, install, interventionText } from '../lib/intervention.mjs';
import { readCardInput } from '../lib/cards.mjs';
import { directRuntime, installSubagentInteraction } from '../lib/subagent-interaction.mjs';

const typed = (text, seq = 5) => ({ type: 'user/message', seq, data: { source: { kind: 'user', rpcId: 'r' }, content: [{ type: 'text', text }] } });
const relay = seq => ({ type: 'user/message', seq, data: { source: { kind: 'agent-message' }, content: [{ type: 'text', text: 'go on' }] } });

async function host() {
  const events = new EventEmitter();
  const parent = { id: 'main', header: { agentPreset: 'deep-ptc' } };
  const child = { id: 'kid', header: { agentPreset: 'deep-ptc', parentSession: 'main', label: '导入检查' } };
  const states = new Map();
  let definition;
  const contexts = new Map();
  const agents = new Map([['main', { session: parent }], ['kid', { session: child }]]);
  const ctx = { logger: { warn() {} }, effect: fn => fn(), get: name => name === 'agents' ? { get: id => agents.get(id) } : undefined,
    on: (name, listener) => { events.on(name, listener); return () => events.off(name, listener); },
    sessionProjections: { async register(def) { definition = def; return { dispose() {}, stateOf: session => states.get(session) }; } },
    systemPrompt: { context: row => { contexts.set(row.name, row.text); } } };
  let seq = 100;
  await install(ctx, async () => async (session, type, data) => {
    states.set(session, definition.apply(states.get(session) ?? definition.init({}, 0), { type, seq: ++seq, data: JSON.parse(JSON.stringify(data)) }));
  });
  return { parent, child, agents, emit: event => events.emit('session/event', child, event),
    parentSees: () => contexts.get('deep-ptc:interventions')({ agent: { session: parent } }),
    childTold: () => contexts.get('deep-ptc:report-intervention')({ agent: { session: child } }) };
}

test('the subagent files the user’s words and the parent reads them as an internal card', async () => {
  const h = await host();
  assert.equal(h.parentSees(), '');
  h.emit({ type: 'user/message', seq: 4, data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'initial assignment' }] } });
  assert.equal(h.childTold(), '', 'the parent’s first prompt is not the user');
  h.emit(typed('只检查 CSV，别动数据库'));
  assert.match(h.childTold(), /action=report/u);
  const tool = briefToolDefinition({ api: { enabled: () => true, read: () => assert.fail('the child has no brief of its own') } });
  const result = await tool.execute({ action: 'report', title: '收窄范围', items: [{ section: 'constraint', text: '不动数据库' }], summary: '改为只读检查' }, { agent: { session: h.child } });
  assert.equal(result.reported, 1);
  assert.equal(h.childTold(), '');
  const text = h.parentSees();
  for (const part of ['[I1] subagent «导入检查» kid — 收窄范围', '只检查 CSV，别动数据库', '- constraint: 不动数据库', 'subagent: 改为只读检查']) assert.ok(text.includes(part), part);
  await assert.rejects(tool.execute({ action: 'report' }, { agent: { session: h.parent } }), /subagents/u);
});

test('words the subagent does not file are passed on by the end of its turn, and a later report replaces them', async () => {
  const h = await host();
  h.emit(typed('改用 Python'));
  for (let i = 0; i < 2; i++) h.emit({ type: 'assistant/message', seq: 6 + i, data: {} });
  await wait(5);
  assert.match(h.parentSees(), /改用 Python/u);
  assert.match(h.parentSees(), /not organized/u);
  const tool = briefToolDefinition({ api: { enabled: () => true } });
  await tool.execute({ action: 'report', title: '换语言' }, { agent: { session: h.child } });
  assert.doesNotMatch(h.parentSees(), /not organized/u);
  assert.equal(h.parentSees().match(/改用 Python/gu).length, 1);
  h.emit({ type: 'turn/end', seq: 20, data: {} });
  h.emit(typed('再加一条', 30));
  h.emit({ type: 'turn/end', seq: 31, data: {} });
  await wait(5);
  assert.match(h.parentSees(), /再加一条/u);
});

test('a card that waits for the user does not hold the user’s words back', async () => {
  const h = await host();
  h.emit(typed('先问我语言'));
  h.emit({ type: CARDS_EVENT, seq: 6, data: { op: 'show' } });
  await wait(5);
  assert.match(h.parentSees(), /先问我语言/u);
  h.emit({ type: 'user/message', seq: 7, data: { source: { kind: 'deep-ptc-card' }, content: [{ type: 'text', text: '[Card answer: a «b»]\nlang = en «英文»    # 语言\nThese answers settle the card.' }] } });
  h.emit({ type: 'turn/end', seq: 8, data: {} });
  await wait(5);
  assert.match(h.parentSees(), /card answer: «lang = en «英文» # 语言»/u);
  assert.equal(h.parentSees().match(/先问我语言/gu).length, 1);
});

test('a parent that is not loaded receives the card when it runs again', async () => {
  const h = await host();
  h.agents.delete('main');
  h.emit(typed('记得备份'));
  h.emit({ type: 'turn/end', seq: 9, data: {} });
  await wait(5);
  assert.equal(h.parentSees(), '');
  h.agents.set('main', { session: h.parent });
  h.emit(typed('还有一条', 12));
  h.emit({ type: 'turn/end', seq: 13, data: {} });
  await wait(5);
  assert.match(h.parentSees(), /还有一条/u);
});

test('only the newest internal cards stay in context, and a fork does not inherit them', () => {
  let state = { v: 1, next: 1, cards: [], own: 0 };
  for (let i = 0; i < 9; i++) state = foldInterventions(state, { type: 'plugin:dsh-deep-ptc-mode/intervention', seq: i, data: { v: 1, child: 'k', key: 'm' + i, words: [{ text: 'w' + i }] } });
  assert.deepEqual(state.cards.map(card => card.id), ['I4', 'I5', 'I6', 'I7', 'I8', 'I9']);
  assert.match(interventionText(state), /w8/u);
  const fork = { ...state, cards: [], own: 50 };
  assert.equal(foldInterventions(fork, { type: 'plugin:dsh-deep-ptc-mode/intervention', seq: 3, data: { v: 1, child: 'k', words: [] } }), fork);
});

test('a subagent may put cards to the user from their message until the parent’s next one', async () => {
  const child = { id: 'kid', header: { agentPreset: 'deep-ptc', parentSession: 'main' } };
  let state = { ...blankCards(), delegated: true, own: 3 };
  const before = directRuntime.read;
  directRuntime.read = () => state;
  const hooks = new Map();
  installSubagentInteraction({ on: (name, listener) => hooks.set(name, listener) });
  const pre = () => hooks.get('tools/pre-execute')({ name: 'ui_card', agent: { session: child } }, () => ({ kind: 'allow' })).kind;
  const approve = () => hooks.get('approval/request')({ agent: { session: child } }, async () => 'allowed-once');
  try {
    state = foldCardsState(state, typed('parent talk', 2));
    assert.equal(pre(), 'deny', 'a message inherited from the parent’s log does not count');
    assert.equal(await approve(), 'rejected');
    state = foldCardsState(state, typed('hello', 5));
    assert.equal(pre(), 'allow');
    assert.equal(await approve(), 'allowed-once');
    const card = readCardInput({ title: 'A', subtitle: 's', actions: [{ id: 'go', label: 'Go', reply: true }] }).card;
    const post = (id, seq) => { state = foldCardsState(state, { type: CARDS_EVENT, seq, data: records.show(state, id, card) }); };
    post('old', 1);
    post('mine', 6);
    assert.deepEqual(cardDecisions(state, 'en').map(decision => decision.key), ['card:mine:2'], 'the fork’s copy of a parent card is not asked again');
    state = foldCardsState(state, relay(7));
    assert.equal(pre(), 'deny');
    assert.equal(cardDecisions(state, 'en').length, 1, 'a card already posted can still be answered');
  } finally { directRuntime.read = before; }
});
