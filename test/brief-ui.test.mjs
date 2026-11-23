import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';

function fixture({ formValue = {} } = {}) {
  let plugin;
  const slots = new Map();
  const definitions = new Map();
  const calls = [];
  const listeners = new Set();
  let snapshot = { status: 'ready', writable: true, revision: 1, value: { taskBrief: true, ...formValue } };
  const form = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    async mutate(ops) {
      const value = { ...snapshot.value };
      for (const op of ops) value[op.path[0]] = op.value;
      snapshot = { ...snapshot, revision: snapshot.revision + 1, value };
      for (const listener of listeners) listener();
      return true;
    },
  };
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: definition => { plugin = definition.factory(() => React); } } },
  });
  const ctx = { uiConversation: { events: { register(d) { definitions.set(d.kind, d); } } }, locale: { bind: () => (key, values) => values ? key + JSON.stringify(values) : key, register() {} }, effect: fn => fn(),
    configForms: { get: () => form, whileServed: (names, fn) => fn() },
    remote: {
      commands: { async execute(...args) { calls.push(args); return { ok: true, value: { result: { kind: 'success', text: 'v1' } } }; } },
      session: { async prompt() { return { ok: true }; } },
    },
    slots: { inject: (name, callback) => callback(), register: (slot, render) => {
      const key = slot.name + '#' + (slot.id ?? slot.key);
      slots.set(key, { slot, render });
      return () => slots.delete(key);
    } },
  };
  ctx.inject = (deps, callback) => callback(ctx);
  plugin.apply(ctx);
  return { slots, calls, form, definitions };
}

const item = (overrides = {}) => ({ id: 'G1', section: 'goal', text: 'Keep this behavior', basis: 'user', status: 'open', quote: 'Keep this behavior', from: 'm7', ...overrides });
const brief = (overrides = {}) => ({ v: 1, rev: 2, turn: 5, updatedTurn: 5, items: [item()], messages: [],
  versions: [{ rev: 2, turn: 5, items: [item()], messages: [] }], ...overrides });
const textOf = node => typeof node === 'string' ? node : (node.children ?? []).map(textOf).join('');
const buttons = (view, label) => view.root.findAll(node => node.type === 'button' && textOf(node).includes(label));
const shown = view => JSON.stringify(view.toJSON());

const round = (overrides = {}) => ({ round: true, anchor: 2, rev: 2, turn: 5, askedSeq: 9, items: [item()], queue: ['G1'], decided: [], messages: [], ...overrides });

test('a review round asks each item in one card at its transcript node and keeps the decisions there', async () => {
  const f = fixture();
  const entry = f.slots.get('conversation.chat.node#deep-ptc-task-brief');
  assert.ok(entry);
  const render = state => React.createElement(entry.render, { ...entry.slot.inject('deep'), node: { data: { anchor: '2' } },
    useProjection: key => key === 'deepPtcBrief' ? state : undefined });
  let view;
  await act(async () => { view = Renderer.create(render(brief({ versions: [round()] }))); });
  try {
    const options = () => view.root.findAllByProps({ role: 'radio' });
    assert.equal(options().length, 3, 'set, leave out, or write my own');
    assert.match(shown(view), /briefContentQuestion/u);
    await act(async () => options().at(-1).props.onClick());
    await act(async () => view.root.findByType('textarea').props.onChange({ target: { value: 'Include archived rows too' } }));
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(JSON.parse(f.calls.at(-1)[1].slice('/deep-ptc-brief '.length)),
      { op: 'rethink', id: 'G1', rev: 2, feedback: 'Include archived rows too' });
    // Returned: the same card waits for the redraft and shows the note.
    await act(async () => view.update(render(brief({ rev: 3, revising: { item: item() }, items: [], versions: [round({ rev: 3, items: [], queue: [], waiting: 'G1',
      decided: [{ item: item(), outcome: 'returned', feedback: 'Include archived rows too' }] })] }))));
    assert.equal(options().length, 0);
    assert.match(shown(view), /Include archived rows too/u);
    assert.match(shown(view), /briefRedrafting/u);
    // Two items left: one click confirms the rest.
    const second = item({ id: 'G2', text: 'Second', quote: undefined, basis: 'inferred' });
    await act(async () => view.update(render(brief({ rev: 4, items: [item(), second], versions: [round({ rev: 4, queue: ['G1', 'G2'] })] }))));
    await act(async () => buttons(view, 'briefConfirmRest')[0].props.onClick());
    assert.deepEqual(JSON.parse(f.calls.at(-1)[1].slice('/deep-ptc-brief '.length)), { op: 'confirm-rest', rev: 4 });
    // Settled: folded to the decisions, expandable.
    await act(async () => view.update(render(brief({ rev: 5, items: [item({ basis: 'confirmed' })], versions: [round({ rev: 5, settled: true, items: [], queue: [],
      decided: [{ item: item({ basis: 'confirmed' }), outcome: 'confirmed' }, { item: second, outcome: 'declined' }] })] }))));
    assert.equal(options().length, 0);
    assert.match(shown(view), /briefRoundSummary/u);
    assert.match(shown(view), /G2 Second/u);
  } finally { await act(async () => view.unmount()); }
});

