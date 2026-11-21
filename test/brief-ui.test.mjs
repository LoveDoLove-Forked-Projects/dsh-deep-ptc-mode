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
const buttons = (view, label) => view.root.findAll(node => node.type === 'button' && JSON.stringify(node.props.children ?? '').includes(label));
const shown = view => JSON.stringify(view.toJSON());

test('the task brief is interactive at its original transcript node and remains there after confirmation', async () => {
  const f = fixture();
  const entry = f.slots.get('conversation.chat.node#deep-ptc-task-brief');
  assert.ok(entry);
  assert.ok(![...f.slots.keys()].some(key => key.startsWith('conversation.input.dock#deep-ptc')));
  const render = state => React.createElement(entry.render, { ...entry.slot.inject('deep'), node: { data: { anchor: '2' } },
    useProjection: key => key === 'deepPtcBrief' ? state : undefined });
  let view;
  await act(async () => { view = Renderer.create(render(brief())); });
  try {
    const options = () => view.root.findAllByProps({ role: 'radio' });
    assert.equal(options().length, 3);
    assert.match(shown(view), /briefContentQuestion/u);
    assert.match(JSON.stringify(options().at(-1).props.children.map(node => node.props.className)), /option-text/u);
    await act(async () => options().at(-1).props.onClick());
    await act(async () => view.root.findByType('textarea').props.onChange({ target: { value: 'Include archived rows too' } }));
    await act(async () => view.root.findByType('form').props.onSubmit({ preventDefault() {} }));
    assert.deepEqual(JSON.parse(f.calls.at(-1)[1].slice('/deep-ptc-brief '.length)),
      { op: 'rethink', id: 'G1', rev: 2, feedback: 'Include archived rows too' });
    await act(async () => view.update(render(brief({ rev: 3, revising: { item: item() }, items: [], versions: [
      { anchor: 2, rev: 3, turn: 5, items: [item()], messages: [], outcome: 'returned', feedback: 'Include archived rows too' }] }))));
    assert.equal(options().length, 0);
    assert.match(shown(view), /Include archived rows too/u);
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
