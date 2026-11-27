import assert from 'node:assert/strict';
import test from 'node:test';
import { installCardWait } from '../lib/card-wait.mjs';
import { BRIEF_GUIDANCE, applyUpdate, applyUserEdit, blankBrief, coverage, promptText, stateText, stubText, substantive } from '../lib/task-brief.mjs';
import { acceptanceProgress } from '../lib/brief-progress.mjs';
import { BRIEF_COMMAND, BRIEF_EVENT, briefContextText, briefRuntime, cardAnswerText, briefToolDefinition, briefView, foldBrief, install, reminderText,
  sectionText, settleCondensing } from '../lib/brief-context.mjs';

const MESSAGE = '并且卡片展示给人类的样子，我们已经有了雏形，但是卡片展示给模型的样子，以什么形式进入上下文，则是我们这次需要额外做的，毕竟卡片本身的视觉信息并不都有价值，模型也不需要好看，而是需要效率与准确';
const withMessage = (text = MESSAGE) => ({ ...blankBrief(), turn: 3, messages: [{ ref: 'm40', seq: 40, turn: 3, text }] });

function assertNoUndefined(value, path = 'state') {
  if (value === undefined) assert.fail(path + ' is undefined');
  if (value === null || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) assertNoUndefined(child, path + '.' + key);
}

test('items that restate the user must quote their words exactly; implicit needs are marked inferred', () => {
  const { brief, rejected, text } = applyUpdate(withMessage(), { items: [
    { section: 'goal', text: '设计卡片进入模型上下文的形式', quote: '卡片展示给模型的样子，以什么形式进入上下文' },
    { section: 'constraint', text: '模型面追求效率与准确', quote: '模型也不需要好看，而是需要效率与准确' },
    { section: 'constraint', text: '保留人看的卡片样式', inferred: true },
    { section: 'goal', text: '编造的需求', quote: '这句话用户没说过' },
    { section: 'goal', text: '没有出处' },
  ] }, 3);
  assert.equal(text, '+G1 +C1 +C2');
  assert.equal(rejected.length, 2);
  assert.match(rejected[0], /not in the recent user messages/u);
  assert.match(rejected[1], /inferred:true/u);
  assert.deepEqual(brief.items.map(item => [item.id, item.basis, item.from]), [['G1', 'user', 'm40'], ['C1', 'user', 'm40'], ['C2', 'inferred', undefined]]);
});

test('coverage lists the text no item quotes, verbatim, until it is filed or skipped', () => {
  let { brief } = applyUpdate(withMessage(), { items: [
    { section: 'goal', text: '设计模型面', quote: '卡片展示给模型的样子，以什么形式进入上下文' },
    { section: 'constraint', text: '效率与准确', quote: '模型也不需要好看，而是需要效率与准确' }] }, 3);
  const first = coverage(brief.messages[0], brief.items);
  assert.deepEqual(first.unfiled, ['并且卡片展示给人类的样子，我们已经有了雏形', '则是我们这次需要额外做的，毕竟卡片本身的视觉信息并不都有价值']);
  ({ brief } = applyUpdate(brief, { items: [{ section: 'context', text: '人看的卡片已有雏形', quote: '卡片展示给人类的样子，我们已经有了雏形' },
    { section: 'constraint', text: '视觉信息对模型不都有价值', quote: '卡片本身的视觉信息并不都有价值' }], skip: [{ quote: '则是我们这次需要额外做的' }] }, 3));
  const after = coverage(brief.messages[0], brief.items);
  assert.deepEqual(after.unfiled, []);
  assert.equal(after.covered, after.total);
});

test('the user\'s confirmed items are theirs: the model may finish them but not reword or drop them', () => {
  let { brief } = applyUpdate(withMessage(), { items: [{ section: 'goal', text: '设计模型面', quote: '以什么形式进入上下文' }] }, 3);
  ({ brief } = applyUserEdit(brief, { op: 'confirm' }, 3));
  assert.equal(brief.items[0].basis, 'confirmed');
  const reword = applyUpdate(brief, { items: [{ id: 'G1', text: '改个说法', quote: '以什么形式进入上下文' }], remove: ['G1'] }, 4);
  assert.equal(reword.rejected.length, 2);
  assert.equal(reword.brief.items[0].text, '设计模型面');
  const done = applyUpdate(brief, { done: ['G1'] }, 4);
  assert.equal(done.brief.items[0].status, 'done');
  const edited = applyUserEdit(brief, { op: 'add', section: 'acceptance', text: '模型能按 id 引用' }, 4).brief;
  assert.deepEqual(edited.items.at(-1), { id: 'A1', section: 'acceptance', text: '模型能按 id 引用', basis: 'confirmed', status: 'open', turn: 4 });
});