test('a reviewed message condenses by itself: the card asks for no second approval', async () => {
  const f = fixture();
  const entry = f.slots.get('conversation.input.dock#deep-ptc-task');
  const message = { ref: 'm7', turn: 5, preview: 'Keep this behavior', covered: 1, total: 1, unfiled: [] };
  const state = extra => brief({ title: 'Keep this behavior', items: [item({ basis: 'confirmed' })], messages: [{ ...message, ...extra }] });
  const render = value => React.createElement(entry.render, { ...entry.slot.inject('deep'), useProjection: key => key === 'deepPtcBrief' ? value : undefined });
  let view;
  await act(async () => { view = Renderer.create(render(state({}))); });
  try {
    await act(async () => view.root.findByProps({ className: 'dpt-taskdock-head' }).props.onClick());
    assert.equal(buttons(view, 'briefCondense').length, 1, 'a message left uncondensed still offers the manual fallback');
    await act(async () => view.update(render(state({ pending: 'condense' }))));
    assert.equal(buttons(view, 'briefCondense').length, 0, 'a message already condensing needs no click');
    assert.match(shown(view), /briefCondensing/u);
  } finally { await act(async () => view.unmount()); }
});

test('a finished task leaves a receipt that folds to one line', async () => {
  const f = fixture();
  const entry = f.slots.get('conversation.chat.node#deep-ptc-task-brief');
  const done = { status: 'done', title: 'Keep this behavior', record: 'T4', at: '2026-11-21T10:00:00.000Z', summary: 'All checks pass',
    counts: { goal: 1, goalDone: 1, acceptance: 2, acceptanceDone: 2, constraint: 3 }, items: [item({ status: 'done' })] };
  const state = brief({ rev: 6, items: [], versions: [{ completed: done, anchor: 6, rev: 6, items: [], messages: [] }] });
  let view;
  await act(async () => { view = Renderer.create(React.createElement(entry.render, { ...entry.slot.inject('deep'), node: { data: { anchor: '6' } },
    useProjection: key => key === 'deepPtcBrief' ? state : undefined })); });
  try {
    assert.match(shown(view), /briefRecordedAs.*T4/u);
    assert.match(shown(view), /All checks pass/u);
    assert.ok(buttons(view, 'briefOpenProject').length === 1);
    await act(async () => view.root.findByProps({ className: 'dpt-cc-close' }).props.onClick());
    assert.match(shown(view), /briefReceiptStub/u);
    assert.doesNotMatch(shown(view), /All checks pass/u);
  } finally { await act(async () => view.unmount()); }
});

