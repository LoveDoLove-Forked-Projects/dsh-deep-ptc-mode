import test from 'node:test';
import assert from 'node:assert/strict';
import { installSubagentInteraction, REPORT_TO_PARENT } from '../lib/subagent-interaction.mjs';
import { briefToolDefinition } from '../lib/brief-context.mjs';
import { clarifyReview, questionToolDefinition, install as installCards } from '../lib/cards-context.mjs';
import { projectToolDefinition } from '../lib/project-context.mjs';

const parent = { id: 'main', session: { id: 'main', header: { agentPreset: 'deep-ptc' } } };
const child = { id: 'child', session: { id: 'child', header: { agentPreset: 'deep-ptc', parentSession: parent.id } } };

test('child questions and approvals never reach the answerer and agent messages still work in both directions', async () => {
  const hooks = new Map();
  installSubagentInteraction({ on: (name, listener) => hooks.set(name, listener) });
  const pre = hooks.get('tools/pre-execute');
  const next = () => ({ kind: 'allow' });
  for (const name of ['ask_user', 'ask_user_question', 'ui_card']) {
    assert.deepEqual(pre({ name, agent: child }, next), { kind: 'deny', reason: REPORT_TO_PARENT });
    assert.deepEqual(pre({ name, agent: parent }, next), { kind: 'allow' });
  }
  for (const agent of [parent, child]) assert.equal(pre({ name: 'send_message', agent }, next).kind, 'allow');
  assert.equal(pre({ name: 'run_code', arguments: { sandbox_permissions: 'require_escalated' }, agent: child }, next).kind, 'deny');
  const approve = hooks.get('approval/request');
  assert.equal(await approve({ agent: child }, () => assert.fail('child approval reached the UI')), 'rejected');
  assert.equal(await approve({ agent: parent }, async () => 'allowed-once'), 'allowed-once');
  assert.throws(() => hooks.get('user-questions/request')({ agent: child }, () => assert.fail('child question reached the UI')), /parent/u);
  const step = hooks.get('agent/pre-step');
  const assignment = { source: { kind: 'agent-message', senderSessionId: parent.id } };
  const report = { source: { kind: 'agent-message', senderSessionId: child.id } };
  const initial = { source: { kind: 'user' } };
  const directUserInput = { source: { kind: 'user', rpcId: 'browser-request' } };
  assert.deepEqual((await step({ agent: child }, async () => ({ kind: 'enter', messages: [initial, assignment, directUserInput] }))).messages, [initial, assignment]);
  assert.deepEqual((await step({ agent: parent }, async () => ({ kind: 'enter', messages: [report, directUserInput] }))).messages, [report, directUserInput]);
});

test('card and review tools reject a worker before anything is posted or waits on the user', async () => {
  const tools = new Map();
  await installCards({
    sessionProjections: { register: async () => ({ dispose() {}, stateOf: () => assert.fail('read child card state') }) },
    commands: { register() {} }, effect: fn => fn(), tools: { register: def => tools.set(def.name, def) },
  }, async () => () => assert.fail('posted a child card'), { enabled: () => true });
  const runtime = { api: { enabled: () => true, read: () => assert.fail('read child brief') } };
  const exec = { agent: child };
  await assert.rejects(questionToolDefinition().execute({ title: 'Choose' }, exec), /parent/u);
  await assert.rejects(tools.get('ui_card').execute({ action: 'show', title: 'Results' }, exec), /parent/u);
  await assert.rejects(clarifyReview('project', {}, exec), /parent/u);
  await assert.rejects(briefToolDefinition(runtime).execute({ action: 'update' }, exec), /parent/u);
  await assert.rejects(projectToolDefinition(runtime).execute({ action: 'propose' }, exec), /parent/u);
});

test('assign passes a scoped task card to the host’s parent-authorized message channel', async () => {
  const signal = new AbortController().signal;
  const sent = [];
  const api = { enabled: () => true, ctx: { get: () => ({
    async resolveName(_agent, target) { return target === 'importer' ? child.id : target; },
    async listDescendants() { return [{ id: child.id, mode: 'continuable', depth: 1 }, { id: 'grandchild', mode: 'continuable', depth: 2 }]; },
    async sendMessage(sender, recipient, content, options) {
      assert.equal(sender, parent);
      if (recipient !== child.id) throw new Error('not a direct child');
      assert.equal(options.signal, signal);
      sent.push(content[0].text);
      return 'message-1';
    },
  }) } };
  const tool = briefToolDefinition({ api });
  const args = { action: 'assign', child: 'importer', title: 'Verify the importer',
    items: [{ section: 'goal', text: 'Run the importer smoke test' }, { section: 'constraint', text: 'Use the fixture directory' },
      { section: 'acceptance', text: 'Report the row count and exit code' }] };
  assert.deepEqual(await tool.execute(args, { agent: parent, signal }), { child: child.id, messageId: 'message-1', status: 'assigned' });
  assert.match(sent[0], /^\[Deep PTC task assignment\]\nVerify the importer\n- goal:/u);
  assert.match(sent[0], /acceptance: Report the row count and exit code/u);
  await assert.rejects(tool.execute({ ...args, child: 'grandchild' }, { agent: parent, signal }), /direct continuable/u);
  await assert.rejects(tool.execute({ ...args, items: args.items.slice(1) }, { agent: parent, signal }), /concrete goal/u);
  await assert.rejects(tool.execute(args, { agent: child, signal }), /parent/u);
});
