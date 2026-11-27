import assert from 'node:assert/strict';
import test from 'node:test';
import { virtualRuntime } from '../lib/virtual-dsh.mjs';
import * as quota from '../lib/sleep-virtual-quota.mjs';

test('deep sleep virtual DSH quota seeds 20 per run and accepts a larger approved total', () => {
  const calls = [];
  const prior = virtualRuntime.api;
  virtualRuntime.api = { setQuota(id, total) { calls.push([id, total]); } };
  const session = { id: 'quota-unit' };
  try {
    quota.begin(session);
    assert.deepEqual(calls.at(-1), ['quota-unit', 20]);
    quota.ensure(session);
    assert.equal(calls.length, 1, 'an existing run keeps its quota');
    quota.grant(session, '90 次');
    assert.deepEqual(calls.at(-1), ['quota-unit', 90]);
    quota.ensure(session);
    assert.equal(calls.length, 2, 'a granted total is not reset by another ask');
    quota.finish(session);
    assert.deepEqual(calls.at(-1), ['quota-unit', 0]);
    quota.ensure(session);
    assert.deepEqual(calls.at(-1), ['quota-unit', 20]);
  } finally {
    quota.finish(session);
    virtualRuntime.api = prior;
  }
  assert.equal(quota.parseUses('90 次'), 90);
  assert.equal(quota.parseUses('5'), 20);
  assert.equal(quota.parseUses('300'), 200);
  assert.equal(quota.parseUses(''), undefined);
  assert.equal(quota.requested(20), undefined);
  assert.equal(quota.requested(60), 60);
  const card = quota.quotaCard(60);
  assert.equal(card.virtualQuota, true);
  assert.equal(card.questions[0].id, 'starts');
  assert.equal(card.questions[0].optional, true);
  assert.match(card.questions[0].prompt, /60/u);
});
