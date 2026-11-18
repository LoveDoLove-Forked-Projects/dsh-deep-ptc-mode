import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';
import { readCardInput } from '../lib/cards.mjs';
import { CARD_EXAMPLES_REGISTRATION } from '../lib/card-skill.mjs';

function fixture({ commandResult = { ok: true }, prompt = true } = {}) {
  let plugin;
  const slots = new Map();
  const calls = [];
  const prompts = [];
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: definition => { plugin = definition.factory(() => React); } } },
  });
  const ctx = { locale: { bind: () => key => key, register() {} }, effect: fn => fn(),
    configForms: { get() {}, whileServed: () => () => {} },
    remote: {
      commands: { async execute(...args) { calls.push(args); return commandResult; } },
      ...prompt ? { session: { async prompt(request) { prompts.push(request); return { ok: true }; } } } : {},
    },
    slots: { inject: (name, callback) => callback(), register: (slot, render) => { slots.set(slot.id ?? slot.key, { slot, render }); } },
  };
  ctx.inject = (deps, callback) => callback(ctx);
  plugin.apply(ctx);
  return { cards: slots.get('deep-ptc-cards'), calls, prompts };
}

// The built-in samples, as the tool would store them.
const samples = () => [...CARD_EXAMPLES_REGISTRATION.content.matchAll(/```json\n([\s\S]+?)\n```/gu)].map(match => {
  const { card, issues } = readCardInput(JSON.parse(match[1]));
  assert.equal(issues, undefined);
  return { id: JSON.parse(match[1]).id, ...card, phase: 'open' };
});
const sample = id => samples().find(card => card.id === id);

async function render(f, cards, extra = {}) {
  const injected = f.cards.slot.inject('session-A');
  let view;
  await act(async () => { view = Renderer.create(React.createElement(f.cards.render, { ...injected,
    useProjection: key => key === 'deepPtcCards' ? { v: 1, seq: cards.length, cards } : undefined, ...extra })); });
  return view;
}
const byClass = (view, className) => view.root.findAll(node => node.props?.className === className);
const button = (view, label) => view.root.find(node => node.type === 'button' && node.props.children === label);

test('every built-in sample renders with all of its blocks', async () => {
  const f = fixture();
  const cards = samples();
  const view = await render(f, cards);
  try {
    assert.equal(byClass(view, 'dpt-cc').length, cards.length);
    const text = JSON.stringify(view.toJSON());
    for (const card of cards) assert.ok(text.includes(card.title), card.title);
    for (const className of ['dpt-cc-stats', 'dpt-cc-rows', 'dpt-cc-track', 'dpt-cc-bars', 'dpt-cc-chart', 'dpt-cc-donut',
      'dpt-cc-steps', 'dpt-cc-table', 'dpt-cc-tags', 'dpt-cc-text', 'dpt-cc-callout', 'dpt-cc-options', 'dpt-cc-input']) {
      assert.ok(byClass(view, className).length > 0, className);
    }
    // Chart values are printed, so colour never carries them alone.
    assert.match(text, /238 KB/u);
    assert.match(text, /57\.8%/u, 'donut legend prints shares');
    assert.match(text, /1,840 \/ 2,310/u, 'progress prints value / max');
  } finally { await act(async () => view.unmount()); }
});

test('cards draw once, after the latest turn only', async () => {
  const f = fixture();
  const chat = last => select => select({ timeline: { turnOrder: [1, last] } });
  const earlier = await render(f, [sample('tests')], { turn: { turn: 1 }, useChat: chat(2) });
  assert.equal(earlier.toJSON(), null);
  await act(async () => earlier.unmount());
  const latest = await render(f, [sample('tests')], { turn: { turn: 2 }, useChat: chat(2) });
  assert.notEqual(latest.toJSON(), null);
  await act(async () => latest.unmount());
});

test('the line chart shows a tooltip for the nearest point', async () => {
  const f = fixture();
  const view = await render(f, [{ id: 'l', title: 'L', phase: 'open', blocks: [{ type: 'line', unit: 's', points: [1, 5, 3], labels: ['a', 'b', 'c'] }] }]);
  try {
    const chart = byClass(view, 'dpt-cc-chart')[0];
    await act(async () => chart.props.onPointerMove({ clientX: 50, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) } }));
    assert.match(JSON.stringify(view.toJSON()), /b · 5 s/u);
  } finally { await act(async () => view.unmount()); }
});

