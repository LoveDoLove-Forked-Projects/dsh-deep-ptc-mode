import assert from 'node:assert/strict';
import test from 'node:test';
import { CARDS_EVENT, archivedReason, blankCards, cardsDigest, foldCardsState, latestOf, latestVersions, parseCardsState, records, MAX_VERSIONS } from '../lib/card-state.mjs';
import { readCardInput, ANSWERED, DISMISSED, OPEN, STOPPED } from '../lib/cards.mjs';
import { answerMessage, readAnswers, readQuestionInput, storedAnswers } from '../lib/card-questions.mjs';

const body = (title, extra = {}) => readCardInput({ title, subtitle: 's', ...extra }).card;
const fold = (state, ...events) => events.reduce(foldCardsState, state);
const turn = n => ({ type: 'turn/start', data: { turn: n } });
const rec = data => ({ type: CARDS_EVENT, data });
// Post one version through the same record path the tool uses.
const show = (state, id, card) => foldCardsState(state, rec(records.show(state, id, card)));

test('every version keeps the turn it was posted in; history reads back as it was', () => {
  let state = fold(blankCards(), turn(1));
  state = show(state, 'srv', body('Dev server', { subtitle: 'starting' }));
  state = fold(state, turn(2), turn(3));
  state = show(state, 'srv', body('Dev server', { subtitle: 'running' }));
  assert.deepEqual(state.versions.map(version => [version.rev, version.turn, version.subtitle]), [[1, 1, 'starting'], [2, 3, 'running']]);
  assert.equal(latestOf(state, 'srv').rev, 2);
  assert.equal(latestVersions(state).size, 1);
  assert.equal(state.turn, 3);
  assert.equal(foldCardsState(state, turn(2)), state, 'turns never move backwards');
});

test('only the newest version, posted in the current turn and still open, takes clicks', () => {
  let state = fold(blankCards(), turn(1));
  state = show(state, 'a', body('A'));
  const first = latestOf(state, 'a');
  assert.equal(archivedReason(state, first), undefined);
  state = show(state, 'a', body('A2'));
  assert.equal(archivedReason(state, first), 'superseded');
  const second = latestOf(state, 'a');
  state = fold(state, turn(2));
  assert.equal(archivedReason(state, second), 'earlier-turn', 'a new user turn archives earlier cards');
  state = show(state, 'b', body('B'));
  const b = latestOf(state, 'b');
  state = foldCardsState(state, rec(records.phase(b, STOPPED, { action: 'go' })));
  assert.equal(archivedReason(state, latestOf(state, 'b')), 'settled');
  assert.equal(latestOf(state, 'b').result.action, 'go');
  state = foldCardsState(state, rec(records.dismiss(latestOf(state, 'b'))));
  assert.equal(latestOf(state, 'b').phase, DISMISSED);
  assert.equal(archivedReason(state, latestOf(state, 'b')), 'dismissed');
  assert.equal(archivedReason(state, undefined), 'unknown');
});

test('the digest a program reads is complete and lossless JSON', () => {
  let state = fold(blankCards(), turn(1));
  state = show(state, 'a', body('A'));
  state = show(state, 'q', readQuestionInput({ title: 'Plan', questions: [{ prompt: 'Which?', options: ['x', 'y'] }] }).card);
  const digest = cardsDigest(state);
  assert.deepEqual(digest[0], { id: 'a', rev: 1, turn: 1, kind: 'card', title: 'A', phase: OPEN, interactive: true });
  assert.equal(digest[1].kind, 'question');
  const deepDefined = value => value !== undefined && (value === null || typeof value !== 'object' || Object.values(value).every(deepDefined));
  assert.ok(deepDefined(digest), 'no undefined anywhere, so run_code can return it');
});