test('the model reads ids, basis and quotes, with no presentation', () => {
  const { brief } = applyUpdate(withMessage(), { items: [
    { section: 'goal', text: '设计模型面', quote: '以什么形式进入上下文' },
    { section: 'constraint', text: '保留人看的样式', inferred: true }] }, 3);
  const text = promptText(brief);
  assert.match(text, /^# Task brief\n/u);
  assert.match(text, /^# Task brief \(rev 1\) — /mu);
  assert.match(text, /^- G1 \[user m40\] 设计模型面 «以什么形式进入上下文»$/mu);
  assert.match(text, /^- C1 \[inferred\] 保留人看的样式$/mu);
  assert.match(text, /^Unfiled text — file it or skip it: m40 «/mu);
  assert.doesNotMatch(text, /tone|icon|size/u);
  assert.equal(stateText(blankBrief()), '', 'an empty brief adds nothing to the context');
  assert.equal(promptText(blankBrief()), BRIEF_GUIDANCE);
  const stub = stubText(brief, brief.messages[0]);
  assert.match(stub, /^\[User message m40 \(turn 3\) is filed in the task brief: G1\. /u);
  assert.match(stub, /task_brief action=source ref=m40/u);
  assert.match(stub, /Unfiled text from this message, verbatim:\n«并且卡片展示给人类的样子/u);
});

test('a substantive message is long, has several clauses or carries a rule word', () => {
  assert.equal(substantive('好的谢谢'), false);
  assert.equal(substantive('继续'), false);
  assert.equal(substantive('不要改公共接口'), true);
  assert.equal(substantive('改一下标题，加个图标，再跑测试'), true);
});

// A host that folds every appended event into the projection, with a session surface.
function fakeHost() {
  const states = new Map();
  const handlers = new Map();
  const listeners = new Map();
  let projection;
  const ctx = {
    logger: { warn() {} },
    effect(register) { const dispose = register(); return () => dispose?.(); },
    on(name, listener) { listeners.set(name, listener); return () => {}; },
    sessionProjections: { async register(definition) { projection = definition; return { stateOf: session => states.get(session), dispose() {} }; } },
    commands: { register(definition) { handlers.set(definition.name, definition.handler); } },
    get: () => undefined,
  };
  const fold = (session, event) => states.set(session, projection.apply(states.get(session) ?? projection.init(), event));
  const records = async () => (session, type, data) => fold(session, { type, data });
  function session(id) {
    const log = [];
    const s = { id, header: { agentPreset: 'deep-ptc' }, surface: { nodes: [] },
      eventAt: seq => log.find(event => event.seq === seq),
      append(type, data, opts) {
        const event = { seq: log.length + 1, type, data, ...opts };
        log.push(event);
        if (opts?.surfaceOp === 'append') s.surface.nodes.push(event.seq);
        else if (opts?.surfaceOp?.op === 'replace') s.surface.nodes = s.surface.nodes.map(seq => seq === opts.surfaceOp.startSeq ? event.seq : seq);
        fold(s, event);
        listeners.get('session/event')?.(s, event);
        return event;
      } };
    return s;
  }
  const say = (s, text) => s.append('user/message', { id: `u${Math.random()}`, role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } }, { surfaceOp: 'append' });
  return { ctx, records, handlers, listeners, session, say, state: s => states.get(s) };
}

test('condensing swaps the message for its stub before the next request, and restoring brings it back', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  const s = host.session('brief-1');
  s.append('turn/start', { turn: 1 });
  const said = host.say(s, MESSAGE);
  const tool = briefToolDefinition();
  const agent = { session: s };
  const filed = await tool.execute({ action: 'update', items: [{ section: 'goal', text: '设计模型面', quote: '以什么形式进入上下文' }] }, { agent });
  assert.equal(filed.changes, '+G1');
  assert.equal(filed.unfiled[0].ref, `m${said.seq}`);
  assert.match(filed.next, /File the unfiled text/u);

  const run = request => host.handlers.get(BRIEF_COMMAND)({ agent, rawInput: JSON.stringify(request) });
  assert.equal((await run({ op: 'condense', ref: 'all' })).kind, 'success');
  assert.equal(host.state(s).items[0].basis, 'confirmed', 'condensing confirms the user\'s items');
  assert.equal(briefView(host.state(s)).messages[0].pending, 'condense');
  await host.listeners.get('agent/pre-step')({ agent }, async () => ({ kind: 'enter', messages: [] }));
  const stub = s.eventAt(s.surface.nodes[0]);
  assert.deepEqual(stub.surfaceOp, { op: 'replace', startSeq: said.seq, endSeq: said.seq });
  assert.deepEqual(stub.sourceEventSeqs, [said.seq]);
  assert.equal(stub.data.source.kind, 'deep-ptc-brief');
  assert.match(stub.data.content[0].text, /is filed in the task brief: G1/u);
  assert.ok(s.eventAt(said.seq), 'the original stays in the log');
  assert.equal(host.state(s).messages[0].condensed, true);
  assert.match(promptText(host.state(s)), /Condensed into this brief: m\d+/u);
  const source = await tool.execute({ action: 'source', ref: `m${said.seq}` }, { agent });
  assert.equal(source.text, MESSAGE, 'the model can read the original back');

  assert.equal((await run({ op: 'restore', ref: `m${said.seq}` })).kind, 'success');
  await settleCondensing(host.ctx, briefRuntime.api, s);
  const restored = s.eventAt(s.surface.nodes[0]);
  assert.equal(restored.data.content[0].text, MESSAGE);
  assert.equal(host.state(s).messages[0].condensed, undefined);
});

test('answering the last review item condenses the reviewed message without a second click', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  const s = host.session('auto-condense');
  const agent = { session: s };
  s.append('turn/start', { turn: 1 });
  const said = host.say(s, MESSAGE);
  await briefToolDefinition().execute({ action: 'update', items: [
    { section: 'goal', text: '设计模型面', quote: '卡片展示给模型的样子，以什么形式进入上下文' },
    { section: 'constraint', text: '效率与准确', quote: '模型也不需要好看，而是需要效率与准确' }] }, { agent });
  const run = payload => host.handlers.get(BRIEF_COMMAND)({ agent, rawInput: JSON.stringify(payload) });
  assert.equal((await run({ op: 'confirm', ids: ['G1'] })).kind, 'success');
  assert.equal(host.state(s).messages[0].pending, undefined, 'the first answer does not condense a review still in progress');
  assert.equal((await run({ op: 'confirm', ids: ['C1'] })).kind, 'success');
  assert.equal(host.state(s).versions.at(-1).settled, true);
  assert.equal(host.state(s).messages[0].pending, 'condense', 'the closing answer starts the condense by itself');
  await host.listeners.get('agent/pre-step')({ agent }, async () => ({ kind: 'enter', messages: [] }));
  assert.equal(host.state(s).messages[0].condensed, true);
  const stub = s.eventAt(s.surface.nodes[0]);
  assert.match(stub.data.content[0].text, /is filed in the task brief: G1 C1/u);
  assert.ok(s.eventAt(said.seq), 'the original stays in the log');
  assert.match(promptText(host.state(s)), /Condensed into this brief: m\d+/u);
});

