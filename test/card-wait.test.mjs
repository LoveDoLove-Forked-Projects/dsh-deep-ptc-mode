import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { installCardWait } from '../lib/card-wait.mjs';

// A host stand-in with the two hook kinds the card wait uses: tool hooks and the inbox event.
function fakeHost() {
  const events = new EventEmitter();
  const listeners = new Map();
  return {
    listeners,
    ctx: {
      on: (name, listener) => { listeners.set(name, listener); events.on(name, listener); return () => events.off(name, listener); },
      effect: fn => fn(),
    },
    steer(agent) {
      const message = { id: 'm1', source: { kind: 'user' } };
      agent.inbox.nextStep.push(message);
      events.emit('agent/inbox/inserted', { agent, message });
    },
  };
}

function waitingAgent() {
  return { id: 'a1', session: { id: 's1' }, inbox: { nextStep: [] } };
}

const allow = () => ({ kind: 'allow' });

test('only card tools are refused while a card waits (#40)', () => {
  const host = fakeHost();
  const waits = installCardWait(host.ctx, () => () => {});
  const agent = waitingAgent();
  const exec = name => ({ agent, callId: 'n' + name, rootCallId: 'root', parent: {}, name });
  waits.add(exec('ui_card'), () => true);
  const pre = host.listeners.get('tools/pre-execute');
  assert.equal(pre(exec('bash'), allow).kind, 'allow', 'a shell call no longer fails the program');
  assert.equal(pre(exec('read'), allow).kind, 'allow', 'reads keep working while the card waits');
  assert.equal(pre(exec('ui_card'), allow).kind, 'deny', 'a second card still waits for the first');
  assert.equal(pre(exec('task_brief'), allow).kind, 'deny');
});

test('the root dispatch waits for the card and ends when it settles', async () => {
  const host = fakeHost();
  const waits = installCardWait(host.ctx, () => () => {});
  const agent = waitingAgent();
  const root = { agent, callId: 'root', signal: new AbortController().signal };
  let open = true;
  waits.add({ agent, callId: 'n', rootCallId: 'root', parent: {} }, () => open);
  const post = host.listeners.get('tools/post-execute');
  let resumed = false;
  const posted = post(root, {}, () => { resumed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumed, false, 'the step stays open while the card waits');
  open = false;
  waits.changed();
  await posted;
  assert.equal(resumed, true);
});

test('a message the user writes instead of answering ends the wait', async () => {
  const host = fakeHost();
  const waits = installCardWait(host.ctx, () => () => {});
  const agent = waitingAgent();
  const root = { agent, callId: 'root', signal: new AbortController().signal };
  waits.add({ agent, callId: 'n', rootCallId: 'root', parent: {} }, () => true);
  const post = host.listeners.get('tools/post-execute');
  let resumed = false;
  const posted = post(root, {}, () => { resumed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumed, false, 'the card is still waiting');
  host.steer(agent);
  await posted;
  assert.equal(resumed, true, 'the user message carries the decision');
});

test('a message already waiting ends the wait at once', async () => {
  const host = fakeHost();
  const waits = installCardWait(host.ctx, () => () => {});
  const agent = waitingAgent();
  agent.inbox.nextStep.push({ id: 'm0', source: { kind: 'user' } });
  const root = { agent, callId: 'root', signal: new AbortController().signal };
  waits.add({ agent, callId: 'n', rootCallId: 'root', parent: {} }, () => true);
  const post = host.listeners.get('tools/post-execute');
  let resumed = false;
  await post(root, {}, () => { resumed = true; });
  assert.equal(resumed, true);
});

test('an aborted call still ends the wait', async () => {
  const host = fakeHost();
  const waits = installCardWait(host.ctx, () => () => {});
  const agent = waitingAgent();
  const stop = new AbortController();
  const root = { agent, callId: 'root', signal: stop.signal };
  waits.add({ agent, callId: 'n', rootCallId: 'root', parent: {} }, () => true);
  const post = host.listeners.get('tools/post-execute');
  const posted = post(root, {}, () => {});
  stop.abort();
  await posted;
});