test('bad records change nothing, and the version list stays bounded', () => {
  let state = fold(blankCards(), turn(1));
  const stale = records.show(state, 'a', body('A'));
  state = foldCardsState(state, rec(stale));
  assert.equal(foldCardsState(state, rec(stale)), state, 'a replayed record is ignored');
  assert.equal(foldCardsState(state, rec({ v: 2, op: 'show', id: 'b', rev: 9, body: { title: '' } })), state, 'an invalid body is ignored');
  assert.equal(foldCardsState(state, rec({ v: 3 })), state);
  assert.equal(foldCardsState(state, { type: 'assistant/message', data: {} }), state);
  for (let index = 0; index < MAX_VERSIONS + 20; index++) state = show(state, index % 2 ? 'x' : 'y', body(`v${index}`));
  assert.ok(state.versions.length <= MAX_VERSIONS);
  assert.ok(latestOf(state, 'x') && latestOf(state, 'y'), 'the newest version of every card survives trimming');
});

test('1.9.7–2.0.0 snapshot records still fold into versions', () => {
  let state = fold(blankCards(), turn(4));
  state = foldCardsState(state, rec({ v: 1, seq: 2, cards: [
    { id: 'old', revision: 1, title: 'Old', phase: 'open', lines: [{ label: 'k', value: 'v' }] },
    { id: 'done', revision: 2, title: 'Done', subtitle: 's', phase: 'stopped', result: { command: 'ok' } }] }));
  assert.deepEqual(state.versions.map(version => [version.id, version.turn, version.phase]), [['old', 4, 'open'], ['done', 4, 'stopped']]);
  assert.deepEqual(latestOf(state, 'old').blocks, [{ type: 'rows', items: [{ label: 'k', value: 'v' }] }]);
  // A later snapshot without "old" means it was closed; the same revision updates in place.
  state = foldCardsState(state, rec({ v: 1, seq: 2, cards: [{ id: 'done', revision: 2, title: 'Done', subtitle: 's', phase: 'failed' }] }));
  assert.equal(state.versions.length, 2);
  assert.equal(latestOf(state, 'old').phase, DISMISSED);
  assert.equal(latestOf(state, 'done').phase, 'failed');
});

test('question cards: defaults, recommendations and validation', () => {
  const { card } = readQuestionInput({ title: ' 选择部署方案 ', subtitle: '决定下一步', questions: [
    { id: 'plan', prompt: '用哪种方案？', options: [{ value: 'vps', label: 'VPS', hint: '推荐' }, { value: 'k8s', label: 'K8s' }], recommended: 'vps' },
    { prompt: '要哪些附加项？', type: 'multi', options: ['监控', '备份', '告警'], recommended: ['o1', 'o2'] },
    { prompt: '还有别的要求吗？', optional: true, placeholder: '例如：周五前上线' }] });
  assert.equal(card.kind, 'question');
  assert.equal(card.title, '选择部署方案');
  assert.deepEqual(card.questions.map(question => [question.id, question.type]), [['plan', 'single'], ['q2', 'multi'], ['q3', 'text']]);
  assert.equal(card.questions[0].recommended, 'vps');
  assert.deepEqual(card.questions[1].recommended, ['o1', 'o2']);
  assert.deepEqual(readQuestionInput(card).card, card, 'reading it twice changes nothing');
  const issues = value => readQuestionInput(value).issues?.join(' | ') ?? '';
  assert.match(issues({ title: 'x', questions: [] }), /1-5/u);
  assert.match(issues({ title: 'x', questions: [{ prompt: 'p', options: ['only'] }] }), /2-8/u);
  assert.match(issues({ title: 'x', questions: [{ prompt: 'p', options: ['a', 'b'], recommended: 'zzz' }] }), /recommended/u);
  assert.match(issues({ title: 'x', questions: [{ prompt: 'p', type: 'text', options: ['a', 'b'] }] }), /no options/u);
  assert.match(issues({ title: '', questions: [{ prompt: 'p' }] }), /title/u);

  assert.match(readAnswers(card, { plan: 'vps' }).error, /要哪些附加项/u, 'required questions need an answer');
  assert.match(readAnswers(card, { plan: 'gcp', q2: ['o1'] }).error, /not one of the options/u);
  assert.match(readAnswers(card, { plan: ['vps', 'k8s'], q2: ['o1'] }).error, /choose one/u);
  const { answers } = readAnswers(card, { plan: 'k8s', q2: ['o3', 'o1', 'o3'], q3: '  周五前上线  ' });
  assert.deepEqual(answers, { plan: 'k8s', q2: ['o3', 'o1'], q3: '周五前上线' });
  // Every option question keeps 「其他」, not only the review cards: the written answer is an answer.
  const written = readAnswers(card, { plan: { custom: '  自建机房  ' }, q2: ['o1'] });
  assert.deepEqual(written.answers, { plan: { custom: '自建机房' }, q2: ['o1'] });
  assert.match(answerMessage(card, written.answers), /→ 自建机房/u, 'the model reads the written answer');
  assert.deepEqual(storedAnswers(card, { plan: { custom: '自建机房' } }), { plan: { custom: '自建机房' } });
  assert.equal(answerMessage(card, answers), '【回答 · 选择部署方案】\n1. 用哪种方案？\n   → K8s\n2. 要哪些附加项？\n   → 告警、监控\n3. 还有别的要求吗？\n   → 周五前上线');

  let state = fold(blankCards(), turn(1));
  state = show(state, 'deploy', card);
  state = foldCardsState(state, rec(records.phase(latestOf(state, 'deploy'), ANSWERED, { answers, at: 1 })));
  assert.deepEqual(latestOf(state, 'deploy').result, { answers, at: 1 });
  assert.equal(archivedReason(state, latestOf(state, 'deploy')), 'settled', 'an answered question takes no second answer');
});

