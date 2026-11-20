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
  return { cards: slots.get('deep-ptc-cards'), live: slots.get('deep-ptc-live-cards'), calls, prompts };
}

// The built-in samples, as the tool would store them.
const samples = () => [...CARD_EXAMPLES_REGISTRATION.content.matchAll(/```json\n([\s\S]+?)\n```/gu)].map(match => {
  const { card, issues } = readCardInput(JSON.parse(match[1]));
  assert.equal(issues, undefined);
  return { id: JSON.parse(match[1]).id, ...card, phase: 'open' };
});
const sample = id => samples().find(card => card.id === id);

// Cards as versions posted in turn 1 (the current turn) unless a version says otherwise.
const stateOf = (cards, turn = 1) => ({ v: 2, seq: cards.length, turn,
  versions: cards.map((card, index) => ({ rev: index + 1, turn: 1, ...card })) });
async function render(f, cards, extra = {}) {
  const injected = f.cards.slot.inject('session-A');
  let view;
  await act(async () => { view = Renderer.create(React.createElement(f.cards.render, { ...injected,
    turn: { turn: 1 }, useProjection: key => key === 'deepPtcCards' ? stateOf(cards) : undefined, ...extra })); });
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

test('cards stay in the history: earlier versions render archived, the newest in the latest turn is live', async () => {
  const f = fixture();
  const card = { id: 'srv', title: '开发服务器', subtitle: '运行中', phase: 'open', actions: [{ id: 'stop', label: '停止', reply: true }] };
  const state = { v: 2, seq: 3, turn: 2, versions: [
    { ...card, rev: 1, turn: 1, subtitle: '启动中' },
    { ...card, rev: 2, turn: 2 },
    { id: 'gone', rev: 3, turn: 1, title: '旧通知', subtitle: 's', phase: 'dismissed' }] };
  const mount = async turn => {
    let view;
    await act(async () => { view = Renderer.create(React.createElement(f.cards.render, { ...f.cards.slot.inject('session-A'),
      turn: { turn }, useProjection: key => key === 'deepPtcCards' ? state : undefined })); });
    return view;
  };
  const earlier = await mount(1);
  try {
    const archived = byClass(earlier, 'dpt-cc')[0];
    assert.equal(archived.props['data-archived'], 'superseded');
    assert.match(JSON.stringify(earlier.toJSON()), /启动中/u, 'the earlier turn shows the card as it was');
    assert.equal(earlier.root.findAll(node => node.type === 'button' && node.props.children === '停止').length, 0, 'an archive has no buttons');
    const stub = byClass(earlier, 'dpt-cc-stub')[0];
    assert.match(JSON.stringify(stub.props.children), /cardClosedStub/u, 'a closed card collapses to one line');
    await act(async () => stub.props.onClick());
    assert.equal(byClass(earlier, 'dpt-cc').length, 2, 'the closed card can be read again');
  } finally { await act(async () => earlier.unmount()); }
  const latest = await mount(2);
  try {
    assert.equal(byClass(latest, 'dpt-cc')[0].props['data-archived'], undefined);
    assert.equal(button(latest, '停止').props.disabled, false);
  } finally { await act(async () => latest.unmount()); }
  const none = await mount(5);
  assert.equal(none.toJSON(), null, 'a turn without cards draws nothing');
  await act(async () => none.unmount());
});

test('a question card collects every answer and sends it as one message', async () => {
  const f = fixture();
  const question = { id: 'deploy', kind: 'question', title: '选择部署方案', subtitle: '决定下一步', phase: 'open', questions: [
    { id: 'plan', prompt: '用哪种方案？', type: 'single', options: [{ value: 'vps', label: 'VPS' }, { value: 'k8s', label: 'K8s' }], recommended: 'vps' },
    { id: 'extra', prompt: '附加项', type: 'multi', options: [{ value: 'mon', label: '监控' }, { value: 'bak', label: '备份' }] },
    { id: 'note', prompt: '补充说明', type: 'text', optional: true }] };
  const view = await render(f, [question]);
  try {
    const submit = () => view.root.find(node => node.type === 'button' && node.props.type === 'submit');
    assert.equal(submit().props.disabled, true, 'a required question is still open');
    assert.match(JSON.stringify(view.toJSON()), /questionRemaining/u);
    const boxes = view.root.findAll(node => node.props?.role === 'checkbox');
    await act(async () => boxes[1].props.onClick());
    await act(async () => view.root.find(node => node.type === 'textarea').props.onChange({ target: { value: '周五前' } }));
    assert.equal(submit().props.disabled, false);
    await act(async () => view.root.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }));
    const payload = JSON.parse(f.calls.at(-1)[1].slice('/deep-ptc-card-act '.length));
    assert.deepEqual(payload, { codedReceipt: true, id: 'deploy', action: 'answer', rev: 1, answers: { plan: 'vps', extra: ['bak'], note: '周五前' } });
    assert.equal(f.prompts[0].mode, 'steer', 'the answer reaches a working model at its next step');
    assert.equal(f.prompts[0].content[0].text, ['questionReplyHead', '1. 用哪种方案？', '   → VPS', '2. 附加项', '   → 备份', '3. 补充说明', '   → 周五前'].join('\n'));
  } finally { await act(async () => view.unmount()); }
  const answered = await render(f, [{ ...question, phase: 'answered', result: { answers: { plan: 'k8s', extra: ['mon'] } } }]);
  try {
    const text = JSON.stringify(answered.toJSON());
    assert.match(text, /questionAnswered/u);
    assert.ok(text.includes('K8s') && !text.includes('"VPS"'), 'an answered question shows only what was chosen');
    assert.equal(answered.root.findAll(node => node.type === 'button' && node.props.type === 'submit').length, 0);
  } finally { await act(async () => answered.unmount()); }
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
    assert.equal(f.calls.at(-1)[1], '/deep-ptc-card-act {"id":"deploy-plan","action":"act","rev":1,"key":"go","values":{"plan":"k8s"},"codedReceipt":true}');
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

test('a successful delivery across client versions sends no duplicate text', async () => {
  for (const text of ['Choice sent to the model. / 已把选择发给模型。', '[dpt:delivered:choice] sent']) {
    const f = fixture({ commandResult: { ok: true, value: { result: { kind: 'success', text } } } });
    const view = await render(f, [sample('deploy-plan')]);
    try {
      await act(async () => button(view, '用这个方案').props.onClick());
      assert.equal(f.calls.length, 1);
      assert.equal(f.prompts.length, 0);
    } finally { await act(async () => view.unmount()); }
  }
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

test('a failed card shows its errors; folded legacy rows and unknown blocks still render', async () => {
  const f = fixture();
  const view = await render(f, [
    { id: 'a', title: 'A', phase: 'failed', subtitle: 's', actions: [{ id: 'stop', label: '停', run: { command: 'x' } }], result: { command: 'failed', errors: ['command (WSL Bash): boom'] } },
    { id: 'b', title: 'B', phase: 'open', blocks: [{ type: 'rows', items: [{ label: 'k', value: 'v' }] }] },
    { id: 'c', title: 'C', phase: 'open', subtitle: 's', blocks: [{ type: 'future-chart' }] },
  ]);
  try {
    const text = JSON.stringify(view.toJSON());
    assert.match(text, /command \(WSL Bash\): boom/u);
    assert.match(text, /cardFailed/u);
    assert.equal(byClass(view, 'dpt-cc-rows').length, 1);
    assert.ok(text.includes('"C"'), 'an unknown block is skipped, not fatal');
  } finally { await act(async () => view.unmount()); }
});

test('the layout pairs compact cards, puts three tiny ones in a row and never leaves a lone narrow card', async () => {
  const f = fixture();
  const stat = (id, extra = {}) => ({ id, title: id, phase: 'open', blocks: [{ type: 'stats', items: [{ label: 'a', value: '1' }] }], ...extra });
  const rows = (id, n) => ({ id, title: id, phase: 'open', blocks: [{ type: 'rows', items: Array.from({ length: n }, (_, i) => ({ label: `k${i}`, value: 'v' })) }] });
  const table = { id: 'table', title: 'table', phase: 'open', blocks: [{ type: 'table', columns: ['a', 'b'], rows: [['1', '2']] }] };
  const sizes = async cards => {
    const view = await render(f, cards);
    try { return byClass(view, 'dpt-cc').map(node => node.props['data-size'] ?? 'full'); } finally { await act(async () => view.unmount()); }
  };
  assert.deepEqual(await sizes([rows('a', 3), rows('b', 4)]), ['half', 'half'], 'two compact cards share a row');
  assert.deepEqual(await sizes([stat('a'), stat('b'), stat('c')]), ['third', 'third', 'third'], 'three tiny cards share a row');
  assert.deepEqual(await sizes([rows('a', 3), table, rows('b', 3)]), ['full', 'full', 'full'], 'a narrow card with no partner takes the full width');
  assert.deepEqual(await sizes([rows('a', 3), rows('b', 3), rows('c', 3)]), ['half', 'half', 'full']);
  assert.deepEqual(await sizes([stat('a', { size: 'half' })]), ['full'], 'an explicit half alone would leave a gap');
  assert.deepEqual(await sizes([rows('a', 6), rows('b', 2)]), ['full', 'full'], 'long rows are wide content');
});

test('cards posted mid-turn show above the composer at once, until the turn ends', async () => {
  const f = fixture();
  const question = { id: 'pick', kind: 'question', title: '选目录', phase: 'open', questions: [{ id: 'folder', prompt: '哪个目录？', type: 'single',
    options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] }] };
  const display = { id: 'stats', title: '结果', phase: 'open', blocks: [{ type: 'text', text: 'ok' }] };
  const mount = async state => {
    let view;
    await act(async () => { view = Renderer.create(React.createElement(f.live.render, { ...f.live.slot.inject('session-A'),
      useProjection: key => key === 'deepPtcCards' ? state : key === 'agentPreset' ? 'deep-ptc' : undefined })); });
    return view;
  };
  const running = await mount({ ...stateOf([question, display]), ended: 0 });
  try {
    const text = JSON.stringify(running.toJSON());
    assert.match(text, /cardLiveNote/u, 'the dock says the model is waiting');
    assert.match(text, /选目录/u, 'the question shows while the turn runs');
    assert.match(text, /结果/u, 'every card of the running turn shows at once, display cards too');
  } finally { await act(async () => running.unmount()); }
  const ended = await mount({ ...stateOf([question]), ended: 1 });
  try { assert.equal(ended.toJSON(), null, 'after the turn the tail shows the cards; the dock is empty'); }
  finally { await act(async () => ended.unmount()); }
});