test('selecting the last version closes the review and condenses the reviewed message by itself', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  const s = host.session('auto-condense-version');
  const agent = { session: s };
  s.append('turn/start', { turn: 1 });
  host.say(s, MESSAGE);
  await briefToolDefinition().execute({ action: 'update', items: [{ section: 'goal', text: '模型面设计', quote: '卡片展示给模型的样子，以什么形式进入上下文',
    question: '按哪种范围设计？', versions: [{ label: '只做卡片', text: '只设计卡片' }, { label: '卡片和模型视图', text: '卡片和模型视图都设计' }] }] }, { agent });
  const run = payload => host.handlers.get(BRIEF_COMMAND)({ agent, rawInput: JSON.stringify(payload) });
  assert.equal((await run({ op: 'confirm', ids: ['G1'], choice: 'v2', rev: 1 })).kind, 'success');
  assert.equal(host.state(s).items[0].text, '卡片和模型视图都设计');
  assert.equal(host.state(s).versions[0].settled, true);
  assert.equal(host.state(s).messages[0].pending, 'condense', 'a version choice that ends the review condenses too');
});

test('an unfiled substantive message earns at most two reminders, and none once it is filed', async () => {
  const host = fakeHost();
  await install(host.ctx, host.records);
  const s = host.session('brief-2');
  const agent = { session: s };
  s.append('turn/start', { turn: 1 });
  host.say(s, MESSAGE);
  const ctx = { get: () => undefined };
  assert.equal(reminderText(ctx, agent), '', 'no reminder before the model has taken a step');
  s.append('assistant/message', { message: { content: [{ type: 'tool-call' }] } });
  assert.match(reminderText(ctx, agent), /is not in the task brief/u);
  assert.match(reminderText(ctx, agent), /is not in the task brief/u);
  assert.equal(reminderText(ctx, agent), '', 'it stops nagging');
  host.say(s, '只改客户端，不要动服务端协议');
  s.append('assistant/message', { message: { content: [{ type: 'text', text: 'ok' }] } });
  await briefToolDefinition().execute({ action: 'update', items: [{ section: 'constraint', text: '只改客户端', quote: '只改客户端' }] }, { agent });
  assert.equal(reminderText(ctx, agent), '');
});

