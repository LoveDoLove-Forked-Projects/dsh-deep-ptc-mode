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
    tools: { definitions: () => [], register(definition) { registered.set(definition.name, definition); return () => registered.delete(definition.name); } },
    get(name) { return name === 'schedule' ? schedule : undefined; },
  };
  // The host serializer rejects non-JSON values, so the fake writer is just as strict.
  const serializable = value => {
    if (value === undefined) throw new Error('undefined is not serializable');
    if (value === null || typeof value !== 'object') return;
    for (const item of Array.isArray(value) ? value : Object.values(value)) serializable(item);
  };
  const records = async () => (session, _type, value) => { serializable(value); store.set(session, value); };
  const run = (session, request) => handlers.get(CARD_COMMAND)({ agent: { session }, commandId: 'test-command', signal: AbortSignal.timeout(1000), rawInput: JSON.stringify({ revision: store.get(session)?.cards.find(card => card.id === request.id)?.revision, ...request }) });
  return { ctx, records, handlers, registered, schedule, store, run };
}

test('the tool stores a card and the command really stops it', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  assert.ok(host.registered.has(CARD_TOOL), 'ui_card must be registered');
  assert.equal(host.registered.get(CARD_TOOL).resident, true, 'the card tool keeps its schema in the PTC SDK');
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

  const outcome = await host.run(session, { id: 'loop', action: 'stop' });
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

  host.run(session, { id: 'temp', action: 'dismiss' });
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

test('a command card never falls back to another shell when the environment is not ready', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  const session = { id: 'session-4' };
  await host.registered.get(CARD_TOOL).execute({ action: 'show', id: 'srv', title: '服务', subtitle: '运行中',
    blocks: [{ type: 'stats', items: [{ label: '请求', value: '12' }] }], stop: { command: 'true' } }, { agent: { session } });
  await host.run(session, { id: 'srv', action: 'stop' });
  for (let tick = 0; tick < 20 && host.store.get(session).cards[0].phase === 'stopping'; tick++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  const card = host.store.get(session).cards[0];
  assert.equal(card.phase, 'failed');
  assert.equal(card.result.command, 'failed');
  assert.match(card.result.errors[0], /active Harness shell/u);
});

test('buttons: a reply records the choice, a kept card reopens, bad values are refused', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  const session = { id: 'session-5' };
  const tool = host.registered.get(CARD_TOOL);
  await tool.execute({ action: 'show', id: 'deploy', title: '部署方案',
    blocks: [{ type: 'choice', name: 'plan', options: [{ value: 'vps', label: 'VPS' }, { value: 'k8s', label: 'K8s' }] }],
    actions: [{ id: 'pick', label: '就用这个', reply: '用 {plan}' }] }, { agent: { session } });
  const command = payload => host.run(session, payload);
  assert.equal(command({ id: 'deploy', action: 'act', key: 'pick', values: { plan: 'gcp' } }).kind, 'error');
  assert.equal(command({ id: 'deploy', action: 'act', key: 'nope' }).kind, 'error');
  assert.equal(command({ id: 'deploy', action: 'act', key: 'pick', values: { plan: 'k8s' } }).kind, 'success');
  const settled = host.store.get(session).cards[0];
  assert.equal(settled.phase, STOPPED);
  assert.deepEqual(settled.result.values, { plan: 'k8s' });
  assert.equal(settled.result.action, 'pick');
  assert.equal(command({ id: 'deploy', action: 'act', key: 'pick', values: { plan: 'vps' } }).text, 'Card already handled. / 卡片已处理。');

  await tool.execute({ action: 'show', id: 'alarm', title: '闹钟', subtitle: '运行中',
    blocks: [{ type: 'field', name: 'time', label: '时间', kind: 'time', value: '07:30' }],
    actions: [{ id: 'snooze', label: '推迟', run: { schedules: ['s9'] }, keep: true }] }, { agent: { session } });
  assert.equal((await command({ id: 'alarm', action: 'act', key: 'snooze' })).kind, 'success');
  for (let tick = 0; tick < 20 && host.store.get(session).cards[1].phase !== OPEN; tick++) await new Promise(resolve => setTimeout(resolve, 5));
  const alarm = host.store.get(session).cards[1];
  assert.equal(alarm.phase, OPEN, 'a kept card can be used again');
  assert.deepEqual(alarm.result.schedules, ['s9']);
  assert.deepEqual(alarm.result.values, { time: '07:30' });
});

test('the server refuses old buttons and honours the card setting', async () => {
  const host = fakeHost();
  let enabled = true;
  await install(host.ctx, host.records, { enabled: () => enabled });
  const session = { id: 'stale-card' };
  const tool = host.registered.get(CARD_TOOL);
  const show = label => tool.execute({
    id: 'decision', title: 'Decision', note: 'Choose an option',
    actions: [{ id: 'pick', label, reply: true }],
  }, { agent: { session } });
  await show('Original');
  const revision = host.store.get(session).cards[0].revision;
  await show('Updated');
  assert.match(host.run(session, { id: 'decision', revision, action: 'act', key: 'pick' }).text, /card changed/u);
  enabled = false;
  assert.match(host.run(session, { id: 'decision', action: 'act', key: 'pick' }).text, /turned off/u);
  assert.equal(host.store.get(session).cards[0].phase, OPEN);
});
