import assert from 'node:assert/strict';
import test from 'node:test';
import { install as installCards, cardsRuntime } from '../lib/cards-context.mjs';
import { install as installSleep, sleepRuntime } from '../lib/deep-sleep.mjs';
import { virtualRuntime } from '../lib/virtual-dsh.mjs';
import { finish as finishQuota } from '../lib/sleep-virtual-quota.mjs';
import { apply as applySleepTool } from '../lib/deep-sleep-tool.mjs';
import { CARD_COMMAND } from '../lib/cards.mjs';
import { SLEEP_COMMAND, SLEEP_KEY } from '../lib/deep-sleep-state.mjs';
import { modeContext, wakeText } from '../lib/deep-sleep-prompt.mjs';

// The PTC SDK renders a tool's arguments only inside the host's schema subset; this mirrors it.
const KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'description', 'title', 'default', 'examples', 'deprecated']);
function schemaProblems(schema, path = 'schema') {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return [`${path}: not a schema object`];
  const found = [];
  for (const key of Object.keys(schema)) if (!KEYWORDS.has(key)) found.push(`${path}.${key}: unsupported keyword`);
  if (schema.type !== undefined && typeof schema.type !== 'string') found.push(`${path}.type: use one type string`);
  for (const [name, child] of Object.entries(schema.properties ?? {})) found.push(...schemaProblems(child, `${path}.properties.${name}`));
  if (schema.items !== undefined) found.push(...schemaProblems(schema.items, `${path}.items`));
  for (const [index, child] of (schema.oneOf ?? []).entries()) found.push(...schemaProblems(child, `${path}.oneOf.${index}`));
  return found;
}

function fakeGoals() {
  const views = new Map();
  const calls = [];
  let seq = 0;
  const store = (agent, view) => { views.set(agent.id, view); return view; };
  return {
    calls,
    get: agent => views.get(agent.id),
    create(agent, request) {
      calls.push({ op: 'create', ...request });
      return store(agent, { id: `goal-${++seq}`, revision: 1, objective: request.objective, phase: 'active',
        roundsStarted: 0, maxGoalRounds: request.maxGoalRounds ?? 256, activation: 'armed' });
    },
    edit(agent, ref, request) {
      calls.push({ op: 'edit', ...request });
      const current = views.get(agent.id);
      return store(agent, { ...current, revision: current.revision + 1, ...request });
    },
    pause(agent) {
      calls.push({ op: 'pause' });
      const current = views.get(agent.id);
      return store(agent, { ...current, revision: current.revision + 1, phase: 'paused', activation: 'disarmed' });
    },
    resume(agent) {
      calls.push({ op: 'resume' });
      const current = views.get(agent.id);
      return store(agent, { ...current, revision: current.revision + 1, phase: 'active', activation: 'armed' });
    },
    complete(agent) {
      calls.push({ op: 'complete' });
      const current = views.get(agent.id);
      return store(agent, { ...current, revision: current.revision + 1, phase: 'complete', activation: 'disarmed' });
    },
  };
}

