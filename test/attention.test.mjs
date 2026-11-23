import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { setTimeout as wait } from 'node:timers/promises';
import { installAttention } from '../lib/attention.mjs';
import { cardsRuntime } from '../lib/cards-context.mjs';
import { CARDS_EVENT, blankCards, foldCardsState, records } from '../lib/card-state.mjs';
import { readCardInput } from '../lib/cards.mjs';
import { readQuestionInput } from '../lib/card-questions.mjs';
import { briefDecisions, cardDecisions, commandFor, dismissLine, projectDecisions } from '../lib/decisions.mjs';
import { installMobileMirror, mirrorRequest, MIRROR_PREFIX } from '../lib/mobile-mirror.mjs';
import { createPopup, installNotices, nativeNotices, noticeBlocks, noticeFor } from '../lib/notify.mjs';

const question = readQuestionInput({ title: '选择部署方案', subtitle: '决定脚本', questions: [
  { id: 'plan', prompt: '部署到哪里？', options: [{ value: 'vps', label: 'VPS', hint: '自己维护' }, { value: 'fn', label: '云函数' }], recommended: 'vps' },
  { id: 'extra', prompt: '要哪些？', type: 'multi', options: [{ value: 'a', label: '甲' }, { value: 'b', label: '乙' }], optional: true },
  { id: 'note', prompt: '备注', type: 'text', optional: true }] }).card;
const interactive = readCardInput({ title: '推迟闹钟', blocks: [
  { type: 'rows', items: [{ label: '当前', value: '07:00' }] },
  { type: 'field', name: 'at', label: '时间', kind: 'time', value: '07:30' },
  { type: 'choice', name: 'why', label: '原因', options: [{ value: 'late', label: '太晚睡' }, { value: 'off', label: '休息日' }] }],
actions: [{ id: 'set', label: '改时间', style: 'primary', run: { command: 'set {at}' } }, { id: 'del', label: '删除', style: 'danger', reply: true }] }).card;

function posted(...cards) {
  let state = foldCardsState(blankCards(), { type: 'turn/start', data: { turn: 1 }, seq: 1 });
  cards.forEach((card, index) => { state = foldCardsState(state, { type: CARDS_EVENT, seq: 10 + index, data: records.show(state, 'c' + index, card) }); });
  return state;
}
const payloadOf = command => JSON.parse(command.line.slice(command.line.indexOf(' ') + 1));

test('a question card becomes a decision whose answer is the card command', () => {
  const [decision] = cardDecisions(posted(question), 'zh');
  assert.equal(decision.kind, 'question');
  assert.deepEqual(decision.fields.map(field => [field.id, field.type, field.optional]), [['plan', 'single', false], ['extra', 'multi', true], ['note', 'text', true]]);
  assert.match(commandFor(decision, 'answer', {}).error, /部署到哪里/u);
  assert.match(commandFor(decision, 'nope', {}).error, /button/u);
  const command = commandFor(decision, 'answer', { plan: 'fn', extra: ['a'], note: ' hi ', evil: 'x' });
  assert.ok(command.line.startsWith('/deep-ptc-card-act '));
  assert.deepEqual(payloadOf(command), { id: 'c0', rev: 1, action: 'answer', codedReceipt: true, answers: { plan: 'fn', extra: ['a'], note: ' hi ' } });
  assert.deepEqual(payloadOf(commandFor(decision, 'answer', { plan: { custom: '本机' } })).answers, { plan: { custom: '本机' } });
  assert.match(dismissLine(decision), /"action":"dismiss"/u);
});

test('a written answer never stands in for a value a card command reads', () => {
  const [decision] = cardDecisions(posted(interactive), 'zh');
  assert.deepEqual(decision.blocks.map(block => block.type), ['rows'], 'inputs are fields, not content');
  assert.equal(decision.fields.find(field => field.id === 'at').custom, false);
  assert.equal(decision.fields.find(field => field.id === 'why').custom, true);
  assert.match(commandFor(decision, 'set', { at: { custom: '$(rm -rf /)' } }).error, /options/u);
  assert.deepEqual(payloadOf(commandFor(decision, 'set', { at: '08:00', why: { custom: '开会' } })).values, { at: '08:00', why: '开会' });
});

