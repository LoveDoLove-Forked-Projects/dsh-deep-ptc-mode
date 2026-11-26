import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLUGIN_SKILLS } from './plugin-skills.mjs';

export const name = 'deep-ptc-bundled-skills';

const directory = new URL('./bundled-skills/', import.meta.url);
// Descriptions are for the model (English). The skill card shows a localized summary from the client
// dictionaries (skillDesc:<name>), so the user reads it in the DSH display language.


export function apply(ctx) {
  ctx.inject(['skills'], child => {
    for (const [id, description] of PLUGIN_SKILLS) {
      const file = new URL(id + '.md', directory);
      child.skills.register({ name: 'deep-ptc-' + id, description, content: readFileSync(file, 'utf8'), source: 'runtime',
        path: fileURLToPath(file), resourceBase: { kind: 'directory', path: fileURLToPath(directory) } });
    }
  });
}
