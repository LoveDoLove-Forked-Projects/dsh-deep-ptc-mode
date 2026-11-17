import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';

function fixture({ formValue = {}, commandText = 'v2 · stack · +R3 ~R1' } = {}) {
  let plugin;
  const slots = new Map();
  const calls = [];
  const prompts = [];
  const listeners = new Set();
  let snapshot = { status: 'ready', writable: true, revision: 1, value: { conversationCards: true, projectCards: true, ...formValue } };
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
  const ctx = { locale: { bind: () => (key, values) => values ? `${key}${JSON.stringify(values)}` : key, register() {} }, effect: fn => fn(),
    configForms: { get: () => form, whileServed: (names, fn) => fn() },
    remote: {
      commands: { async execute(...args) { calls.push(args); return { ok: true, value: { result: { kind: 'success', text: commandText } } }; } },
      session: { async prompt(request) { prompts.push(request); return { ok: true }; } },
    },
    slots: { inject: (name, callback) => callback(), register: (slot, render) => {
      const key = `${slot.name}#${slot.id ?? slot.key}`;
      slots.set(key, { slot, render });
      return () => slots.delete(key);
    } },
  };
  ctx.inject = (deps, callback) => callback(ctx);
  plugin.apply(ctx);
  return { slots, calls, prompts, form };
}

const project = () => ({ v: 1, hash: 'h', path: 'D:\\repo\\PROJECT-CARDS.md', exists: true, warnings: [],
  cards: [
    { id: 'stack', kind: 'setting', category: 'stack', title: '技术栈', rev: 1, updated: '2026-11-17T12:00:00.000Z', items: [{ id: 'R1', text: 'React 18' }, { id: 'R2', text: 'Vite' }] },
    { id: 'features', kind: 'features', title: '已实现功能', rev: 2, updated: '2026-11-17T12:00:00.000Z', items: [{ id: 'F1', text: '卡片接口' }] },
    { id: 'requirements', kind: 'requirements', title: '用户要求', rev: 1, updated: '-', items: [{ id: 'Q1', text: '版本 1.9.9', status: 'active' }, { id: 'Q2', text: '旧', status: 'superseded', by: 'Q1' }] },
  ],
  proposals: [{ id: 'P1', card: 'stack', title: '技术栈', reason: '润色', baseRev: 1, preview: [{ id: 'R1', text: 'React 18（函数组件）' }, { id: 'R3', text: 'TypeScript 严格模式' }] }],
  history: { stack: [{ rev: 0, title: '技术栈', items: [{ id: 'R1', text: 'React' }], updated: '2026-11-16T00:00:00.000Z' }] } });