function fakeHost() {
  const states = new Map();
  const definitions = new Map();
  const handlers = new Map();
  const tools = new Map();
  const listeners = new Map();
  const contexts = new Map();
  const delivered = [];
  const goals = fakeGoals();
  const agents = new Map();
  const ctx = {
    logger: { warn() {} },
    effect(register) { return register(); },
    on(name, listener) {
      const set = listeners.get(name) ?? new Set();
      set.add(listener);
      listeners.set(name, set);
      return () => set.delete(listener);
    },
    sessionProjections: { async register(definition) {
      definitions.set(definition.key, definition);
      const rows = new Map();
      states.set(definition.key, rows);
      return { stateOf: session => rows.get(session) ?? definition.init(), dispose() {} };
    } },
    commands: { register(definition) { handlers.set(definition.name, definition.handler); } },
    tools: { register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
    systemPrompt: { context: row => contexts.set(row.name, row) },
    get(name) {
      if (name === 'agentPresets') return { presetForSession: () => 'deep-ptc' };
      if (name === 'goals') return goals;
      if (name === 'agents') return { get: id => agents.get(id) };
      return undefined;
    },
  };
  const fold = (session, type, data) => {
    for (const definition of definitions.values()) {
      const rows = states.get(definition.key);
      rows.set(session, definition.apply(rows.get(session) ?? definition.init(), { type, data }));
    }
    for (const listener of listeners.get('session/event') ?? []) listener(session, { type, data });
  };
  const records = async () => (session, type, value) => fold(session, type, value);
  const state = (key, session) => states.get(key)?.get(session) ?? [...definitions.values()].find(d => d.key === key)?.init();
  return { ctx, records, handlers, tools, contexts, delivered, goals, agents, state, fold };
}

async function setup() {
  const host = fakeHost();
  await installSleep(host.ctx, host.records);
  await installCards(host.ctx, host.records);
  applySleepTool(host.ctx);
  const session = { id: 'agent-1', header: {} };
  const agent = { id: 'agent-1', session, status: 'idle', steer: message => host.delivered.push(message) };
  host.agents.set(agent.id, agent);
  const command = (name, payload) => host.handlers.get(name)({ agent, commandId: 'command-1',
    signal: new AbortController().signal, rawInput: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  const answer = async (id, answers) => {
    const rev = host.state('deepPtcCards', session).versions.findLast(row => row.id === id).rev;
    return host.handlers.get(CARD_COMMAND)({ agent, commandId: 'command-2', signal: new AbortController().signal,
      rawInput: JSON.stringify({ id, rev, action: 'answer', answers }) });
  };
  const tool = host.tools.get('deep_sleep');
  const call = (args, rootCallId = 'call-1') => tool.execute(args, { agent, rootCallId });
  const sleep = () => host.state(SLEEP_KEY, session);
  const cards = () => host.state('deepPtcCards', session);
  return { host, session, agent, command, answer, tool, call, sleep, cards };
}

const batch = () => [
  { title: '目标与背景', questions: [{ id: 'goal', prompt: '要做到什么程度？', type: 'text' }] },
  { title: '路线与约束', questions: [{ id: 'route', prompt: '有指定技术路线吗？', type: 'text' }, { id: 'budget', prompt: '有时间或预算限制吗？', type: 'text', optional: true }] },
];

test('the switch arms the mode and tells the model to brief instead of asking one by one', async () => {
  const { command, sleep, host } = await setup();
  const off = await command(SLEEP_COMMAND, { action: 'status' });
  assert.equal(off.kind, 'success');
  assert.match(off.text, /已关闭/u);

  const on = await command(SLEEP_COMMAND, { action: 'toggle' });
  assert.equal(on.kind, 'success');
  assert.match(on.text, /已开启/u);
  assert.equal(sleep().on, true);
  assert.equal(sleep().phase, 'asking');
  assert.equal(host.delivered.length, 1);
  assert.match(host.delivered[0].content[0].text, /Deep sleep mode: on/u);
  assert.match(host.delivered[0].content[0].text, /action=ask/u);
  assert.match(wakeText(), /action=confirm/u, 'the model is told to confirm before starting');

  const again = await command(SLEEP_COMMAND, { action: 'toggle' });
  assert.match(again.text, /已关闭/u);
  assert.equal(sleep().on, false);
  assert.equal(sleep().phase, 'off');
});

test('one batch of question cards is answered together and delivered once', async () => {
  const { command, call, answer, sleep, cards, host } = await setup();
  await command(SLEEP_COMMAND, { action: 'toggle' });
  const posted = await call({ action: 'ask', cards: batch() });
  assert.equal(posted.status, 'posted, waiting for the user to answer every card');
  assert.equal(posted.cards.length, 2);
  assert.equal(sleep().cards.length, 2);
  assert.equal(sleep().phase, 'asking');

  const versions = cards().versions.filter(row => row.series === posted.series);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].briefing, true);
  assert.equal(versions[0].seriesIndex, 1);
  assert.equal(versions[1].seriesIndex, 2);

  const before = host.delivered.length;
  const first = await answer(posted.cards[0].id, { goal: '把导出现在全部页签' });
  assert.equal(first.kind, 'success');
  assert.match(first.text, /^\[dpt:delivered:briefing-part\]/u);
  assert.equal(host.delivered.length, before, 'nothing reaches the model until the last card');

  const second = await answer(posted.cards[1].id, { route: '用现有导出器', budget: '今晚之前' });
  assert.equal(second.kind, 'success');
  assert.equal(host.delivered.length, before + 1);
  const text = host.delivered.at(-1).content[0].text;
  assert.match(text, /\[Deep sleep briefing: 2 cards answered\]/u);
  assert.match(text, /goal = «把导出现在全部页签»/u);
  assert.match(text, /route = «用现有导出器»/u);
  assert.match(text, /budget = «今晚之前»/u);
  assert.match(text, /action=start|action=confirm/u);
  assert.equal(sleep().phase, 'ready');
  assert.equal(sleep().answered, 2);
});

test('the confirmation card is what starts the run, and changes send the model back to the batch', async () => {
  const { command, call, answer, sleep, host } = await setup();
  const goals = host.goals;
  await command(SLEEP_COMMAND, { action: 'toggle' });
  const posted = await call({ action: 'ask', cards: batch() });
  await answer(posted.cards[0].id, { goal: '完成迁移' });
  await answer(posted.cards[1].id, { route: '逐目录迁移' });

  const confirm = await call({ action: 'confirm', title: '确认设定', objective: '把仓库迁移到新结构',
    summary: [{ label: '目标', value: '完成迁移' }, { label: '路线', value: '逐目录迁移' }] }, 'call-2');
  assert.equal(confirm.status, 'posted, waiting for the user decision');
  assert.equal(sleep().phase, 'confirming');
  assert.equal(goals.calls.length, 0, 'nothing starts before the user confirms');

  const revise = await answer(confirm.id, { decision: 'revise' });
  assert.equal(revise.kind, 'success');
  assert.equal(sleep().phase, 'asking');
  assert.match(host.delivered.at(-1).content[0].text, /not satisfied/u);
  assert.equal(goals.calls.length, 0);

  const confirmAgain = await call({ action: 'confirm', title: '确认设定', objective: '把仓库迁移到新结构' }, 'call-3');
  await answer(confirmAgain.id, { decision: 'start' });
  assert.equal(sleep().phase, 'running');
  assert.equal(sleep().objective, '把仓库迁移到新结构');
  assert.equal(goals.calls[0].op, 'create');
  assert.equal(goals.calls[0].objective, '把仓库迁移到新结构');
  assert.equal(goals.calls[0].maxGoalRounds, 256);
  assert.match(host.delivered.at(-1).content[0].text, /unattended run has started/u);
});

test('a run counts goal rounds and reopens the briefing when the user writes', async () => {
  const { command, call, answer, sleep, host, session } = await setup();
  const goals = host.goals;
  const fold = host.fold;
  await command(SLEEP_COMMAND, { action: 'toggle' });
  const confirm = await call({ action: 'confirm', objective: '把文档全部补齐' });
  await answer(confirm.id, { decision: 'start' });
  assert.equal(sleep().phase, 'running');

  fold(session, 'user/message', { source: { kind: 'goal', goalId: 'goal-1', revision: 1, round: 1 } });
  assert.equal(sleep().rounds, 1, 'a goal round reaches the panel');

  const before = host.delivered.length;
  fold(session, 'user/message', { source: { kind: 'user', rpcId: 'rpc-1' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(sleep().phase, 'asking', 'a message pauses the run and reopens the briefing');
  assert.equal(goals.calls.at(-1).op, 'pause');
  assert.equal(host.delivered.length, before + 1);
  assert.match(host.delivered.at(-1).content[0].text, /user wrote while the run was going/u);
});

test('turning the switch off pauses the goal, and on again resumes it', async () => {
  const { command, call, answer, sleep, host } = await setup();
  const goals = host.goals;
  await command(SLEEP_COMMAND, { action: 'toggle' });
  const confirm = await call({ action: 'confirm', objective: '把测试补齐' });
  await answer(confirm.id, { decision: 'start' });
  await command(SLEEP_COMMAND, { action: 'off' });
  assert.equal(sleep().on, false);
  assert.equal(goals.calls.at(-1).op, 'pause');
  await command(SLEEP_COMMAND, { action: 'on' });
  assert.equal(sleep().on, true);
  assert.equal(goals.calls.at(-1).op, 'resume', 'turning it back on re-arms the run');
});

test('the tool refuses a batch while the mode is off and a confirmation without an objective', async () => {
  const { call, command } = await setup();
  await assert.rejects(call({ action: 'ask', cards: batch() }), /mode is off/u);
  await command(SLEEP_COMMAND, { action: 'toggle' });
  await assert.rejects(call({ action: 'confirm', title: 'x' }), /objective: required/u);
  const status = await call({ action: 'status' });
  assert.equal(status.on, true);
  assert.equal(status.phase, 'asking');
});

test('the deep_sleep schema stays inside the SDK subset, and the prompt follows the phase', () => {
  const host = fakeHost();
  applySleepTool(host.ctx);
  const tool = host.tools.get('deep_sleep');
  assert.deepEqual(schemaProblems(tool.parameters), []);
  assert.equal(tool.resident, true, 'the tool keeps its full schema in the SDK');
  const asking = { on: true, phase: 'asking', cards: [], answered: 0, objective: '', rounds: 0 };
  assert.match(modeContext(asking), /Post the whole batch now/u);
  assert.match(modeContext({ ...asking, phase: 'running', objective: 'x', rounds: 3 }), /goal round 3/u);
  assert.match(modeContext({ ...asking, phase: 'confirming' }), /waits for the user/u);
  assert.equal(modeContext({ on: false }), '', 'nothing is added while the mode is off');
});

test('a single batch may carry more than eight cards', async () => {
  const { command, call, sleep, cards } = await setup();
  await command(SLEEP_COMMAND, { action: 'toggle' });
  const wide = Array.from({ length: 10 }, (_, index) => ({ title: `卡 ${index + 1}`, questions: [{ id: `q${index + 1}`, prompt: '问题？', type: 'text' }] }));
  const posted = await call({ action: 'ask', cards: wide });
  assert.equal(posted.cards.length, 10);
  assert.equal(sleep().cards.length, 10);
  assert.equal(cards().versions.filter(row => row.series === posted.series).length, 10);
});

test('the sleep prompt no longer caps the batch and routes new tasks through the brief with their checks', () => {
  const rules = modeContext({ on: true, phase: 'asking', cards: [], answered: 0 });
  assert.doesNotMatch(rules, /at most 8 cards|5 questions per card/u);
  assert.match(rules, /file the new tasks with their acceptance criteria in task_brief/u);
  assert.match(wakeText(), /file the new tasks and their acceptance criteria in task_brief/u);
});

test('deep sleep seeds a per-run virtual DSH quota and the first batch can request more', async () => {
  const calls = [];
  const prior = virtualRuntime.api;
  virtualRuntime.api = { setQuota(id, total) { calls.push([id, total]); } };
  let session;
  let command;
  let call;
  let answer;
  try {
    ({ command, call, answer, session } = await setup());
    await command(SLEEP_COMMAND, 'on');
    assert.deepEqual(calls.at(-1), ['agent-1', 20]);
    const posted = await call({ action: 'ask', virtual_uses: 60, cards: batch() });
    const quotaCard = posted.cards.find(row => row.title === '虚拟 DSH 使用额度');
    assert.ok(quotaCard, 'the first batch carries the quota card');
    await answer(quotaCard.id, { starts: '90' });
    assert.deepEqual(calls.at(-1), ['agent-1', 90]);
    await call({ action: 'complete' });
    assert.deepEqual(calls.at(-1), ['agent-1', 0]);
    await call({ action: 'ask', cards: batch() });
    assert.deepEqual(calls.at(-1), ['agent-1', 20], 'the next run seeds 20 again');
    await command(SLEEP_COMMAND, 'off');
    assert.deepEqual(calls.at(-1), ['agent-1', 0]);
  } finally {
    if (session !== undefined) finishQuota(session);
    virtualRuntime.api = prior;
  }
});