test('brief and project decisions map every choice to its host operation', () => {
  const item = (id, extra = {}) => ({ id, section: 'goal', text: 'T' + id, status: 'open', basis: 'user', ...extra });
  const brief = { rev: 4, items: [item('G1'), item('G2')], versions: [{ round: true, anchor: 3, askedSeq: 20 }] };
  const [decision] = briefDecisions(brief, 'zh');
  const op = (button, value) => payloadOf(commandFor(decision, button, value === undefined ? {} : { decision: value }));
  assert.deepEqual(op('submit', 'yes'), { op: 'confirm', ids: ['G1'], rev: 4 });
  assert.deepEqual(op('submit', 'no'), { op: 'remove', id: 'G1', rev: 4 });
  assert.deepEqual(op('submit', { custom: '改一下' }), { op: 'rethink', id: 'G1', feedback: '改一下', rev: 4 });
  assert.deepEqual(op('rest'), { op: 'confirm-rest', rev: 4 });
  assert.deepEqual(op('submit', ':rest'), { op: 'confirm-rest', rev: 4 });
  assert.deepEqual(briefDecisions({ ...brief, revising: { item: item('G1') } }), [], 'nothing waits while the model redrafts');
  const project = { cards: [{ id: 'K1', title: '规范', items: [{ id: 'R1', text: '旧' }] }], proposals: [
    { id: 'P1', chat: 's', card: 'K1', title: '规范', preview: [{ id: 'R1', text: '新' }], anchor: 9 }, { id: 'P2', chat: 'other', title: 'x', items: [] }] };
  const rows = projectDecisions(project, 's', 'zh');
  assert.equal(rows.length, 1, 'a proposal shows only in its own conversation');
  assert.equal(rows[0].blocks[0].text, '~ 新');
  assert.deepEqual(payloadOf(commandFor(rows[0], 'submit', { decision: 'yes' })), { op: 'approve', proposal: 'P1', serverNotice: true });
  const [stale] = projectDecisions({ ...project, proposals: [{ ...project.proposals[0], stale: true, delta: {} }] }, 's', 'zh');
  assert.deepEqual(payloadOf(commandFor(stale, 'submit', { decision: ':merge' })), { op: 'rebase', proposal: 'P1', serverNotice: true });
});

test('the native question for DSH Go can always be submitted and reads back to the same answer', () => {
  const [decision] = cardDecisions(posted(question), 'zh');
  const { questions, read } = mirrorRequest(decision, 'zh');
  assert.ok(questions.every(row => row.id.startsWith(MIRROR_PREFIX)));
  assert.equal(new Set(questions.map(row => row.id)).size, 3);
  assert.equal(questions[0].options[0].description, '推荐 · 自己维护');
  assert.equal(questions[1].multiSelect, true);
  assert.ok(questions[2].options.length > 0, 'an optional text question offers a way to leave it blank');
  assert.match(questions[0].detail, /决定脚本/u);
  const result = read({ answers: [{ id: questions[0].id, selected: ['云函数'] }, { id: questions[1].id, selected: ['甲', '乙'] }, { id: questions[2].id, selected: ['留空'] }] });
  assert.deepEqual(result, { button: 'answer', values: { plan: 'fn', extra: ['a', 'b'] } });
  assert.deepEqual(read({ answers: [{ id: questions[0].id, selected: [], custom: '本机' }] }).values, { plan: { custom: '本机' } });

  const card = mirrorRequest(cardDecisions(posted(interactive), 'zh')[0], 'zh');
  assert.equal(card.questions.length, 3, 'two inputs and the action');
  assert.match(card.questions[0].detail, /当前：07:00/u);
  const pick = (action, at = '使用 07:30') => card.read({ answers: [{ id: card.questions[0].id, selected: [at] }, { id: card.questions[1].id, selected: ['不选'] }, { id: card.questions[2].id, selected: [action] }] });
  assert.deepEqual(pick('改时间'), { button: 'set', values: { at: '07:30' } });
  assert.deepEqual(pick('关闭卡片，暂不处理'), { dismiss: true });
});

