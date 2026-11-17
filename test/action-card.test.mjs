import assert from 'node:assert/strict';
import test from 'node:test';
import { CARD_ACTION, CARD_SKILL, CARD_SKILL_CONTENT, CARD_SKILL_REGISTRATION, cardDetails, parseCardDetails } from '../lib/action-card.mjs';

test('the kind names stay stable', () => {
  assert.equal(CARD_ACTION, 'deep-ptc-card');
  assert.equal(CARD_SKILL, 'deep-ptc-cards');
});

test('a card keeps its rows, note and stop action, trimmed', () => {
  const parsed = parseCardDetails({
    subtitle: '  每小时循环  ',
    lines: [{ label: ' 响铃 ', value: ' :15 长响 ' }, { label: '关闭', value: '回一句「停」' }],
    note: '  试试  ',
    stop: { command: '  echo hi  ', schedules: [' schedule-1 ', ''] },
  });
  assert.deepEqual(parsed.card, {
    subtitle: '每小时循环',
    lines: [{ label: '响铃', value: ':15 长响' }, { label: '关闭', value: '回一句「停」' }],
    note: '试试',
    stop: { command: 'echo hi', schedules: ['schedule-1'] },
  });
});

test('a card needs something to show', () => {
  const parsed = parseCardDetails({ tone: 'info' });
  assert.equal(parsed.card, undefined);
  assert.equal(parsed.issues[0].path.join('.'), 'details');
});

test('a stop action needs a command or schedule ids', () => {
  const parsed = parseCardDetails({ subtitle: 'x', stop: { label: '关门' } });
  assert.equal(parsed.card, undefined);
  assert.equal(parsed.issues[0].path.join('.'), 'stop');
});

test('rows are bounded and every row is labelled', () => {
  const tooMany = parseCardDetails({ lines: Array.from({ length: 13 }, (_, index) => ({ label: String(index), value: 'v' })) });
  assert.equal(tooMany.card, undefined);
  const unlabelled = parseCardDetails({ lines: [{ label: '   ', value: 'v' }] });
  assert.equal(unlabelled.card, undefined);
});

test('tone is info or warn', () => {
  assert.equal(parseCardDetails({ subtitle: 'x', tone: 'warn' }).card.tone, 'warn');
  assert.equal(parseCardDetails({ subtitle: 'x', tone: 'loud' }).card, undefined);
});

test('safeParse matches the host contract', () => {
  assert.deepEqual(cardDetails.safeParse({ subtitle: 'x' }), { success: true, data: { subtitle: 'x' } });
  const refused = cardDetails.safeParse({ tone: 'loud', subtitle: 'x' });
  assert.equal(refused.success, false);
  assert.ok(refused.error.issues.length > 0);
  assert.ok(refused.error.issues[0].message.length > 0);
});

test('the skill registration satisfies the host contract', () => {
  assert.equal(CARD_SKILL_REGISTRATION.name, CARD_SKILL);
  assert.equal(CARD_SKILL_REGISTRATION.source, 'runtime');
  assert.ok(CARD_SKILL_REGISTRATION.description.length > 0);
  assert.equal(CARD_SKILL_REGISTRATION.content, CARD_SKILL_CONTENT);
});

test('the skill names the action, its fields and the one-card rule', () => {
  assert.match(CARD_SKILL_CONTENT, /deep-ptc-card/u);
  assert.match(CARD_SKILL_CONTENT, /propose_action/u);
  assert.match(CARD_SKILL_CONTENT, /schedules/u);
  assert.match(CARD_SKILL_CONTENT, /command/u);
  assert.match(CARD_SKILL_CONTENT, /One card per turn/u);
});
