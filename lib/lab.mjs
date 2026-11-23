import z from '@deepseek-ai/schemastery';
import { fileURLToPath } from 'node:url';
import { cliCommand } from './preview.mjs';

export const name = 'deep-ptc-plugin-lab';
export const inject = ['systemPrompt'];
export const Config = z.object({});

export function apply(ctx) {
  const preview = fileURLToPath(new URL('./preview.mjs', import.meta.url));
  // The CLI of the running host version: the desktop app ships its own next to its executable.
  let cli;
  try { const found = cliCommand(undefined); cli = found.args[0] ?? found.command; } catch { cli = undefined; }
  const text = [
    'Deep creative mode is on. Inspect the relevant Cordis providers and their schemas with cordis_inspect_list and cordis_inspect_query when available.',
    'Develop in a separate checkout or staging directory. If source is linked to the active profile, copy it to a development workspace before changing it.',
    'Test in a virtual DSH: a fresh DSH with the same host version, plugins, skills and settings as the user\'s, and none of their sessions, workspaces or memory. Only one runs at a time, and every change stays inside it.',
    'Drive it yourself with the virtual_dsh tool: start (package: the plugin directory or a .tgz; a running one takes the new build in place), chat to send test messages and read back each turn, answer for a question or approval that waits there, ui to read and operate its interface, logs, add_plugin and remove_plugin, read_config and write_config, stop when done. The first start posts one approval card for the conversation; after that nothing asks again within its count. Longer work returns an operation: end the program, and the result arrives as a message by itself. Never poll, sleep or write helper scripts for it. Load deep-ptc-virtual-dsh-testing for the testing procedure.',
    'The user sees its progress in the Deep creative mode section of the side panel and it opens in their right sidebar when you start it; tell them when it is ready instead of pasting its URL.',
    `Without the tool, the same launcher runs as a managed shell job: node ${JSON.stringify(preview)} --package <absolute path to the built .tgz>${cli ? ` --cli ${JSON.stringify(cli)}` : ''} (add --no-credentials to start it signed out; host paths, and Windows node.exe with Windows paths under WSL). Its directory and copied credentials are removed when it stops, or at the next start after a hard stop.`,
    'Keep plugin installs, reloads and test runs in the virtual DSH. Apply a tested build to the active profile only when the user requests deployment. If startup fails, report the failing step.',
  ].join('\n');
  ctx.systemPrompt.section({ name: 'deep-ptc:plugin-lab', order: 10192, text });
}
