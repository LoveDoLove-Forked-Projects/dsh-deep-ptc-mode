import assert from 'node:assert/strict';
import test from 'node:test';
import { blankSleep, confirmBriefItems, foldSleep, parseSleepState, records, SLEEP_EVENT, STATE_VERSION } from '../lib/deep-sleep-state.mjs';

const fold = (state, record) => foldSleep(state, { type: SLEEP_EVENT, data: record });

test('the switch arms the mode, and the run moves through every phase', () => {
  let state = blankSleep();
  assert.equal(state.on, false);
  assert.equal(state.phase, 'off');

  state = fold(state, records.toggle(true, 1));
  assert.equal(state.on, true);
  assert.equal(state.phase, 'asking');

  state = fold(state, records.briefing({ series: 'sleep-1', at: 2,
    cards: [{ id: 'sleep-1-1', title: '目标', count: 2 }, { id: 'sleep-1-2', title: '约束', count: 1 }] }));
  assert.deepEqual(state.cards.map(card => card.id), ['sleep-1-1', 'sleep-1-2']);
  assert.equal(state.answered, 0);

  state = fold(state, records.answered('sleep-1-1', 3));
  assert.equal(state.phase, 'asking', 'the batch waits for the last card');
  assert.equal(state.answered, 1);

  state = fold(state, records.answered('sleep-1-2', 4));
  assert.equal(state.phase, 'ready');
  assert.equal(state.answered, 2);

  state = fold(state, records.confirm(5));
  assert.equal(state.phase, 'confirming');

  state = fold(state, records.revise(6));
  assert.equal(state.phase, 'asking', 'an unsatisfied user sends the model back to the batch');

  state = fold(state, records.confirm(7));
  state = fold(state, records.start({ objective: '把迁移做完', goalId: 'goal-1', at: 8 }));
  assert.equal(state.phase, 'running');
  assert.equal(state.objective, '把迁移做完');
  assert.equal(state.goalId, 'goal-1');
  assert.equal(state.runs, 1);

  state = fold(state, records.round(1, 9));
  assert.equal(state.rounds, 1);

  state = fold(state, records.reopen('用户发来新信息', 10));
  assert.equal(state.phase, 'asking', 'a message during the run reopens the briefing');

  state = fold(state, records.confirm(11));
  state = fold(state, records.start({ objective: '把迁移做完', goalId: 'goal-1', at: 12 }));
  assert.equal(state.runs, 2);

  state = fold(state, records.complete(13));
  assert.equal(state.phase, 'done');
  assert.equal(state.on, true, 'the switch stays on for the next task');

  state = fold(state, records.toggle(false, 14));
  assert.equal(state.phase, 'off');
  assert.equal(state.on, false);
  assert.equal(state.runs, 2, 'turning it off keeps the history');

  state = fold(state, records.toggle(true, 15));
  assert.equal(state.phase, 'asking');
  assert.deepEqual(state.cards, [], 'a new run starts a new batch');
  assert.equal(state.runs, 2);
});

test('a malformed or out-of-order record changes nothing', () => {
  let state = fold(blankSleep(), records.toggle(true, 1));
  state = fold(state, records.briefing({ series: 'sleep-1', at: 2, cards: [{ id: 'sleep-1-1', title: 'A', count: 1 }] }));
  const before = state;
  const ignored = [
    { v: STATE_VERSION, op: 'briefing', series: 'sleep-2', at: 3, cards: [] },
    { v: STATE_VERSION, op: 'briefing', series: 'bad series!', at: 3, cards: [{ id: 'x', title: 'x', count: 1 }] },
    { v: STATE_VERSION, op: 'answered', card: 'unknown', at: 3 },
    { v: STATE_VERSION, op: 'start', objective: '', at: 3 },
    { v: STATE_VERSION, op: 'round', round: 0, at: 3 },
    { v: 99, op: 'complete', at: 3 },
    { v: STATE_VERSION, op: 'nonsense', at: 3 },
  ];
  for (const record of ignored) assert.equal(fold(state, record), before, JSON.stringify(record));
  assert.equal(fold({ ...state, on: false }, records.start({ objective: 'x', at: 9 })).phase, before.phase, 'a run cannot start while the mode is off');
});

test('a stored state is validated before the host replays it', () => {
  const state = blankSleep();
  assert.equal(parseSleepState(state), state);
  for (const broken of [null, [], {}, { ...state, v: 9 }, { ...state, on: 'yes' }, { ...state, phase: 'nope' },
    { ...state, cards: 'x' }, { ...state, answered: -1 }, { ...state, rounds: 1.5 }]) {
    assert.throws(() => parseSleepState(broken), /Invalid deep sleep state/u);
  }
});

test('while the mode is on, a filed brief is confirmed as a whole instead of item by item', () => {
  const brief = { rev: 3, items: [
    { id: 'G1', section: 'goal', text: '整理目录', basis: 'user', status: 'open' },
    { id: 'C1', section: 'constraint', text: '不要改动原文', basis: 'inferred', status: 'open' },
    { id: 'A1', section: 'acceptance', text: '每个文件一行', basis: 'confirmed', status: 'open' },
    { id: 'G2', section: 'goal', text: '旧目标', basis: 'user', status: 'done' },
  ] };
  const confirmed = confirmBriefItems(brief);
  assert.deepEqual(confirmed.items.map(item => [item.id, item.basis, item.status]),
    [['G1', 'confirmed', 'open'], ['C1', 'confirmed', 'open'], ['A1', 'confirmed', 'open'], ['G2', 'user', 'done']]);
  assert.equal(confirmed.rev, 3);
  assert.equal(brief.items[0].basis, 'user', 'the input is not mutated');
  assert.equal(confirmBriefItems(null), null);
  assert.deepEqual(confirmBriefItems({ rev: 1 }), { rev: 1 });
});

test('turning the switch off and on again during a run continues it instead of restarting', () => {
  let state = fold(blankSleep(), records.toggle(true, 1));
  state = fold(state, records.briefing({ series: 'sleep-1', at: 2, cards: [{ id: 'sleep-1-1', title: 'A', count: 1 }] }));
  state = fold(state, records.answered('sleep-1-1', 3));
  state = fold(state, records.confirm(4));
  state = fold(state, records.start({ objective: '把迁移做完', goalId: 'g1', at: 5 }));
  state = fold(state, records.round(2, 6));
  state = fold(state, records.toggle(false, 7));
  assert.equal(state.phase, 'off');
  assert.equal(state.lastPhase, 'running');
  state = fold(state, records.toggle(true, 8));
  assert.equal(state.phase, 'running', 'the run resumes on the same objective');
  assert.equal(state.objective, '把迁移做完');
  assert.equal(state.rounds, 2);
  assert.equal(state.cards.length, 1, 'the batch is not reset while the run is going');
});

test('a briefing batch is not capped at eight cards', () => {
  const cards = Array.from({ length: 40 }, (_, index) => ({ id: `sleep-1-${index + 1}`, title: `卡 ${index + 1}`, count: 2 }));
  const state = fold(fold(blankSleep(), records.toggle(true, 1)), records.briefing({ series: 'sleep-1', cards, at: 2 }));
  assert.equal(state.cards.length, 40);
  assert.equal(state.phase, 'asking');
});