// ---- Runtime ----------------------------------------------------------------------------------

function host() {
  const events = new EventEmitter();
  const state = { current: blankCards() };
  const session = { id: 's', header: { cwd: 'D:/work/demo', agentPreset: 'deep-ptc' } };
  const agent = { id: 's', session, status: 'idle', inbox: { hasPending: false } };
  const lines = [];
  const asked = [];
  let outcome = { result: { kind: 'success', text: '' } };
  const services = { agents: { get: id => id === 's' ? agent : undefined },
    commands: { execute: async (_agent, line) => { lines.push(line); return outcome; } },
    userQuestions: { ask: request => new Promise((resolve, reject) => {
      asked.push({ request, resolve, reject });
      request.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ASK_ABORTED' })));
    }) } };
  const ctx = { logger: { warn() {} }, get: name => services[name], on: (name, listener) => { events.on(name, listener); return () => events.off(name, listener); }, effect: fn => fn() };
  cardsRuntime.store = { read: () => state.current, enabled: () => true };
  let seq = 5;
  const apply = event => { const full = { ...event, seq: ++seq }; state.current = foldCardsState(state.current, full); events.emit('session/event', session, full); };
  return { ctx, agent, session, lines, asked, state, apply, fail: value => { outcome = value; },
    show: (id, card) => apply({ type: CARDS_EVENT, data: records.show(state.current, id, card) }),
    settle: id => apply({ type: CARDS_EVENT, data: records.phase(state.current.versions.findLast(row => row.id === id), 'answered', { answers: { plan: 'fn' } }) }) };
}

test('a new card opens one entry; answering it closes the entry and the native question', async () => {
  const h = host();
  const attention = installAttention(h.ctx, { language: 'zh' });
  installMobileMirror(h.ctx, attention, { language: 'zh' });
  const seen = [];
  attention.onOpen(entry => seen.push(['open', entry.key, entry.fresh, entry.place]));
  attention.onClose(entry => seen.push(['close', entry.key]));
  h.show('q', question);
  await wait(80);
  assert.deepEqual(seen, [['open', 'card:q:1', true, 'demo']]);
  assert.equal(h.asked.length, 1);
  // Answered in the chat: the phone's question is withdrawn.
  h.settle('q');
  await wait(80);
  assert.deepEqual(seen[1], ['close', 'card:q:1']);
  assert.equal(h.asked[0].request.signal.aborted, true);
  // Answered on the phone: the card command runs.
  h.show('q2', question);
  await wait(80);
  const { request, resolve } = h.asked[1];
  resolve({ answers: [{ id: request.questions[0].id, selected: ['VPS'] }] });
  await wait(20);
  assert.match(h.lines[0], /^\/deep-ptc-card-act .*"plan":"vps"/u);
});

test('a refused phone answer is asked again with the reason; declining closes the card', async () => {
  const h = host();
  const attention = installAttention(h.ctx, { language: 'zh' });
  installMobileMirror(h.ctx, attention, { language: 'zh' });
  h.show('q', question);
  await wait(80);
  h.fail({ result: { kind: 'error', text: 'Bad value / 值不对' } });
  h.asked[0].resolve({ answers: [{ id: h.asked[0].request.questions[0].id, selected: ['VPS'] }] });
  await wait(20);
  assert.equal(h.asked.length, 2);
  assert.match(h.asked[1].request.questions[0].detail, /值不对/u);
  h.fail({ result: { kind: 'success', text: '' } });
  h.asked[1].reject(Object.assign(new Error('declined'), { name: 'UserQuestionError', code: 'ASK_CANCELLED' }));
  await wait(20);
  assert.match(h.lines.at(-1), /"action":"dismiss"/u);
});

test('a lost connection never closes a card', async () => {
  const h = host();
  const attention = installAttention(h.ctx, { language: 'zh' });
  installMobileMirror(h.ctx, attention, { language: 'zh' });
  h.show('q', question);
  await wait(80);
  h.asked[0].reject(new Error('typert gateway: Remote event Agent Context was released'));
  await wait(20);
  assert.deepEqual(h.lines, []);
});

