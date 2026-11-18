import assert from 'node:assert/strict';
import test from 'node:test';
import { CARD_COMMAND, CARD_TOOL, readCardInput } from '../lib/cards.mjs';
import { blankCards } from '../lib/card-state.mjs';
import { BLOCK_TYPES, MAX_BLOCKS, blockSchema, fillPlaceholders, readValues } from '../lib/card-blocks.mjs';
import { CARD_EXAMPLES_REGISTRATION, CARD_SKILL_REGISTRATION } from '../lib/card-skill.mjs';

const card = body => {
  const parsed = readCardInput(body);
  assert.equal(parsed.issues, undefined, JSON.stringify(parsed.issues));
  return parsed.card;
};

test('the command and tool names stay stable', () => {
  assert.equal(CARD_COMMAND, 'deep-ptc-card-act');
  assert.equal(CARD_TOOL, 'ui_card');
  assert.deepEqual(blankCards(), { v: 2, seq: 0, turn: 0, versions: [] });
});

test('legacy lines become a leading rows block, everything trimmed', () => {
  assert.deepEqual(card({
    action: 'show',
    title: '  每小时循环  ',
    subtitle: ' 运行中 ',
    lines: [{ label: ' 响铃 ', value: ' :15 长响 ' }],
    note: '  试试  ',
    tone: 'warn',
    stop: { label: ' 停止 ', command: '  echo hi  ', schedules: [' s1 ', ''] },
  }), {
    title: '每小时循环',
    subtitle: '运行中',
    tone: 'warn',
    blocks: [{ type: 'rows', items: [{ label: '响铃', value: ':15 长响' }] }],
    note: '试试',
    actions: [{ id: 'stop', label: '停止', style: 'primary', run: { command: 'echo hi', schedules: ['s1'] } }],
  });
});

test('every block type reads, and reading a card twice changes nothing', () => {
  const body = {
    title: '仪表盘', icon: 'chart', tone: 'success',
    blocks: [
      { type: 'stats', items: [{ label: '成功率', value: 96.4, delta: '+2%', trend: 'up', tone: 'success', hint: '近 7 天' }] },
      { type: 'line', title: '耗时', unit: 's', points: ['3', 2, 4.5], labels: ['a', 'b', 'c'] },
      { type: 'bars', unit: 'GB', items: [{ label: 'x', value: '12' }, { label: 'y', value: 0 }] },
      { type: 'donut', items: [{ label: 'a', value: 1 }, { label: 'b', value: 3 }] },
      { type: 'progress', items: [{ label: '进度', value: 3, max: 5, tone: 'warn' }] },
      { type: 'steps', items: [{ label: '一', state: 'done' }, { label: '二', state: 'active', value: '进行中' }] },
    ],
  };
  const first = card(body);
  assert.deepEqual(first.blocks[0].items[0], { label: '成功率', value: '96.4', delta: '+2%', trend: 'up', tone: 'success', hint: '近 7 天' });
  assert.deepEqual(first.blocks[1].points, [3, 2, 4.5]);
  assert.equal(first.blocks[2].items[0].value, 12);
  assert.deepEqual(card(first), first);
  const more = card({ title: 't', blocks: [
    { type: 'table', columns: ['a', 'b'], rows: [['1', '2']] },
    { type: 'tags', items: ['x', { label: 'y', tone: 'danger' }] },
    { type: 'text', text: 'hello' },
    { type: 'callout', tone: 'danger', text: 'careful' },
    { type: 'rows', items: [{ label: 'k' }] },
  ] });
  assert.deepEqual(more.blocks[1].items, [{ label: 'x' }, { label: 'y', tone: 'danger' }]);
  assert.deepEqual(card(more), more);
  assert.deepEqual([...BLOCK_TYPES].sort(), ['bars', 'callout', 'choice', 'donut', 'field', 'line', 'progress', 'rows', 'stats', 'steps', 'table', 'tags', 'text']);
});

test('bad blocks are reported with their path, never silently dropped', () => {
  const issues = body => readCardInput({ title: 't', ...body }).issues?.join(' | ') ?? '';
  assert.match(issues({ blocks: [{ type: 'pie' }] }), /blocks\.0\.type/u);
  assert.match(issues({ blocks: [{ type: 'line', points: [1] }] }), /blocks\.0\.points/u);
  assert.match(issues({ blocks: [{ type: 'line', points: [1, 2], labels: ['a'] }] }), /labels/u);
  assert.match(issues({ blocks: [{ type: 'bars', items: [{ label: 'a', value: -1 }] }] }), /blocks\.0\.items\.0/u);
  assert.match(issues({ blocks: [{ type: 'donut', items: [{ label: 'a', value: 0 }, { label: 'b', value: 0 }] }] }), /above zero/u);
  assert.match(issues({ blocks: [{ type: 'table', columns: ['a', 'b'], rows: [['1']] }] }), /2 cells/u);
  assert.match(issues({ blocks: [{ type: 'steps', items: [{ label: 'a', state: 'maybe' }] }] }), /state/u);
  assert.match(issues({ blocks: Array.from({ length: MAX_BLOCKS + 1 }, () => ({ type: 'text', text: 'x' })) }), /at most/u);
  assert.match(issues({ subtitle: 's', icon: 'rocket' }), /icon/u);
});

