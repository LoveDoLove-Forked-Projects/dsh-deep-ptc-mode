import assert from 'node:assert/strict';
import test from 'node:test';
import { cardArgv, runCardCommand, shellLabel } from '../lib/card-runner.mjs';
import { deriveDeepPtc, environmentText, normalizeDisabledShellTools } from '../lib/model.mjs';
import { touchesExecution } from '../lib/preset-health.mjs';
import snapshot from '../lib/preset.json' with { type: 'json' };

test('a card command runs in the selected environment, not the default shell', () => {
  assert.deepEqual(cardArgv({ environment: 'wsl', distribution: 'Ubuntu' }, 'pkill -f vite', 'win32'),
    ['wsl.exe', '--distribution', 'Ubuntu', '--exec', 'bash', '-lc', 'pkill -f vite']);
  assert.deepEqual(cardArgv({ environment: 'wsl' }, 'true', 'win32'), ['wsl.exe', '--exec', 'bash', '-lc', 'true']);
  assert.deepEqual(cardArgv({ environment: 'powershell', executable: 'C:\\pwsh.exe' }, 'Stop-Process 1', 'win32'),
    ['C:\\pwsh.exe', '-NoProfile', '-NonInteractive', '-Command', 'Stop-Process 1']);
  assert.equal(cardArgv({ environment: 'powershell' }, 'x', 'win32')[0], 'powershell.exe');
  assert.deepEqual(cardArgv({ environment: 'zsh' }, 'x', 'darwin'), ['/bin/zsh', '-lc', 'x']);
  assert.deepEqual(cardArgv({ environment: 'bash', executable: '/usr/bin/bash' }, 'x', 'linux'), ['/usr/bin/bash', '-lc', 'x']);
  assert.throws(() => cardArgv({ environment: 'bash' }, 'x', 'win32'), /bash\.exe/u);
  assert.throws(() => cardArgv({ environment: 'wsl', distribution: '-x' }, 'x', 'win32'), /dash/u);
  assert.throws(() => cardArgv({ environment: 'auto' }, 'x', 'win32'), /Unknown/u);
  assert.equal(shellLabel({ environment: 'wsl', distribution: 'Ubuntu' }), 'WSL Bash (Ubuntu)');
});

test('the runner passes the argv and workdir and reports the first stderr line', async () => {
  const calls = [];
  const ok = (file, args, options, done) => { calls.push({ file, args, cwd: options.cwd }); done(null, '', ''); };
  await runCardCommand({ environment: 'wsl', workdir: 'D:\\work' }, 'ls', { platform: 'win32', run: ok });
  assert.deepEqual(calls, [{ file: 'wsl.exe', args: ['--exec', 'bash', '-lc', 'ls'], cwd: 'D:\\work' }]);
  const fail = (_file, _args, _options, done) => done(new Error('exit 1'), '', 'boom\nmore');
  await assert.rejects(() => runCardCommand({ environment: 'wsl' }, 'false', { platform: 'win32', run: fail }), /^Error: boom$/u);
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
