import assert from 'node:assert/strict';
import test from 'node:test';
import { createApprovalJobs, isEscalation } from '../lib/approval-jobs.mjs';

// A host stand-in: the pipeline asks for approval through session events, then runs (or not).
function harness() {
  let listener;
  const ctx = { on: (name, fn) => { if (name === 'session/event') listener = fn; } };
  const pending = [];
  const loadPipeline = async () => ({
    ToolExecutionPipeline: class {},
    executeToolBatch: ({ calls }) => new Promise(resolve => pending.push({ call: calls[0], resolve })),
  });
  let clock = 1000;
  const jobs = createApprovalJobs({ loadPipeline, now: () => clock });
  const tick = ms => { clock += ms; };
  const emit = (type, data) => listener({}, { type, data, time: clock });
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { ctx, jobs, pending, emit, tick, flush };
}

const agent = { id: 'agent-1' };
const escalation = (extra = {}) => ({ name: 'bash', agent, callId: 'c1', rootCallId: 'root',
  arguments: { command: 'apt-get install -y jq', sandbox_permissions: 'danger-full-access', justification: 'install jq', ...extra } });

test('only a shell call that asks for a wider sandbox becomes an approval job', () => {
  assert.equal(isEscalation(escalation()), true);
  assert.equal(isEscalation(escalation({ justification: '  ' })), false);
  assert.equal(isEscalation({ name: 'bash', arguments: { command: 'ls' } }), false);
  assert.equal(isEscalation({ name: 'run_code', arguments: { sandbox_permissions: 'danger-full-access', justification: 'x' } }), false,
    'run_code asks before its program starts, which already does not hang mid-program');
  const { ctx, jobs } = harness();
  assert.equal(jobs.intercept(ctx, { name: 'bash', agent, arguments: { command: 'ls' } }), undefined);
});

test('an escalation returns a handle at once; approval, run and output are reported in order', async () => {
  const { ctx, jobs, pending, emit, tick, flush } = harness();
  const text = jobs.intercept(ctx, escalation());
  assert.match(text, /approval job approval-1/u);
  assert.match(text, /has not run yet/u);
  assert.match(text, /job_output\(\{ job_id: "approval-1", wait: true \}\)/u);
  await flush();
  assert.equal(pending.length, 1, 'the real call was started through the pipeline');
  const callId = pending[0].call.id;
  assert.equal(pending[0].call.name, 'bash');
  assert.equal(JSON.parse(pending[0].call.arguments).sandbox_permissions, 'danger-full-access');
  assert.equal(jobs.intercept(ctx, { ...escalation(), callId }), undefined, 'the deferred call itself passes the guard');

  emit('approval/asked', { id: 'ap-1', toolName: 'bash', callId });
  tick(42_000);
  let read = await jobs.read('agent-1', 'approval-1');
  assert.equal(read.job.status, 'running');
  assert.match(read.text, /waiting for the user's approval for 42 s; the command has not run/u);
  assert.deepEqual(Object.keys(read.job).sort(), ['detail', 'id', 'kind', 'label', 'startedAt', 'status'], 'the official job_output shape');

  emit('approval/decided', { id: 'ap-1', outcome: 'allowed-once' });
  assert.match((await jobs.read('agent-1', 'approval-1')).text, /approved; the command is running/u);
  pending[0].resolve({ results: [{ result: { value: { kind: 'foreground', exitCode: 0, stdout: { text: 'jq installed' } } } }] });
  await flush();
  read = await jobs.read('agent-1', 'approval-1');
  assert.equal(read.job.status, 'completed');
  assert.match(read.text, /approved and finished \(exit 0\)\njq installed/u);
  assert.ok(read.job.finishedAt);
  await assert.rejects(() => jobs.read('someone-else', 'approval-1'), /Unknown approval job/u);
});

test('a rejected or withdrawn approval says the command did not run', async () => {
  const { ctx, jobs, pending, emit, flush } = harness();
  jobs.intercept(ctx, escalation());
  jobs.intercept(ctx, escalation({ command: 'rm -rf build' }));
  await flush();
  emit('approval/asked', { id: 'a', callId: pending[0].call.id });
  emit('approval/asked', { id: 'b', callId: pending[1].call.id });
  emit('approval/decided', { id: 'a', outcome: 'rejected' });
  emit('approval/decided', { id: 'b', outcome: 'cancelled' });
  const first = await jobs.read('agent-1', 'approval-1');
  assert.equal(first.job.status, 'killed');
  assert.match(first.text, /the user rejected the approval; the command did not run/u);
  assert.match((await jobs.read('agent-1', 'approval-2')).text, /withdrawn; the command did not run/u);
  assert.equal(jobs.list('agent-1').length, 2);
});

test('waiting on an approval job ends when it settles, on timeout, or when the user writes', async () => {
  const { ctx, jobs, pending, emit, flush } = harness();
  jobs.intercept(ctx, escalation());
  await flush();
  emit('approval/asked', { id: 'a', callId: pending[0].call.id });
  let wake;
  const steered = new Promise(resolve => { wake = resolve; });
  const waiting = jobs.read('agent-1', 'approval-1', { wait: true, timeoutMs: 10_000, steered });
  wake();
  assert.equal((await waiting).job.status, 'running', 'a user message ends the wait; the job keeps waiting for approval');
  const timed = await jobs.read('agent-1', 'approval-1', { wait: true, timeoutMs: 5 });
  assert.equal(timed.job.status, 'running');
  const settling = jobs.read('agent-1', 'approval-1', { wait: true, timeoutMs: 10_000 });
  emit('approval/decided', { id: 'a', outcome: 'allowed-once' });
  pending[0].resolve({ results: [{ result: { value: { kind: 'foreground', exitCode: 3, stderr: { text: 'boom' } } } }] });
  const done = await settling;
  assert.equal(done.job.status, 'failed');
  assert.match(done.text, /exit 3[\s\S]*\[stderr\]\nboom/u);
});
