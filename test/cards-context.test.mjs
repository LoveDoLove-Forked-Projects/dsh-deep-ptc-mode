import assert from 'node:assert/strict';
import test from 'node:test';
import { apply as applyCards, cardsRuntime, install, questionToolDefinition, QUESTION_TOOL } from '../lib/cards-context.mjs';
import { briefToolDefinition } from '../lib/brief-context.mjs';
import { CARD_COMMAND, CARD_TOOL, ANSWERED, OPEN, STOPPED, DISMISSED } from '../lib/cards.mjs';
import { latestOf } from '../lib/card-state.mjs';
import { apply as applyQuestionTool } from '../lib/question-tool.mjs';

// A minimal host whose projection folds every appended event, like the real session projection.
function fakeHost() {
  const states = new Map();
  const handlers = new Map();
  const registered = new Map();
  let projection;
  const schedule = { calls: [], async edit(request, actor) { this.calls.push({ request, actor }); } };
  const ctx = {
    logger: { warn() {} },
    effect(register) { const dispose = register(); return () => dispose?.(); },
    sessionProjections: { async register(definition) {
      projection = definition;
      return { stateOf: session => states.get(session) ?? definition.init(), dispose() {} };
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
  const emit = (session, type, data) => {
    states.set(session, projection.apply(states.get(session) ?? projection.init(), { type, data }));
  };
  const records = async () => (session, type, value) => { serializable(value); emit(session, type, value); };
  const turn = (session, n) => emit(session, 'turn/start', { turn: n });
  const state = session => states.get(session) ?? projection.init();
  // The agent records what the server delivers to the model; `steer: false` plays an agent without it.
  const delivered = [];
  const run = (session, request, { steer = true } = {}) => {
    const rev = request.rev ?? latestOf(state(session), request.id)?.rev;
    const agent = steer ? { session, steer: message => delivered.push(message) } : { session };
    return handlers.get(CARD_COMMAND)({ agent, commandId: 'test-command', signal: AbortSignal.timeout(1000),
      rawInput: JSON.stringify({ ...request, rev }) });
  };
  return { ctx, records, handlers, registered, schedule, state, run, turn, delivered };
}

const settle = async (host, session, id, done) => {
  for (let tick = 0; tick < 40 && !done(latestOf(host.state(session), id)); tick++) await new Promise(resolve => setTimeout(resolve, 5));
  return latestOf(host.state(session), id);
};

test('the tool posts a card and its button really runs', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  const tool = host.registered.get(CARD_TOOL);
  assert.equal(tool.resident, true, 'the card tool keeps its schema in the PTC SDK');
  const session = { id: 'session-1' };
  host.turn(session, 1);
  const created = await tool.execute({ action: 'show', id: 'loop', title: '每小时提醒', subtitle: '运行中',
    blocks: [{ type: 'rows', items: [{ label: '响铃', value: ':15' }] }],
    actions: [{ id: 'stop', label: '停止提醒', style: 'danger', run: { schedules: ['schedule-a', 'schedule-b'] } }] }, { agent: { session } });
  assert.deepEqual([created.id, created.rev, created.turn, created.phase], ['loop', 1, 1, OPEN]);
  assert.deepEqual(created.cards[0], { id: 'loop', rev: 1, turn: 1, kind: 'card', title: '每小时提醒', phase: OPEN, interactive: true });
  assert.match(created.next, /turn waits here/u, 'a run button also asks for an interaction');
  const asking = await tool.execute({ action: 'show', id: 'pick', title: '选方案', note: '二选一', actions: [{ id: 'a', label: 'A', reply: true }] }, { agent: { session } });
  assert.match(asking.next, /turn waits here/u, 'a reply button means waiting for the choice');

  await host.run(session, { id: 'loop', action: 'act', key: 'stop' });
  const card = await settle(host, session, 'loop', version => version.phase === STOPPED);
  assert.equal(card.phase, STOPPED);
  assert.deepEqual(card.result.schedules, ['schedule-a', 'schedule-b']);
  assert.deepEqual(host.schedule.calls.map(call => call.actor), ['session-1', 'session-1']);
});

test('cards stay in the history: a new version archives the old one, the outstanding decision survives a turn change', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  const tool = host.registered.get(CARD_TOOL);
  const session = { id: 'history' };
  host.turn(session, 1);
  const show = label => tool.execute({ action: 'show', id: 'decision', title: 'Decision', note: 'Choose',
    actions: [{ id: 'pick', label, reply: true }] }, { agent: { session } });
  const first = await show('Original');
  await show('Updated');
  assert.equal(host.state(session).versions.length, 2, 'the first version is kept, not replaced');
  assert.match(host.run(session, { id: 'decision', rev: first.rev, action: 'act', key: 'pick' }).text, /newer version/u);
  host.turn(session, 2);
  assert.equal((await host.run(session, { id: 'decision', action: 'act', key: 'pick' })).kind, 'success');
  // Showing it again in the new turn makes it usable again.
  await show('Again');
  assert.equal((await host.run(session, { id: 'decision', action: 'act', key: 'pick' })).kind, 'success');
  assert.equal(latestOf(host.state(session), 'decision').phase, STOPPED);
  assert.equal(host.delivered.at(-1).content[0].text, `[Card button: decision rev ${latestOf(host.state(session), 'decision').rev} «Decision» → pick «Again»]`);
  // Without a steerable agent the server only records the choice, and the client sends its reply.
  await show('Fallback');
  assert.equal((await host.run(session, { id: 'decision', action: 'act', key: 'pick' }, { steer: false })).text, 'Choice recorded. / 已记录选择。');
  assert.deepEqual(host.state(session).versions.map(version => version.turn), [1, 1, 2, 2]);
});

test('closing, invalid input and kept buttons', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  const tool = host.registered.get(CARD_TOOL);
  const session = { id: 'session-2' };
  host.turn(session, 1);
  await tool.execute({ action: 'show', id: 'temp', title: 'T', subtitle: 's' }, { agent: { session } });
  host.run(session, { id: 'temp', action: 'dismiss' });
  assert.equal(latestOf(host.state(session), 'temp').phase, DISMISSED, 'closed, but kept for the history');
  await assert.rejects(() => tool.execute({ action: 'show', title: '   ' }, { agent: { session } }), /title/u);
  await assert.rejects(() => tool.execute({ action: 'remove', id: 'missing' }, { agent: { session } }), /Unknown/u);

  await tool.execute({ action: 'show', id: 'alarm', title: '闹钟', subtitle: '运行中',
    blocks: [{ type: 'field', name: 'time', label: '时间', kind: 'time', value: '07:30' }],
    actions: [{ id: 'snooze', label: '推迟', run: { schedules: ['s9'] }, keep: true }, { id: 'pick', label: '改时间', reply: '改到 {time}' }] }, { agent: { session } });
  await host.run(session, { id: 'alarm', action: 'act', key: 'snooze' });
  const alarm = await settle(host, session, 'alarm', version => version.phase === OPEN && version.result?.schedules);
  assert.equal(alarm.phase, OPEN, 'a kept button leaves the card usable in this turn');
  assert.deepEqual(alarm.result.values, { time: '07:30' });
  assert.equal(host.run(session, { id: 'alarm', action: 'act', key: 'pick', values: { time: 'bad' } }).kind, 'error');
});

