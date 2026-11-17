import assert from 'node:assert/strict';
import test from 'node:test';
import { install } from '../lib/cards-context.mjs';
import { CARD_COMMAND, CARD_TOOL, blankCards, OPEN, STOPPED } from '../lib/cards.mjs';

// A minimal host: the card path only needs these services, so the whole chain runs in Node.
function fakeHost() {
  const store = new Map();
  const handlers = new Map();
  const registered = new Map();
  const schedule = { calls: [], async edit(request, actor) { this.calls.push({ request, actor }); } };
  const ctx = {
    logger: { warn() {} },
    effect(register) { const dispose = register(); return () => dispose?.(); },
    sessionProjections: { async register(definition) {
      return { stateOf: session => store.get(session) ?? definition.init(undefined, 0), dispose() {} };
    } },
    commands: { register(definition) { handlers.set(definition.name, definition.handler); } },
    tools: { register(definition) { registered.set(definition.name, definition); return () => registered.delete(definition.name); } },
    get(name) { return name === 'schedule' ? schedule : undefined; },
  };
  const records = async () => (session, _type, value) => { store.set(session, value); };
  return { ctx, records, handlers, registered, schedule, store };
}

test('the tool stores a card and the command really stops it', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  assert.ok(host.registered.has(CARD_TOOL), 'ui_card must be registered');
  assert.ok(host.handlers.has(CARD_COMMAND), 'the card command must be registered');

  const session = { id: 'session-1' };
  const tool = host.registered.get(CARD_TOOL);
  const created = await tool.execute({
    action: 'show',
    id: 'loop',
    title: '每小时起身活动循环',
    subtitle: '状态：运行中',
    lines: [{ label: '响铃', value: ':15 长响 · :30 短响' }],
    stop: { label: '停止循环', schedules: ['schedule-a', 'schedule-b'] },
  }, { agent: { session } });
  assert.equal(created.id, 'loop');
  assert.equal(created.phase, OPEN);
  assert.equal(host.store.get(session).cards[0].title, '每小时起身活动循环');

  const outcome = host.handlers.get(CARD_COMMAND)({ agent: { session }, rawInput: JSON.stringify({ id: 'loop', action: 'stop' }) });
  assert.equal(outcome.kind, 'success');
  for (let tick = 0; tick < 20 && host.store.get(session).cards[0].phase !== STOPPED; tick++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const card = host.store.get(session).cards[0];
  assert.equal(card.phase, STOPPED);
  assert.deepEqual(card.result.schedules, ['schedule-a', 'schedule-b']);
  assert.deepEqual(host.schedule.calls.map(call => call.request), [
    { id: 'schedule-a', action: 'delete' }, { id: 'schedule-b', action: 'delete' },
  ]);
  assert.deepEqual(host.schedule.calls.map(call => call.actor), ['session-1', 'session-1']);
});

test('closing a card removes it and invalid input is refused', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  const session = { id: 'session-2' };
  const tool = host.registered.get(CARD_TOOL);
  await tool.execute({ action: 'show', id: 'temp', title: 'T', subtitle: 's' }, { agent: { session } });
  assert.equal(host.store.get(session).cards.length, 1);

  host.handlers.get(CARD_COMMAND)({ agent: { session }, rawInput: JSON.stringify({ id: 'temp', action: 'dismiss' }) });
  assert.equal(host.store.get(session).cards.length, 0);

  await assert.rejects(() => tool.execute({ action: 'show', title: '   ' }, { agent: { session } }), /title/u);
  await assert.rejects(() => tool.execute({ action: 'remove', id: 'missing' }, { agent: { session } }), /Unknown/u);
});

test('a card without an action is still created and can be closed', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  const session = { id: 'session-3' };
  const tool = host.registered.get(CARD_TOOL);
  const created = await tool.execute({ action: 'show', title: '说明', note: '只是展示' }, { agent: { session } });
  assert.equal(host.store.get(session).cards[0].phase, OPEN);
  assert.equal(host.store.get(session).cards[0].stop, undefined);
  assert.equal(created.id, 'card-1');
  assert.deepEqual(blankCards().cards, []);
});
