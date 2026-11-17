// Running a card button's command in the execution environment the user selected.
//
// The command a card carries is written for the same shell the model's shell tool uses, so it
// must run there too: WSL Bash through wsl.exe, PowerShell through the chosen executable, Zsh or
// Bash through theirs. Running it through Node's default shell (cmd.exe on Windows) would silently
// ignore the environment setting, which is exactly what the setting promises not to do.

import { execFile } from 'node:child_process';
import { normalizeDistribution } from './model.mjs';

export const STOP_TIMEOUT_MS = 30_000;
const MAX_REASON = 300;

/**
 * The argv that runs one card command.
 * @param shell - `{ environment, distribution?, executable?, workdir? }`; environment is resolved
 *   (wsl, powershell, zsh or bash), never `auto`.
 * @param command - the command source, in that shell's syntax.
 * @param platform - host platform.
 * @returns `[file, ...args]`.
 */
export function cardArgv(shell, command, platform = process.platform) {
  const executable = typeof shell?.executable === 'string' ? shell.executable.trim() : '';
  switch (shell?.environment) {
    case 'wsl': {
      if (platform !== 'win32') throw new Error('WSL requires a Windows host');
      const distro = normalizeDistribution(shell.distribution ?? '');
      return ['wsl.exe', ...distro ? ['--distribution', distro] : [], '--exec', 'bash', '-lc', command];
    }
    case 'powershell':
      return [executable || 'powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command];
    case 'zsh':
      return [executable || (platform === 'darwin' ? '/bin/zsh' : 'zsh'), '-lc', command];
    case 'bash':
      if (platform === 'win32' && executable === '') throw new Error('Windows Bash needs the bash.exe path from the Deep PTC settings');
      return [executable || 'bash', '-lc', command];
    default:
      throw new Error(`Unknown execution environment ${JSON.stringify(shell?.environment)}`);
  }
}

/** A short, human-readable label for the shell a card command runs in. */
export function shellLabel(shell) {
  const names = { wsl: 'WSL Bash', powershell: 'PowerShell', zsh: 'Zsh', bash: 'Bash' };
  const name = names[shell?.environment] ?? 'shell';
  return shell?.environment === 'wsl' && shell.distribution ? `${name} (${shell.distribution})` : name;
}

/** Run one card command; resolves on exit code 0, rejects with the first stderr line otherwise. */
export function runCardCommand(shell, command, { platform = process.platform, run = execFile } = {}) {
  return new Promise((resolve, reject) => {
    let argv;
    try { argv = cardArgv(shell, command, platform); } catch (error) { reject(error); return; }
    const [file, ...args] = argv;
    const options = { timeout: STOP_TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20,
      ...typeof shell?.workdir === 'string' && shell.workdir !== '' ? { cwd: shell.workdir } : {} };
    run(file, args, options, (error, _stdout, stderr) => {
      if (error === null || error === undefined) resolve();
      else reject(new Error(String(stderr ?? '').trim().split('\n')[0].slice(0, MAX_REASON) || error.message));
    });
  });
}