test('the card setting turns the tool and the buttons off', async () => {
  const host = fakeHost();
  let enabled = true;
  let listener;
  await install(host.ctx, host.records, { enabled: () => enabled, watch: fn => { listener = fn; return () => {}; } });
  const session = { id: 'switch' };
  host.turn(session, 1);
  await host.registered.get(CARD_TOOL).execute({ action: 'show', id: 'c', title: 'C', actions: [{ id: 'go', label: 'Go', reply: true }], note: 'n' }, { agent: { session } });
  enabled = false; listener();
  assert.equal(host.registered.has(CARD_TOOL), false);
  assert.match(host.run(session, { id: 'c', action: 'act', key: 'go' }).text, /turned off/u);
});

test('ask_user posts a question card that returns at once and takes one valid answer', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  const registered = new Map();
  applyQuestionTool({ effect: fn => fn(), tools: { register: definition => { registered.set(definition.name, definition); return () => {}; } } });
  const ask = registered.get(QUESTION_TOOL);
  assert.equal(ask.resident, true);
  const session = { id: 'questions' };
  host.turn(session, 3);
  const posted = await ask.execute({ id: 'deploy', title: '选择部署方案', questions: [
    { id: 'plan', prompt: '用哪种方案？', options: [{ value: 'vps', label: 'VPS' }, { value: 'k8s', label: 'K8s' }], recommended: 'vps' },
    { id: 'note', prompt: '补充说明', optional: true }] }, { agent: { session } });
  assert.equal(posted.status, 'posted, waiting for the user');
  assert.match(posted.next, /do not ask again/u);
  assert.equal(latestOf(host.state(session), 'deploy').kind, 'question');
  assert.match(host.run(session, { id: 'deploy', action: 'answer', answers: { plan: 'gcp' } }).text, /not one of the options/u);
  const sent = await host.run(session, { id: 'deploy', action: 'answer', answers: { plan: 'k8s', note: '尽快' } });
  assert.equal(sent.kind, 'success');
  assert.match(sent.text, /sent to the model/u, 'the server delivered the answer, so the client sends no text');
  // The model's view: ids, values with the words the user saw, and no presentation.
  const message = host.delivered.at(-1);
  assert.deepEqual(message.source, { kind: 'deep-ptc-card', form: 'notice', summary: '回答 · 选择部署方案' });
  assert.equal(message.content[0].text, [
    '[Card answer: deploy «选择部署方案»]',
    'plan = k8s «K8s»    # 用哪种方案？',
    'note = «尽快»    # 补充说明',
    'These answers settle the card. Continue the work that waited on them; do not ask them again.'].join('\n'));
  const answered = latestOf(host.state(session), 'deploy');
  assert.equal(answered.phase, ANSWERED);
  assert.deepEqual(answered.result.answers, { plan: 'k8s', note: '尽快' });
  assert.match(host.run(session, { id: 'deploy', action: 'answer', answers: { plan: 'vps' } }).text, /already handled/u);
  await assert.rejects(() => ask.execute({ title: 'x', questions: [] }, { agent: { session } }), /1-5/u);
  // A pending question still takes an answer after an interrupted turn.
  await ask.execute({ id: 'later', title: 'Later', questions: [{ prompt: 'p?' }] }, { agent: { session } });
  host.turn(session, 4);
  assert.equal((await host.run(session, { id: 'later', action: 'answer', answers: { q1: 'x' } })).kind, 'success');
  cardsRuntime.enabled = () => false;
  await assert.rejects(() => questionToolDefinition().execute({ title: 'x', questions: [{ prompt: 'p' }] }, { agent: { session } }), /turned off/u);
  cardsRuntime.enabled = () => true;
});