test('the tool schema names every block type', () => {
  const schema = blockSchema();
  assert.deepEqual(schema.properties.type.enum, BLOCK_TYPES);
  for (const type of BLOCK_TYPES) assert.match(schema.properties.type.description, new RegExp(`${type}:`, 'u'));
});

test('every built-in layout in the skill is a valid card', () => {
  assert.equal(CARD_SKILL_REGISTRATION.name, 'deep-ptc-cards');
  const examples = [...CARD_EXAMPLES_REGISTRATION.content.matchAll(/```json\n([\s\S]+?)\n```/gu)].map(match => JSON.parse(match[1]));
  assert.ok(examples.length >= 8, 'the skill ships a layout library');
  for (const example of examples) {
    assert.equal(example.action, 'show');
    card(example);
  }
  const used = new Set(examples.flatMap(example => (example.blocks ?? []).map(block => block.type)));
  assert.deepEqual([...BLOCK_TYPES].filter(type => !used.has(type)), [], 'every block type has an example');
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

test('interactive inputs and buttons: values are validated before they reach a command', () => {
  const alarm = card({ title: '闹钟', subtitle: '07:30', blocks: [
    { type: 'field', name: 'time', label: '时间', kind: 'time', value: '07:30' },
    { type: 'choice', name: 'plan', label: '方案', options: [{ value: 'vps', label: 'VPS' }, { value: 'k8s', label: 'K8s', hint: '贵' }], value: 'vps' },
    { type: 'choice', name: 'deps', options: [{ value: 'react', label: 'react' }, { value: 'vite', label: 'vite' }], multiple: true, value: ['vite'] },
  ], actions: [
    { label: '改时间', run: { command: 'alarm set {time}' }, keep: true },
    { id: 'go', label: '选这个', reply: '用 {plan} 部署', style: 'primary' },
    { label: '取消闹钟', style: 'danger', run: { schedules: ['s1'] } },
  ] });
  assert.deepEqual(alarm.actions.map(action => action.id), ['action-1', 'go', 'action-3']);
  assert.deepEqual(card(alarm), alarm, 'idempotent');
  assert.deepEqual(readValues(alarm, {}), { values: { time: '07:30', plan: 'vps', deps: 'vite' } });
  assert.deepEqual(readValues(alarm, { time: '6:5' }).error !== undefined, true);
  assert.equal(readValues(alarm, { time: '07:30; rm -rf /' }).error !== undefined, true, 'free text never passes');
  assert.equal(readValues(alarm, { plan: 'gcp' }).error !== undefined, true);
  assert.equal(readValues(alarm, { plan: ['vps', 'k8s'] }).error !== undefined, true, 'single choice takes one');
  assert.deepEqual(readValues(alarm, { deps: ['react', 'vite'] }).values.deps, 'react vite');
  assert.deepEqual(fillPlaceholders('alarm set {time}', { time: '08:00' }), { text: 'alarm set 08:00' });
  assert.deepEqual(fillPlaceholders('x {a} {b}', { a: '1' }), { missing: ['b'] });
  const issues = body => readCardInput({ title: 't', subtitle: 's', ...body }).issues?.join(' | ') ?? '';
  assert.match(issues({ actions: [{ label: 'x', run: { command: 'echo {nope}' } }] }), /\{nope\}/u);
  assert.match(issues({ actions: [{ label: 'x' }] }), /run, reply/u);
  assert.match(issues({ actions: Array.from({ length: 5 }, (_, i) => ({ label: 'b' + i, reply: true })) }), /at most 4/u);
  assert.match(issues({ blocks: [{ type: 'field', name: 'a', label: 'A', kind: 'time' }, { type: 'field', name: 'a', label: 'B', kind: 'date' }] }), /own name/u);
  assert.match(issues({ blocks: [{ type: 'choice', name: 'p', options: [{ value: 'a b', label: 'x' }, { value: 'c', label: 'y' }] }] }), /options\.0\.value/u);
  assert.match(issues({ blocks: [{ type: 'field', name: 'n', label: 'N', kind: 'number', min: 1, max: 5, value: 9 }] }), /value/u);
});
