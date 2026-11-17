import assert from 'node:assert/strict';
import test from 'node:test';
import { runCardCommand } from '../lib/card-runner.mjs';
import { deriveDeepPtc, environmentText, normalizeDisabledShellTools } from '../lib/model.mjs';
import { touchesExecution } from '../lib/preset-health.mjs';
import snapshot from '../lib/preset.json' with { type: 'json' };

test('card commands enter the host pipeline with the owning session and obey the outcome', async () => {
  const agent = { id: 'existing-wsl-session' };
  const signal = new AbortController().signal;
  const invocation = { agent, signal, commandId: 'button-1', command: 'pwd', description: 'Show working directory' };
  let names = ['bash'];
  const ctx = { tools: { definitions(scope) { assert.equal(scope, agent); return names.map(name => ({ name })); } } };
  let result = { value: { kind: 'foreground', exitCode: 0 } };
  class ToolExecutionPipeline { constructor(context) { assert.equal(context, ctx); } }
  const load = async () => ({
    ToolExecutionPipeline,
    executeToolBatch: async (input, pipeline) => {
      assert.ok(pipeline instanceof ToolExecutionPipeline);
      assert.equal(input.agent, agent);
      assert.equal(input.signal, signal);
      assert.equal(input.calls[0].name, 'bash');
      assert.deepEqual(JSON.parse(input.calls[0].arguments), {
        command: 'pwd', description: 'Show working directory', timeoutMs: 30_000,
      });
      return { results: [{ result }] };
    },
  });
  assert.deepEqual(await runCardCommand(ctx, invocation, load), { command: 'ok' });
  result = { isError: true, error: { message: 'Permission declined' } };
  await assert.rejects(runCardCommand(ctx, invocation, load), /Permission declined/u);
  result = { value: { kind: 'promoted', jobId: 'job-4' } };
  assert.deepEqual(await runCardCommand(ctx, invocation, load), { command: 'background', jobId: 'job-4' });
  names = ['bash', 'pwsh'];
  await assert.rejects(runCardCommand(ctx, invocation, load), /single active Harness shell tool/u);
});

test('disabledShellTools hides the Deep PTC shell tool row (#23)', () => {
  assert.deepEqual(normalizeDisabledShellTools([' PWSH ', 'powershell', 'fish', 3]), ['pwsh']);
  assert.deepEqual(normalizeDisabledShellTools(undefined), []);
  const terminal = preset => {
    let found;
    const visit = rows => rows.forEach(row => { if (row.name === 'dsh-deep-ptc-mode/terminal') found = row; if (row.group) visit(row.config); });
    visit(preset.plugins);
    return found;
  };
  const instructions = preset => preset.plugins.find(row => row.group)?.config.find(row => row.id === 'execution-instructions');
  const shown = deriveDeepPtc(snapshot, { environment: 'powershell' }, 'win32');
  assert.equal(terminal(shown.preset).disabled, undefined, 'an empty list changes nothing');
  const hidden = deriveDeepPtc(snapshot, { environment: 'powershell', disabledShellTools: ['pwsh'] }, 'win32');
  assert.equal(terminal(hidden.preset).disabled, true);
  assert.equal(hidden.report.disabledShellTool, 'pwsh');
  assert.equal(instructions(hidden.preset).config.shellToolHidden, true);
  // Another kind in the list does not touch the active shell.
  assert.equal(terminal(deriveDeepPtc(snapshot, { environment: 'powershell', disabledShellTools: ['bash'] }, 'win32').preset).disabled, undefined);
  // A disabled official row stays disabled.
  const official = structuredClone(snapshot);
  const visit = rows => rows.forEach(row => { if (row.id === 'tool-pwsh') row.disabled = true; if (row.group) visit(row.config); });
  visit(official.plugins);
  assert.equal(terminal(deriveDeepPtc(official, { environment: 'powershell' }, 'win32').preset).disabled, true);
  assert.match(environmentText('powershell', '', '', 'win32', true), /disabled by configuration/u);
  assert.doesNotMatch(environmentText('powershell', '', '', 'win32'), /disabled by configuration/u);
});

test('safe mode keeps the selected shell unless the execution rows failed', () => {
  const hasMapped = preset => JSON.stringify(preset.plugins).includes('dsh-deep-ptc-mode/executor');
  const kept = deriveDeepPtc(snapshot, { environment: 'wsl', wslDistribution: 'Ubuntu', safeMode: true, safeKeepsExecution: true, safeModeReason: 'tool-jobs (x): boom' }, 'win32');
  assert.ok(hasMapped(kept.preset), 'WSL stays selected');
  assert.equal(kept.report.environment, 'wsl');
  assert.match(kept.preset.description, /Safe mode: tool-jobs/u);
  assert.ok(!JSON.stringify(kept.preset.plugins).includes('dsh-deep-ptc-mode/guard'), 'the rest of Deep PTC stays off');
  assert.ok(!JSON.stringify(kept.preset.plugins).includes('dsh-deep-ptc-mode/jobs-tool'));
  const official = deriveDeepPtc(snapshot, { environment: 'wsl', safeMode: true }, 'win32');
  assert.ok(!hasMapped(official.preset));
  assert.equal(official.report.environment, 'official');
  assert.ok(touchesExecution('executor (dsh-deep-ptc-mode/executor): cannot load'));
  assert.ok(touchesExecution('execution (cordis:group): never started'));
  assert.ok(touchesExecution('tool-bash (dsh-deep-ptc-mode/terminal): boom'));
  assert.ok(!touchesExecution('tool-jobs (dsh-deep-ptc-mode/jobs-tool): boom'));
  assert.ok(!touchesExecution('reachability (dsh-deep-ptc-mode/guard): boom'));
});