test('the card rules live in a protected system prompt section, never in compactable history', async () => {
  // Sections are rebuilt for every request and never enter the transcript, so compaction cannot drop them.
  const sections = [];
  const child = { effect: fn => fn(), systemPrompt: { section: definition => { sections.push(definition); return () => {}; } }, skills: { register: () => () => {} } };
  const ctx = { logger: { warn() {} }, get: () => ({ presetForSession: () => 'deep-ptc' }),
    plugin: ({ inject, apply }) => ({ await: async () => inject.includes('systemPrompt') ? apply(child) : undefined }) };
  await applyCards(ctx, {});
  const guidance = sections.find(section => section.name === 'deep-ptc:conversation-cards');
  const text = guidance.text({ agent: { session: {} } });
  for (const rule of [/ask_user/u, /returns at once/u, /newest version takes clicks/u, /Never ask the same question again/u]) assert.match(text, rule);
});

test('an ambiguous task posts alternatives before filing; a custom interpretation reaches the model verbatim', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records, { enabled: () => false, reviewEnabled: kind => kind === 'brief' });
  const session = { id: 'ambiguous' };
  host.turn(session, 1);
  const brief = briefToolDefinition({ api: { enabled: () => true, read: () => ({}) } });
  const posted = await brief.execute({ action: 'update', title: '导出哪些数据？', items: [{ text: '未经确认的解释' }],
    questions: [{ id: 'scope', prompt: '导出范围', options: ['当前行', '当前页', '全部结果'] }] }, { agent: { session } });
  const card = latestOf(host.state(session), posted.id);
  assert.equal(card.review, 'brief');
  assert.equal(card.questions[0].options.length, 3);
  const answered = await host.run(session, { id: card.id, action: 'answer', answers: { scope: { custom: '只导出勾选的行' } } });
  assert.equal(answered.kind, 'success');
  assert.equal(latestOf(host.state(session), card.id).result.answers.scope.custom, '只导出勾选的行');
  assert.match(host.delivered.at(-1).content[0].text, /只导出勾选的行/u);
});

test('review questions advance atomically one answer at a time, and free input returns to the model for a fresh proposal', async () => {
  const host = fakeHost();
  let waiting;
  await install(host.ctx, host.records, { waits: { add(_exec, check) { waiting = check; }, delivering() { return () => {}; } } });
  const session = { id: 'sequential-questions' };
  host.turn(session, 1);
  const brief = briefToolDefinition({ api: { enabled: () => true, read: () => ({}) } });
  const ask = await brief.execute({ action: 'clarify', questions: ['Scope?', 'Format?', 'Location?'].map((prompt, i) => ({
    id: 'q' + i, prompt, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] })) }, { agent: { session } });
  const first = latestOf(host.state(session), ask.id);
  assert.ok(waiting());
  await host.run(session, { id: first.id, rev: first.rev, action: 'answer', answers: { q0: 'a' } });
  const second = host.state(session).versions.at(-1);
  assert.equal(second.questions[0].prompt, 'Format?');
  assert.notEqual(first.anchor, second.anchor);
  assert.ok(waiting());
  assert.equal(host.state(session).versions[0].questions.length, 1);
  await host.run(session, { id: second.id, rev: second.rev, action: 'answer', answers: { q1: { custom: 'A different format' } } });
  assert.equal(waiting(), false);
  assert.equal(host.state(session).versions.length, 2);
  assert.match(host.delivered.at(-1).content[0].text, /fresh approval[\s\S]*Location\?|Reorganize[\s\S]*Location\?/u);
});