test('a choice and a reply button send the pick to the command and then to the model', async () => {
  const f = fixture();
  const view = await render(f, [sample('deploy-plan')]);
  try {
    const options = view.root.findAll(node => node.props?.role === 'radio');
    assert.deepEqual(options.map(node => node.props['aria-checked']), [false, true, false], 'the recommended option is preselected');
    await act(async () => options[2].props.onClick());
    await act(async () => button(view, '用这个方案').props.onClick());
    assert.equal(f.calls.at(-1)[1], '/deep-ptc-card-act {"id":"deploy-plan","action":"act","key":"go","values":{"plan":"k8s"}}');
    assert.equal(f.prompts.length, 1);
    assert.equal(f.prompts[0].sessionId, 'session-A');
    assert.equal(f.prompts[0].mode, 'steer');
    assert.equal(JSON.stringify(f.prompts[0].content), JSON.stringify([{ type: 'text', text: '部署方案选 k8s，开始准备' }]));
  } finally { await act(async () => view.unmount()); }
});

test('multiple choice, fields and missing values', async () => {
  const f = fixture();
  const card = { id: 'x', title: '提醒', phase: 'open', blocks: [
    { type: 'field', name: 'time', label: '时间', kind: 'time' },
    { type: 'choice', name: 'deps', multiple: true, options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: ['a'] }],
    actions: [{ id: 'set', label: '设定', reply: true }, { id: 'up', label: '升级', run: { command: 'npm i {deps} {time}' } }] };
  const view = await render(f, [card]);
  try {
    assert.equal(button(view, '升级').props.disabled, true, 'a button waits for the values it uses');
    assert.equal(button(view, '设定').props.disabled, false);
    const input = view.root.find(node => node.type === 'input');
    await act(async () => input.props.onChange({ target: { value: '07:45' } }));
    const boxes = view.root.findAll(node => node.props?.role === 'checkbox');
    await act(async () => boxes[1].props.onClick());
    assert.equal(button(view, '升级').props.disabled, false);
    await act(async () => button(view, '设定').props.onClick());
    assert.deepEqual(JSON.parse(f.calls.at(-1)[1].slice('/deep-ptc-card-act '.length)).values, { time: '07:45', deps: ['a', 'b'] });
    assert.equal(f.prompts[0].content[0].text, '【提醒】设定（时间：07:45；deps：A、B）');
  } finally { await act(async () => view.unmount()); }
});

test('a refused command shows its reason and sends nothing to the model', async () => {
  const f = fixture({ commandResult: { ok: true, value: { result: { kind: 'error', text: '方案: not one of the options' } } } });
  const view = await render(f, [sample('deploy-plan')]);
  try {
    await act(async () => button(view, '用这个方案').props.onClick());
    assert.match(JSON.stringify(view.toJSON()), /not one of the options/u);
    assert.equal(f.prompts.length, 0);
  } finally { await act(async () => view.unmount()); }
});

test('a failed card shows its errors; legacy stop cards and unknown blocks still render', async () => {
  const f = fixture();
  const view = await render(f, [
    { id: 'a', title: 'A', phase: 'failed', subtitle: 's', actions: [{ id: 'stop', label: '停', run: { command: 'x' } }], result: { command: 'failed', errors: ['command (WSL Bash): boom'] } },
    { id: 'b', title: 'B', phase: 'open', lines: [{ label: 'k', value: 'v' }], stop: { label: '旧按钮', command: 'x' } },
    { id: 'c', title: 'C', phase: 'open', subtitle: 's', blocks: [{ type: 'future-chart' }] },
  ]);
  try {
    const text = JSON.stringify(view.toJSON());
    assert.match(text, /command \(WSL Bash\): boom/u);
    assert.match(text, /cardFailed/u);
    assert.equal(byClass(view, 'dpt-cc-rows').length, 1);
    await act(async () => button(view, '旧按钮').props.onClick());
    assert.equal(f.calls.at(-1)[1], '/deep-ptc-card-act {"id":"b","action":"act","key":"stop","values":{}}');
    assert.ok(text.includes('"C"'), 'an unknown block is skipped, not fatal');
  } finally { await act(async () => view.unmount()); }
});