async function renderView(f, state = project()) {
  // The view registers itself for a Deep PTC conversation on screen: report one through the header bridge.
  const bridge = f.slots.get('conversation.session.header.actions#deep-ptc-session');
  let header;
  await act(async () => { header = Renderer.create(React.createElement(bridge.render, { sessionId: 'deep', useProjection: () => 'deep-ptc', useSessionStatus: select => select(new Map()) })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  const entry = f.slots.get('conversation.view#deep-ptc-project');
  if (entry === undefined) return { header };
  const injected = entry.slot.inject('deep');
  let view;
  await act(async () => { view = Renderer.create(React.createElement(entry.render, { ...injected, useProjection: key => key === 'deepPtcProject' ? state : undefined })); });
  return { header, view, entry };
}
const buttons = (view, label) => view.root.findAll(node => node.type === 'button' && JSON.stringify(node.props.children ?? '').includes(label));

test('the project view joins the conversation tabs for Deep PTC and lists every card kind', async () => {
  const f = fixture();
  const { header, view, entry } = await renderView(f);
  try {
    assert.ok(entry, 'the view is registered while a Deep PTC conversation is on screen');
    assert.equal(entry.slot.order, 50);
    assert.equal(entry.slot.label(), 'projectTab');
    assert.equal(f.calls[0][1], '/deep-ptc-project {"op":"refresh"}', 'the view refreshes its mirror on open');
    const text = JSON.stringify(view.toJSON());
    for (const word of ['技术栈', '已实现功能', '用户要求', 'R1', 'F1', 'projectStatusSuperseded', 'projectProposals']) assert.ok(text.includes(word), word);
    assert.equal(buttons(view, 'projectEdit').length, 1, 'only the user\'s setting card is editable');
    const groups = view.root.findAll(node => node.type === 'section' && node.props.className === 'dpt-pv-group').map(node => node.props['aria-label']);
    assert.deepEqual(groups, ['projectProposals', 'projectCat_stack', 'projectRecords'], 'setting cards by category, then the model records');
    assert.ok(buttons(view, 'projectQuestion').length >= 3, 'model-kept entries can be questioned');
  } finally {
    await act(async () => view?.unmount());
    await act(async () => header.unmount());
  }
});

test('approve, submit, polish and question each tell the model what happened', async () => {
  const f = fixture();
  const { header, view } = await renderView(f);
  try {
    await act(async () => buttons(view, 'projectApprove')[0].props.onClick());
    assert.equal(f.calls.at(-1)[1], '/deep-ptc-project {"op":"approve","proposal":"P1"}');
    assert.match(f.prompts.at(-1).content[0].text, /^projectMsgApprove\{"id":"P1","title":"技术栈","change":"v2：\+R3 ~R1"\}$/u);

    await act(async () => buttons(view, 'projectEdit')[0].props.onClick());
    const area = view.root.findAll(node => node.type === 'textarea')[0];
    await act(async () => area.props.onChange({ target: { value: 'React 19' } }));
    const form = view.root.find(node => node.type === 'form');
    await act(async () => form.props.onSubmit({ preventDefault() {} }));
    const sent = JSON.parse(f.calls.at(-1)[1].slice('/deep-ptc-project '.length));
    assert.deepEqual(sent, { op: 'submit', card: 'stack', title: '技术栈', category: 'stack', items: [{ id: 'R1', text: 'React 19' }, { id: 'R2', text: 'Vite' }], baseRev: 1 });
    assert.match(f.prompts.at(-1).content[0].text, /^projectMsgSubmit/u);

    // Polishing never writes: it asks the model to propose a cleaner version for approval.
    await act(async () => buttons(view, 'projectEdit')[0].props.onClick());
    const calls = f.calls.length;
    const check = view.root.find(node => node.type === 'input' && node.props.type === 'checkbox');
    await act(async () => check.props.onChange({ target: { checked: true } }));
    await act(async () => view.root.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }));
    assert.equal(f.calls.length, calls, 'no command for a polish request');
    assert.match(f.prompts.at(-1).content[0].text, /^projectMsgPolish\{.*- R1 React 18\\n- R2 Vite/u);

    const question = buttons(view, 'projectQuestion')[0];
    await act(async () => question.props.onClick());
    const input = view.root.find(node => node.type === 'input' && node.props.placeholder === 'projectQuestionPlaceholder');
    await act(async () => input.props.onChange({ target: { value: '没有测试' } }));
    await act(async () => view.root.findAll(node => node.type === 'form').at(-1).props.onSubmit({ preventDefault() {} }));
    assert.match(f.prompts.at(-1).content[0].text, /^projectMsgQuestion\{"title":"已实现功能","id":"F1","text":"卡片接口","question":"没有测试"\}$/u);
  } finally {
    await act(async () => view.unmount());
    await act(async () => header.unmount());
  }
});

test('the project cards switch removes the view; the empty state offers a guided setup', async () => {
  const off = fixture({ formValue: { projectCards: false } });
  const hidden = await renderView(off);
  assert.equal(hidden.view, undefined, 'no view while project cards are off');
  await act(async () => hidden.header.unmount());

  const f = fixture();
  const { header, view } = await renderView(f, { v: 1, hash: '', path: 'D:\\repo\\PROJECT-CARDS.md', exists: false, cards: [], warnings: [], proposals: [], history: {} });
  try {
    assert.match(JSON.stringify(view.toJSON()), /projectEmptyTitle/u);
    await act(async () => buttons(view, 'projectBootstrap')[0].props.onClick());
    assert.equal(f.prompts.at(-1).content[0].text, 'projectMsgBootstrap{}');
  } finally {
    await act(async () => view.unmount());
    await act(async () => header.unmount());
  }
});

test('cards take their grid width, and the conversation cards switch hides them', async () => {
  const f = fixture();
  const tail = f.slots.get('conversation.chat.turnTail#deep-ptc-cards');
  const cards = [
    { id: 'a', title: 'A', subtitle: 's', phase: 'open', size: 'half' },
    { id: 'b', title: 'B', subtitle: 's', phase: 'open', size: 'half' },
    { id: 'c', title: 'C', subtitle: 's', phase: 'open' },
  ];
  let view;
  await act(async () => { view = Renderer.create(React.createElement(tail.render, { ...tail.slot.inject('s'),
    useProjection: key => key === 'deepPtcCards' ? { v: 1, seq: 3, cards } : undefined })); });
  assert.deepEqual(view.root.findAll(node => node.props?.className === 'dpt-cc').map(node => node.props['data-size']), ['half', 'half', undefined]);
  await act(async () => { await f.form.mutate([{ op: 'set', path: ['conversationCards'], value: false }]); });
  assert.equal(view.toJSON(), null);
  await act(async () => view.unmount());
});

test('the settings page has both card switches', async () => {
  const f = fixture();
  const page = f.slots.get('settings.section#deep-ptc');
  let view;
  await act(async () => { view = Renderer.create(React.createElement(page.render, {})); });
  try {
    const switches = view.root.findAll(node => node.props?.role === 'switch' && ['cardsSwitch', 'projectSwitch'].includes(node.props['aria-label']));
    assert.deepEqual(switches.map(node => node.props['aria-checked']), [true, true]);
    await act(async () => switches[1].props.onClick());
    assert.equal(f.form.getSnapshot().value.projectCards, false);
  } finally { await act(async () => view.unmount()); }
});
