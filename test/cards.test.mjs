import assert from 'node:assert/strict';
import test from 'node:test';
import { CARDS_EVENT, CARD_COMMAND, CARD_TOOL, blankCards, addCard, foldCardsState, parseCardsState, readCardInput, withCard, DISMISSED, OPEN, STOPPED } from '../lib/cards.mjs';

test('the command and tool names stay stable', () => {
  assert.equal(CARD_COMMAND, 'deep-ptc-card-act');
  assert.equal(CARD_TOOL, 'ui_card');
  assert.deepEqual(blankCards(), { v: 1, seq: 0, cards: [] });
});

test('a card keeps its title, rows, note and action, trimmed', () => {
  const parsed = readCardInput({
    action: 'show',
    title: '  每小时循环  ',
    subtitle: ' 运行中 ',
    lines: [{ label: ' 响铃 ', value: ' :15 长响 ' }],
    note: '  试试  ',
    tone: 'warn',
    stop: { label: ' 停止 ', command: '  echo hi  ', schedules: [' s1 ', ''] },
  });
  assert.deepEqual(parsed.card, {
    title: '每小时循环',
    subtitle: '运行中',
    lines: [{ label: '响铃', value: ':15 长响' }],
    note: '试试',
    tone: 'warn',
    stop: { label: '停止', command: 'echo hi', schedules: ['s1'] },
  });
});

test('a card needs visible content and a title', () => {
  assert.ok(readCardInput({ action: 'show', title: 'x' }).issues.length > 0);
  assert.ok(readCardInput({ action: 'show', title: '  ', subtitle: 'x' }).issues.length > 0);
});

test('a stop action needs a command or schedule ids', () => {
  const parsed = readCardInput({ action: 'show', title: 'x', subtitle: 'y', stop: { label: '关门' } });
  assert.equal(parsed.card, undefined);
  assert.match(parsed.issues.join(' '), /stop/u);
});

test('a new card is open and updating it keeps its id', () => {
  const first = addCard(blankCards(), { title: 'A' });
  assert.equal(first.card.phase, OPEN);
  assert.equal(first.card.id, 'card-1');
  const again = addCard(first.state, { title: 'B' }, 'card-1');
  assert.equal(again.state.cards.length, 1);
  assert.equal(again.state.cards[0].title, 'B');
  assert.equal(again.state.cards[0].phase, OPEN);
});

test('a closed card is kept and marked', () => {
  const { state, card } = addCard(blankCards(), { title: 'A' });
  const stopped = withCard(state, card.id, { phase: STOPPED, result: { schedules: ['s1'], command: 'ok' } });
  assert.equal(stopped.cards[0].phase, STOPPED);
  assert.deepEqual(stopped.cards[0].result, { schedules: ['s1'], command: 'ok' });
  assert.equal(withCard(state, card.id, { phase: DISMISSED }).cards[0].phase, DISMISSED);
});

test('state parsing rejects duplicates and keeps validated cards', () => {
  const { state } = addCard(blankCards(), { title: 'A' });
  const view = parseCardsState(state);
  assert.equal(view.cards[0].title, 'A');
  assert.equal(view.cards[0].phase, OPEN);
  assert.throws(() => parseCardsState({ v: 1, seq: 1, cards: [
    { id: 'a', title: 'A', phase: OPEN }, { id: 'a', title: 'B', phase: OPEN }] }), /Duplicate/u);
  assert.throws(() => parseCardsState({ v: 1, seq: 0, cards: [{ id: 'a', title: 'A', phase: 'weird' }] }), /Invalid/u);
});

test('folding applies only card records', () => {
  const { state } = addCard(blankCards(), { title: 'A' });
  assert.deepEqual(foldCardsState(blankCards(), { type: 'turn/start', data: {}, seq: 1 }), blankCards());
  const folded = foldCardsState(blankCards(), { type: CARDS_EVENT, data: state, seq: 2 });
  assert.equal(folded.cards[0].title, 'A');
  assert.equal(foldCardsState(blankCards(), { type: CARDS_EVENT, data: { v: 2 }, seq: 3 }).cards.length, 0);
});
