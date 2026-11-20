import z from '@deepseek-ai/schemastery';
import { fileURLToPath } from 'node:url';
import { resolveHost } from './host.mjs';

export const name = 'deep-ptc-plugin-lab';
export const inject = ['systemPrompt'];
export const Config = z.object({});

export function apply(ctx) {
  const preview = fileURLToPath(new URL('./preview.mjs', import.meta.url));
  const resolved = resolveHost('@deepseek-ai/dsh/lib/bin.js');
  const cli = resolved && !resolved.includes('.asar/') ? fileURLToPath(resolved) : undefined;
  const text = [
    'Deep creative mode is on. Inspect the relevant Cordis providers and their schemas with cordis_inspect_list and cordis_inspect_query when available.',
    'Develop in a separate checkout or staging directory. If source is linked to the active profile, copy it to a development workspace before changing it.',
    'Build and pack the candidate there with npm pack. Launch a separate DSH Web profile through the selected shell as a managed background job.',
    `Launcher arguments: node, ${JSON.stringify(preview)}, absolute path to the built .tgz${cli ? ', ' + JSON.stringify(cli) : ''}. These are host paths; when using WSL with a Windows host invoke Windows node.exe with Windows paths, or use a matching Linux Node and DSH CLI.`,
    'Read the job output for the loopback URL and startup errors. Exercise the changed behavior there. Stop the job when finished; repeat with a fresh archive for a server change. The printed preview directory retains diagnostics.',
    'Keep plugin installs, reloads and test runs in the preview. Apply a tested build to the active profile only when the user requests deployment. If preview startup fails, report the failing step.',
  ].join('\n');
  ctx.systemPrompt.section({ name: 'deep-ptc:plugin-lab', order: 10192, text });
}
