// CLI entry point. Run through the session's shell, so the host controls approval and job lifetime.
import { existsSync, mkdirSync, mkdtempSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

function cliOnPath() {
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const shim = join(dir, process.platform === 'win32' ? 'dsh.cmd' : 'dsh');
    if (!existsSync(shim)) continue;
    const bin = process.platform === 'win32' ? join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js') : realpathSync(shim);
    if (bin.endsWith('bin.js') && existsSync(bin)) return bin;
  }
  throw new Error('DSH CLI not found. Supply the installed @deepseek-ai/dsh/lib/bin.js as the second argument.');
}

function previewEnv(root, parent) {
  const env = {};
  for (const [key, value] of Object.entries(parent)) {
    if (/^(path|systemroot|windir|comspec|pathext|lang|lc_.*|term|processor_architecture|number_of_processors)$/i.test(key)) env[key] = value;
  }
  return { ...env, HOME: root, USERPROFILE: root, DSH_HOME: join(root, '.dsh'), DSH_TELEMETRY_DISABLED: '1',
    APPDATA: join(root, 'config'), LOCALAPPDATA: join(root, 'data'), XDG_CONFIG_HOME: join(root, 'config'),
    XDG_DATA_HOME: join(root, 'data'), XDG_CACHE_HOME: join(root, 'cache'), XDG_STATE_HOME: join(root, 'state'),
    TEMP: join(root, 'tmp'), TMP: join(root, 'tmp'), TMPDIR: join(root, 'tmp') };
}

async function launch() {
  const [input, cliPath, ...extra] = process.argv.slice(2);
  if (!input || extra.length || !input.endsWith('.tgz') || !statSync(input).isFile())
    throw new Error('Usage: node preview.mjs <built-plugin.tgz> [path/to/dsh/lib/bin.js]');
  const artifact = realpathSync(input);
  const cli = cliPath ? realpathSync(cliPath) : cliOnPath();
  const root = mkdtempSync(join(tmpdir(), 'deep-ptc-preview-'));
  const env = previewEnv(root, process.env);
  mkdirSync(env.TEMP);
  const cwd = join(root, 'workspace');
  mkdirSync(cwd);
  console.log('Deep PTC preview directory:', root);
  const install = spawnSync(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', artifact], {
    cwd, env, stdio: 'inherit', timeout: 180_000, windowsHide: true,
  });
  if (install.error || install.status !== 0) throw install.error ?? new Error('Preview installation failed (exit ' + install.status + ')');
  // Run the Web host in this managed job itself, so stopping the job also stops the listener.
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
  process.chdir(cwd);
  process.argv = [process.execPath, resolve(cli), 'web', '--host', '127.0.0.1', '--port', '0', '--no-open'];
  const { runCli } = await import(pathToFileURL(cli).href);
  await runCli();
}

if (import.meta.main) await launch();