test('a card answer is the user\'s words: the brief can quote the chosen option and the typed text', () => {
  const view = ['[Card answer: trip «周末一日游»]', 'city = philadelphia «费城»    # 想去哪个城市？', 'budget = «300 美元以内»    # 预算多少？',
    'These answers settle the card. Continue the work that waited on them; do not ask them again.'].join('\n');
  assert.equal(cardAnswerText(view), '想去哪个城市？：费城\n预算多少？：300 美元以内');
  let state = foldBrief(blankBrief(), { type: 'user/message', seq: 65, surfaceOp: 'append',
    data: { content: [{ type: 'text', text: view }], source: { kind: 'deep-ptc-card', form: 'notice', summary: '回答 · 周末一日游' } } });
  assert.equal(state.messages[0].card, true);
  const { brief, rejected } = applyUpdate(state, { items: [{ section: 'constraint', text: '去费城', quote: '费城' },
    { section: 'constraint', text: '预算 300 美元以内', quote: '300 美元以内' }] }, 1);
  assert.deepEqual(rejected, []);
  assert.deepEqual(brief.items.map(item => [item.basis, item.from]), [['user', 'm65'], ['user', 'm65']]);
});

test('the system prompt keeps only the fixed guidance; the changing brief rides in the context snapshot', async () => {
  // A changed system prompt is re-sent whole (about 18k uncached tokens per change in a live run),
  // so filing an item must leave the system prompt text exactly as it was.
  const host = fakeHost();
  await install(host.ctx, host.records);
  const s = host.session('brief-cache');
  const agent = { session: s };
  const ctx = { get: () => undefined };
  s.append('turn/start', { turn: 1 });
  host.say(s, MESSAGE);
  const before = sectionText(ctx, agent);
  assert.equal(briefContextText(ctx, agent), '');
  await briefToolDefinition().execute({ action: 'update', items: [{ section: 'goal', text: '设计模型面', quote: '以什么形式进入上下文' }] }, { agent });
  assert.equal(sectionText(ctx, agent), before, 'the system prompt did not change');
  assert.equal(before, BRIEF_GUIDANCE);
  assert.match(briefContextText(ctx, agent), /^# Task brief \(rev 1\)[\s\S]*^- G1 \[user m\d+\] 设计模型面/mu);
});

test('records carry the brief and marks, never the message text', () => {
  let state = foldBrief(blankBrief(), { type: 'user/message', seq: 7, data: { content: [{ type: 'text', text: '保持原有行为' }], source: { kind: 'user' } } });
  state = foldBrief(state, { type: 'user/message', seq: 8, surfaceOp: { op: 'replace', startSeq: 7, endSeq: 7 }, data: { content: [{ type: 'text', text: 'stub' }], source: { kind: 'deep-ptc-brief' } } });
  assert.deepEqual(state.messages.map(message => message.ref), ['m7'], 'stubs and other producers are not user messages');
  state = foldBrief(state, { type: BRIEF_EVENT, data: { v: 1, rev: 1, updatedTurn: 0, next: { G: 2, C: 1, A: 1, K: 1, O: 1 },
    items: [{ id: 'G1', section: 'goal', text: '保持原有行为', basis: 'user', quote: '保持原有行为', from: 'm7', status: 'open' }], marks: { m7: { condensed: true, stubSeq: 8 } } } });
  assert.equal(state.messages[0].text, '保持原有行为');
  assert.equal(state.messages[0].condensed, true);
});

test('brief snapshots replace drafts and retain decisions across turns', () => {
  const item = basis => ({ id: 'G1', section: 'goal', text: 'Keep this behavior', basis, quote: 'Keep this behavior', from: 'm7', status: 'open' });
  const record = (rev, turn, items) => ({ type: BRIEF_EVENT, data: { v: 1, rev, updatedTurn: turn, next: { G: 2, C: 1, A: 1, K: 1, O: 1 }, items, marks: {} } });
  let state = foldBrief(blankBrief(), { type: 'turn/start', data: { turn: 2 } });
  state = foldBrief(state, record(1, 2, [item('user')]));
  assert.equal(state.versions.length, 1);
  assert.equal(state.versions[0].turn, 2);
  assert.deepEqual(state.versions[0].items.map(row => row.basis), ['user']);
  assert.deepEqual(state.versions[0].messages, []);
  // A confirmation adds its own version of the same turn; the tail renders the newest one.
  state = foldBrief(state, record(2, 2, [item('confirmed')]));
  assert.deepEqual(state.versions.map(row => row.rev), [2]);
  assert.equal(state.versions.at(-1).items[0].basis, 'confirmed');
  // Replaying the same record never duplicates a version.
  state = foldBrief(state, record(2, 2, [item('confirmed')]));
  assert.equal(state.versions.length, 1);
  for (let rev = 3; rev <= 20; rev++) state = foldBrief(state, record(rev, 2 + rev, [item('confirmed')]));
  assert.equal(state.versions.length, 19, 'the first settled approval remains in history');
  assert.equal(state.versions.at(-1).rev, 20);
  assert.equal(briefView(state).versions.length, 19, 'the view carries the history');
});

test('a folded brief never stores undefined, including waiting and settled rounds', () => {
  const item = status => ({ id: 'G1', section: 'goal', text: 'Keep this behavior', basis: 'user', quote: 'Keep this behavior', from: 'm7', status });
  const record = (rev, items) => ({ type: BRIEF_EVENT, seq: rev, data: { v: 1, single: true, rev, updatedTurn: 2, next: { G: 2, C: 1, A: 1, K: 1, O: 1 }, items, marks: {} } });
  let state = foldBrief(blankBrief(), { type: 'turn/start', data: { turn: 2 } });
  state = foldBrief(state, record(1, [item('open')]));
  assertNoUndefined(state);
  assert.equal(Object.hasOwn(state.versions.at(-1), 'waiting'), false, 'a new waiting round has no undefined waiting key');
  state = foldBrief(state, record(2, [item('done')]));
  assertNoUndefined(state);
  assert.equal(Object.hasOwn(state.versions.at(-1), 'waiting'), false, 'a settled round drops the waiting key');
  let open = foldBrief(blankBrief(), { type: 'turn/start', data: { turn: 2 } });
  open = foldBrief(open, record(1, [item('open')]));
  const completing = record(2, [item('done')]);
  completing.data.completed = { title: 'done' };
  open = foldBrief(open, completing);
  assertNoUndefined(open);
});

test('the root SDK call waits for every brief item and partial edits keep it paused', async () => {
  const host = fakeHost();
  const waits = installCardWait(host.ctx, () => () => {});
  await install(host.ctx, host.records, { waits });
  const agent = { session: host.session('brief-approval') };
  const session = agent.session;
  session.append('turn/start', { turn: 1 });
  const root = { agent, callId: 'root', signal: AbortSignal.timeout(2000) };
  const nested = { ...root, callId: 'nested', rootCallId: root.callId, parent: {}, name: 'task_brief' };
  const tool = briefToolDefinition();
  await tool.execute({ action: 'update', items: ['first', 'second'].map(text => ({ section: 'goal', inferred: true, text })) }, nested);
  const post = host.listeners.get('tools/post-execute');
  const pre = host.listeners.get('tools/pre-execute');
  assert.equal((await pre(nested, () => ({ kind: 'allow' }))).kind, 'deny');
  assert.equal(await post(nested, {}, () => 'posted'), 'posted');
  let resumed = false;
  const posted = post(root, {}, () => { resumed = true; });
  const confirm = ids => host.handlers.get(BRIEF_COMMAND)({ agent, rawInput: JSON.stringify({ op: 'confirm', ids }) });
  assert.equal((await confirm(['G1'])).kind, 'success');
  assert.equal(resumed, false);
  assert.equal((await confirm(['G2'])).kind, 'success');
  await posted;
  assert.equal(resumed, true);
  assert.equal(host.state(session).versions.length, 1, 'one review round keeps one card');
  assert.equal(host.state(session).versions[0].settled, true);
  assert.deepEqual(host.state(session).versions[0].decided.map(d => [d.item.id, d.outcome]), [['G1', 'confirmed'], ['G2', 'confirmed']]);
  await tool.execute({ action: 'update', items: [{ section: 'constraint', inferred: true, text: 'third' }] }, nested);
  const stop = new AbortController();
  const interrupted = post({ ...root, signal: stop.signal }, {}, () => 'aborted');
  stop.abort();
  assert.equal(await interrupted, 'aborted');
  assert.equal(host.state(session).items.at(-1).basis, 'inferred', 'cancellation grants no approval');
  await confirm(['C1']);
  assert.deepEqual(host.state(session).versions.map(v => v.decided.map(d => d.item.id)), [['G1', 'G2'], ['C1']]);
  assert.deepEqual(host.state(session).versions.map(v => v.anchor), [1, 4]);
});

test('returning a draft releases its wait and preserves the original review and correction', async () => {
  const host = fakeHost(), session = host.session('rethink');
  const messages = [];
  const agent = { session, steer: msg => messages.push(msg) };
  await install(host.ctx, host.records);
  session.append('turn/start', { turn: 1 });
  const file = text => briefToolDefinition().execute({ action: 'update', items: [{ text, section: 'goal', inferred: true }] }, { agent });
  await file('First interpretation');
  const cmd = host.handlers.get(BRIEF_COMMAND);
  await cmd({ agent, rawInput: JSON.stringify({ op: 'rethink', rev: 1, feedback: 'Which subset?' }) });
  const returned = host.state(session);
  assert.equal(returned.items.length, 0);
  assert.equal(returned.versions[0].decided[0].feedback, 'Which subset?');
  assert.equal(returned.versions[0].decided[0].item.text, 'First interpretation');
  assert.equal(returned.versions[0].waiting, 'G1', 'the round waits in place for the redraft');
  assert.match(messages[0].content[0].text, /task_brief update.*[\s\S]*Which subset\?/u);
  await file('Corrected interpretation');
  assert.deepEqual(host.state(session).versions.map(row => row.anchor), [1], 'the redraft returns to the same card');
  assert.equal(host.state(session).versions[0].items[0].text, 'Corrected interpretation');
});

test('a custom response pauses the queue until the corrected item is presented and decided separately', async () => {
  const host = fakeHost(), session = host.session('single-reviews');
  const notices = [];
  const agent = { session, steer: msg => { notices.push(msg); } };
  await install(host.ctx, host.records);
  session.append('turn/start', { turn: 1 });
  const tool = briefToolDefinition();
  const update = items => tool.execute({ action: 'update', items }, { agent });
  const run = payload => host.handlers.get(BRIEF_COMMAND)({ agent, rawInput: JSON.stringify(payload) });
  await update(['first', 'second', 'third'].map(text => ({ section: 'goal', inferred: true, text })));
  assert.deepEqual(host.state(session).versions.map(v => v.items.map(i => i.id)), [['G1']]);
  assert.equal((await run({ op: 'confirm', ids: ['G1', 'G2'] })).kind, 'error');
  await run({ op: 'rethink', id: 'G1', feedback: 'Across all pages', rev: 1 });
  assert.deepEqual(host.state(session).items.map(i => i.id), ['G2', 'G3']);
  assert.equal(host.state(session).versions.at(-1).decided.at(-1).outcome, 'returned');
  assert.equal((await run({ op: 'confirm', ids: ['G2'] })).kind, 'error');
  session.append('user/message', notices.at(-1));
  await update([{ id: 'G1', text: 'Use all pages', quote: 'Across all pages' }]);
  const revised = host.state(session).versions.at(-1);
  assert.equal(revised.anchor, 1);
  assert.equal(revised.items[0].id, 'G1');
  assert.notEqual(revised.items[0].basis, 'confirmed');
  assert.equal((await run({ op: 'confirm', ids: ['G1'], rev: 1 })).kind, 'error');
  await run({ op: 'confirm', ids: ['G1'], rev: 3 });
  await run({ op: 'remove', id: 'G2', rev: 4 });
  await run({ op: 'confirm', ids: ['G3'], rev: 5 });
  const state = host.state(session);
  assert.equal(state.versions.length, 1);
  assert.deepEqual(state.versions[0].decided.map(d => [d.item.id, d.outcome]), [['G1', 'confirmed'], ['G2', 'declined'], ['G3', 'confirmed']]);
  assert.equal(state.versions[0].decided[0].feedback, 'Across all pages', 'the returned note stays with the item');
  assert.deepEqual(state.items.map(i => i.id), ['G1', 'G3']);
});

test('task review commits only the explicitly selected wording and preserves the selected version in history', async () => {
  const host = fakeHost(), session = host.session('wording');
  const messages = [], agent = { session, steer: m => messages.push(m) };
  await install(host.ctx, host.records);
  session.append('turn/start', { turn: 1 });
  const question = '谁应该收到日报？';
  const versions = [{ label: '负责人', text: '每日只通知任务负责人。' }, { label: '整个小组', text: '每日通知小组所有成员。', hint: '适合共同跟进' }];
  const tool = briefToolDefinition();
  const update = v => tool.execute({ action: 'update', items: [{ section: 'constraint', inferred: true, text: '日报接收范围', question, versions: v }] }, { agent });
  const cmd = data => host.handlers.get(BRIEF_COMMAND)({ agent, rawInput: JSON.stringify(data) });
  const invalid = await update([versions[0], versions[0]]);
  assert.match(invalid.rejected[0], /distinct/u);
  assert.equal(host.state(session).rev, 0);
  await update(versions);
  for (const payload of [{}, { choice: 'unknown' }, { choice: 'v2', rev: 0 }]) {
    assert.equal((await cmd({ op: 'confirm', ids: ['C1'], rev: 1, ...payload })).kind, 'error');
  }
  assert.equal((await cmd({ op: 'confirm', ids: ['C1'], choice: 'v2', rev: 1 })).kind, 'success');
  const state = host.state(session);
  assert.equal(state.items[0].text, versions[1].text);
  assert.equal(state.items[0].basis, 'confirmed');
  assert.equal(state.versions[0].decided[0].item.review.question, question);
  assert.equal(state.versions[0].decided[0].item.selected, 'v2');
  assert.match(messages[0].content[0].text, /整个小组.*每日通知小组所有成员/u);
});

test('confirming the rest settles every remaining item without versions in one step', async () => {
  const host = fakeHost(), session = host.session('confirm-rest');
  const agent = { session, steer: () => {} };
  await install(host.ctx, host.records);
  session.append('turn/start', { turn: 1 });
  const tool = briefToolDefinition();
  await tool.execute({ action: 'update', items: [
    ...['first', 'second', 'third'].map(text => ({ section: 'goal', inferred: true, text })),
    { section: 'constraint', inferred: true, text: 'scope', question: 'Which scope?', versions: [{ label: 'A', text: 'Only A' }, { label: 'B', text: 'Only B' }] },
  ] }, { agent });
  const run = payload => host.handlers.get(BRIEF_COMMAND)({ agent, rawInput: JSON.stringify(payload) });
  assert.equal((await run({ op: 'confirm-rest' })).kind, 'success');
  const state = host.state(session);
  assert.deepEqual(state.items.filter(item => item.basis === 'confirmed').map(item => item.id), ['G1', 'G2', 'G3']);
  assert.equal(state.versions.length, 1);
  assert.equal(state.versions[0].items[0].id, 'C1', 'an item with versions is still asked');
  assert.deepEqual(state.versions[0].queue, ['C1']);
});

test('completing a task archives it, leaves a receipt and empties the brief for the next task', async () => {
  const host = fakeHost(), session = host.session('complete');
  const notices = [];
  const agent = { session, steer: message => notices.push(message) };
  await install(host.ctx, host.records);
  session.append('turn/start', { turn: 1 });
  session.append('user/message', { content: [{ type: 'text', text: '帮我做杭州两日行程，预算别超过1500' }], source: { kind: 'user' } });
  const tool = briefToolDefinition();
  await tool.execute({ action: 'update', items: [{ section: 'goal', text: '杭州两日行程', quote: '杭州两日行程' }, { section: 'acceptance', inferred: true, text: '表格覆盖两天' }] }, { agent });
  const run = payload => host.handlers.get(BRIEF_COMMAND)({ agent, rawInput: JSON.stringify(payload) });
  await run({ op: 'confirm-rest' });
  await assert.rejects(tool.execute({ action: 'complete' }, { agent }), /mark the finished goal and acceptance items.*G1, A1/u);
  const update = await tool.execute({ action: 'update', done: ['G1', 'A1'] }, { agent });
  assert.match(update.finished, /action=complete/u, 'the model is told it can archive');
  const done = await tool.execute({ action: 'complete', summary: '两天行程表，合计 1386 元' }, { agent });
  assert.equal(done.status, 'done');
  assert.equal(done.title, '杭州两日行程');
  const state = host.state(session);
  assert.deepEqual(state.items, []);
  const receipt = state.versions.at(-1);
  assert.equal(receipt.completed.title, '杭州两日行程');
  assert.equal(receipt.completed.counts.acceptanceDone, 1);
  assert.equal(state.tasks.at(-1).summary, '两天行程表，合计 1386 元');
  assert.deepEqual(briefView(state).messages, [], 'messages of the archived task leave the coverage view');
  assert.equal(stateText(state), '', 'an empty brief puts nothing in the prompt');
  // The next task starts fresh and cannot quote the archived message.
  const next = await tool.execute({ action: 'update', items: [{ section: 'goal', text: 'x', quote: '杭州两日行程' }] }, { agent });
  assert.match(next.rejected[0], /not in/u);
  // The user can give a task up from the card.
  await tool.execute({ action: 'update', items: [{ section: 'goal', inferred: true, text: '另一个任务' }] }, { agent });
  assert.equal((await run({ op: 'complete', status: 'dropped' })).text, 'dropped');
  await tool.execute({ action: 'update', items: [{ section: 'acceptance', inferred: true, text: '用户说完成' }] }, { agent });
  assert.equal((await run({ op: 'complete' })).text, 'done', 'the user can complete with open checks');
  assert.equal(host.state(session).versions.at(-1).completed.counts.acceptanceDone, 1);
  assert.match(notices.at(-2).content[0].text, /abandoned/u);
  assert.equal((await run({ op: 'complete' })).kind, 'error', 'an empty brief has nothing to complete');
});

test('the brief holds two hundred items after the old forty-item cap', () => {
  const first = applyUpdate(blankBrief(), { items: Array.from({ length: 120 }, (_, index) => ({ section: 'context', text: `背景 ${index + 1}`, inferred: true })) });
  assert.deepEqual(first.rejected, []);
  assert.equal(first.brief.items.length, 120);
  const grown = applyUpdate(first.brief, { items: Array.from({ length: 100 }, (_, index) => ({ section: 'context', text: `补充 ${index + 1}`, inferred: true })) });
  assert.equal(grown.brief.items.length, 200);
  assert.equal(grown.rejected.length, 20, 'the two-hundredth item is the last one accepted');
});

test('acceptance is verified as work goes and the brief states its progress', () => {
  let { brief } = applyUpdate(withMessage(), { items: [
    { section: 'goal', text: '设计模型面', quote: '以什么形式进入上下文' },
    { section: 'acceptance', text: '模型能按 id 引用条目', quote: '以什么形式进入上下文' },
    { section: 'acceptance', inferred: true, text: '状态行显示验收进度' },
  ] }, 3);
  assert.deepEqual(acceptanceProgress(brief), { done: 0, total: 2, open: ['A1', 'A2'] });
  assert.match(stateText(brief), /Acceptance: 0\/2 verified; open A1 A2\./u);
  ({ brief } = applyUpdate(brief, { done: ['A1'] }, 4));
  assert.deepEqual(acceptanceProgress(brief), { done: 1, total: 2, open: ['A2'] });
  assert.match(stateText(brief), /Acceptance: 1\/2 verified; open A2\./u);
  assert.match(BRIEF_GUIDANCE, /Verify as you go/u);
  assert.match(BRIEF_GUIDANCE, /never only in the first round/u);
});

test('a goal filed without a check is flagged, and a later task brings its own acceptance', async () => {
  const host = fakeHost(), session = host.session('rhythm'), notices = [];
  const agent = { session, steer: message => notices.push(message) };
  await install(host.ctx, host.records);
  session.append('turn/start', { turn: 1 });
  session.append('user/message', { content: [{ type: 'text', text: '请把导出改成异步' }], source: { kind: 'user' } });
  const tool = briefToolDefinition();
  const filed = await tool.execute({ action: 'update', items: [{ section: 'goal', text: '导出改异步', quote: '把导出改成异步' }] }, { agent });
  assert.match(filed.missingAcceptance, /G1 arrived with no acceptance item/u);
  session.append('turn/start', { turn: 2 });
  session.append('user/message', { content: [{ type: 'text', text: '再加一个进度条' }], source: { kind: 'user' } });
  const added = await tool.execute({ action: 'update', items: [
    { section: 'acceptance', text: '导出过程有进度条', quote: '再加一个进度条' },
    { section: 'goal', text: '加进度条', quote: '再加一个进度条' },
  ] }, { agent });
  assert.equal(added.missingAcceptance, undefined);
  assert.match(added.acceptance, /0\/1 verified; open A1/u);
  const done = await tool.execute({ action: 'update', done: ['A1'] }, { agent });
  assert.match(done.acceptance, /1\/1 verified/u);
});
