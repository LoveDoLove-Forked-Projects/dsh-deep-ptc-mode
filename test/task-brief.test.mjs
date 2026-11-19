import assert from 'node:assert/strict';
import test from 'node:test';
import { BRIEF_GUIDANCE, applyUpdate, applyUserEdit, blankBrief, coverage, promptText, stateText, stubText, substantive } from '../lib/task-brief.mjs';
import { BRIEF_COMMAND, BRIEF_EVENT, briefContextText, briefRuntime, cardAnswerText, briefToolDefinition, briefView, foldBrief, install, reminderText,
  sectionText, settleCondensing } from '../lib/brief-context.mjs';

const MESSAGE = '并且卡片展示给人类的样子，我们已经有了雏形，但是卡片展示给模型的样子，以什么形式进入上下文，则是我们这次需要额外做的，毕竟卡片本身的视觉信息并不都有价值，模型也不需要好看，而是需要效率与准确';
const withMessage = (text = MESSAGE) => ({ ...blankBrief(), turn: 3, messages: [{ ref: 'm40', seq: 40, turn: 3, text }] });

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