test('the confirmed task docks above the composer as one line that opens the working plan', async () => {
  const f = fixture();
  const entry = f.slots.get('conversation.input.dock#deep-ptc-task');
  assert.ok(entry, 'the task sits in the composer dock beside the host plan');
  assert.ok(entry.slot.order > 0 && entry.slot.order < 10, 'between the todo plan and the goal');
  const accept = item({ id: 'A1', section: 'acceptance', text: 'Tests pass', basis: 'confirmed', quote: undefined });
  const render = state => React.createElement(entry.render, { ...entry.slot.inject('deep'), useProjection: key => key === 'deepPtcBrief' ? state : undefined });
  let view;
  await act(async () => { view = Renderer.create(render(brief({ items: [item()] }))); });
  try {
    assert.equal(view.toJSON(), null, 'items under review stay in the chat card');
    await act(async () => view.update(render(brief({ title: 'Keep this behavior', items: [item({ basis: 'confirmed' }), accept] }))));
    assert.match(shown(view), /Keep this behavior/u);
    assert.match(shown(view), /briefAcceptanceProgress/u);
    assert.equal(buttons(view, 'briefComplete').length, 0, 'folded to one line');
    await act(async () => view.root.findByProps({ className: 'dpt-taskdock-head' }).props.onClick());
    assert.equal(view.root.findAllByProps({ role: 'checkbox', className: 'dpt-tb-check' }).length, 2, 'goals and acceptance items can be ticked');
    await act(async () => view.root.findAllByProps({ role: 'checkbox', className: 'dpt-tb-check' })[0].props.onClick());
    assert.deepEqual(JSON.parse(f.calls.at(-1)[1].slice('/deep-ptc-brief '.length)), { op: 'status', id: 'G1', status: 'done', rev: 2 });
    await act(async () => buttons(view, 'briefComplete')[0].props.onClick());
    assert.deepEqual(JSON.parse(f.calls.at(-1)[1].slice('/deep-ptc-brief '.length)), { op: 'complete', rev: 2 });
  } finally { await act(async () => view.unmount()); }
});

test('display and approval nodes share the chat timeline and settle at the original event sequence', () => {
  const f = fixture();
  for (const [kind, type, first, update] of [
    ['deep-ptc-task-brief', 'brief', { rev: 1, anchor: 1 }, { rev: 2, anchor: 1 }],
    ['deep-ptc-cards', 'cards', { op: 'show', rev: 3, group: 'call' }, { op: 'show', rev: 4, group: 'call' }],
    ['deep-ptc-project-proposals', 'project', { inlineNew: true, proposals: [{ id: 'P1' }] }, null],
  ]) {
    const def = f.definitions.get(kind);
    const event = { type: 'plugin:dsh-deep-ptc-mode/' + type, seq: 12, data: first };
    const start = { event, location: { kind: 'session' } };
    const { id } = def.match[event.type](event);
    if (update) assert.equal(def.match[event.type]({ ...event, seq: 21, data: update }).id, id);
    const node = def.buildViewNode({ start, matches: [start], id, key: kind + ':' + id });
    assert.equal(node.target, 'chat');
    assert.equal(node.anchorSeq, 12);
    assert.equal(node.data.anchor, id);
    assert.equal(node.visibility, 'visible');
  }
});

test('an agent relay renders a read-only assignment and the subagent composer directs users to the main chat', async () => {
  const f = fixture();
  const composer = f.slots.get('conversation.composer#undefined');
  assert.ok(composer.slot.select({ session: { subagent: { address: { mode: 'continuable' } } } }));
  assert.equal(composer.slot.select({ session: {} }), null);
  const definition = f.definitions.get('deep-ptc-assignment');
  const event = { type: 'user/message', seq: 13, data: { source: { kind: 'agent-message' }, content: [
    { type: 'text', text: 'Agent main sent a message: ' },
    { type: 'text', text: '[Deep PTC task assignment]\nVerify the importer\n- goal: Run the smoke test' },
  ] } };
  const match = definition.match[event.type](event);
  assert.equal(match.id, '13');
  assert.equal(definition.match[event.type]({ ...event, data: { ...event.data, source: { kind: 'user' } } }), null);
  const start = { event, location: { kind: 'session' } };
  const node = definition.buildViewNode({ start, matches: [start], id: match.id, key: 'assignment-13' });
  const entry = f.slots.get('conversation.chat.node#deep-ptc-assignment');
  let view;
  await act(async () => { view = Renderer.create(React.createElement(entry.render, { node })); });
  try {
    assert.match(shown(view), /Verify the importer/u);
    assert.match(shown(view), /Run the smoke test/u);
    assert.equal(view.root.findAllByType('button').length, 0);
  } finally { await act(async () => view.unmount()); }
});