test('a conversation may hold any number of distinct cards; the state still parses', () => {
  let state = blankCards();
  for (let index = 0; index < 400; index++) state = show(state, `c${index}`, body(`C${index}`));
  assert.equal(latestVersions(state).size, 400, 'every card keeps its newest version');
  assert.doesNotThrow(() => parseCardsState(state));
});

test('a turn end is recorded, so the client knows when the turn tail exists', () => {
  let state = foldCardsState(blankCards(), { type: 'turn/start', data: { turn: 2 } });
  assert.equal(state.ended, undefined);
  state = foldCardsState(state, { type: 'turn/end', data: { turn: 2 } });
  assert.equal(state.ended, 2);
  state = foldCardsState(state, { type: 'turn/start', data: { turn: 3 } });
  assert.notEqual(state.ended, state.turn, 'a new turn is running again');
});

test('display cards posted back to back share a node until reply text or an interactive card comes between', async () => {
  const { cardGroup } = await import('../lib/cards-context.mjs');
  const show = (state, id, body, seq, group) => foldCardsState(state, { type: CARDS_EVENT, seq, data: { ...records.show(state, id, body), ...(group ? { group } : {}) } });
  const display = { title: 'Tests', blocks: [{ type: 'text', text: 'ok' }] };
  let state = foldCardsState(blankCards(), { type: 'turn/start', data: { turn: 1 } });
  state = show(state, 'a', display, 10, 'call-1');
  assert.equal(cardGroup(state, display, 'call-2'), 'call-1', 'the next display card joins the first');
  assert.equal(cardGroup(state, { ...display, actions: [{ id: 'x', label: 'Go', reply: true }] }, 'call-2'), 'call-2', 'an interactive card keeps its own place');
  state = foldCardsState(state, { type: 'assistant/message', seq: 12, data: { message: { content: [{ type: 'reasoning', text: 'thinking' }] } } });
  assert.equal(cardGroup(state, display, 'call-2'), 'call-1', 'reasoning is not visible text');
  state = foldCardsState(state, { type: 'assistant/message', seq: 13, data: { message: { content: [{ type: 'text', text: 'Here are the results.' }] } } });
  assert.equal(cardGroup(state, display, 'call-2'), 'call-2', 'reply text starts a new group');
  state = foldCardsState(state, { type: 'turn/start', data: { turn: 2 } });
  assert.equal(cardGroup(state, display, 'call-3'), 'call-3', 'a new turn starts a new group');
});