test('the notice chimes once, answers through the command and shows a refusal in place', async () => {
  const h = host();
  const attention = installAttention(h.ctx, { language: 'zh' });
  const calls = [];
  let onEvent;
  installNotices(h.ctx, attention, { native: true, language: 'zh', openDesktop: () => calls.push(['desktop']), createPopup: options => {
    onEvent = options.onEvent;
    return Object.fromEntries(['show', 'close', 'error', 'sound', 'stop'].map(name => [name, (...args) => calls.push([name, ...args])]));
  } });
  h.show('q', question);
  h.show('card', interactive);
  await wait(80);
  assert.deepEqual(calls.filter(([name]) => name === 'sound'), [['sound', 'ask']], 'two cards at once ring once');
  const shown = calls.filter(([name]) => name === 'show').map(([, notice]) => notice);
  assert.equal(shown.length, 2);
  assert.equal(shown[0].title, '选择部署方案');
  h.fail({ result: { kind: 'error', text: 'Bad / 不行' } });
  onEvent({ event: 'submit', id: shown[0].id, button: 'answer', values: { plan: 'fn', extra: [], note: '' } });
  await wait(20);
  assert.deepEqual(calls.at(-1), ['error', shown[0].id, '不行']);
  h.settle('q');
  await wait(80);
  assert.deepEqual(calls.at(-1), ['close', shown[0].id]);
  h.apply({ type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } });
  await wait(900);
  assert.deepEqual(calls.filter(([name]) => name === 'sound').at(-1), ['sound', 'done']);
  const before = calls.length;
  h.apply({ type: 'turn/end', data: { turn: 2, reason: { kind: 'aborted' } } });
  await wait(900);
  assert.equal(calls.length, before, 'a turn the user stopped ends silently');
});

test('notices run only where the host shares the screen with the user', () => {
  const argv = ['node', 'C:\\DSH\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\index.js'];
  assert.equal(nativeNotices({}, argv, 'win32', { electron: '1' }), true);
  assert.equal(nativeNotices({ DEEP_PTC_VIRTUAL_DSH: '1' }, argv, 'win32', { electron: '1' }), false);
  assert.equal(nativeNotices({}, argv, 'linux', { electron: '1' }), false);
  assert.equal(nativeNotices({}, ['node', 'dsh/cli.js'], 'win32', {}), false);
});

test('the notice process restarts on demand and gives up after repeated failures', async () => {
  const started = [];
  const events = [];
  const popup = createPopup({ onEvent: message => events.push(message), idleMs: 30, start: () => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() });
    child.written = ''; child.stdin.on('data', data => { child.written += data; });
    started.push(child);
    return child;
  } });
  popup.show({ op: 'show', id: 'a' });
  popup.close('a');
  await wait(60);
  assert.equal(started.length, 1);
  assert.deepEqual(started[0].written.trim().split('\n').map(line => JSON.parse(line).op), ['show', 'close']);
  assert.equal(started[0].stdin.writableEnded, true, 'an idle process is let go');
  for (let i = 0; i < 4; i++) { popup.show({ op: 'show', id: 'b' + i }); started.at(-1).emit('exit', 1); }
  assert.equal(started.length, 4, 'three failures end the attempts');
  assert.ok(events.some(message => message.event === 'hide'));
});

test('charts reach the notice as labelled bars', () => {
  assert.deepEqual(noticeBlocks([{ type: 'donut', items: [{ label: 'a', value: 1 }, { label: 'b', value: 3 }] }])[0].items.map(item => item.share), [0.25, 0.75]);
  const entry = { id: 'x', place: 'demo', decision: cardDecisions(posted(interactive), 'zh')[0] };
  const notice = JSON.parse(JSON.stringify(noticeFor(entry, 'zh')));
  assert.deepEqual(notice.buttons.map(button => button.id), ['set', 'del']);
  assert.equal(notice.fields[0].value, '07:30');
});
