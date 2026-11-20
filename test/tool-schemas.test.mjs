import assert from 'node:assert/strict';
import test from 'node:test';
import { briefToolDefinition } from '../lib/brief-context.mjs';
import { install as installCards, questionToolDefinition } from '../lib/cards-context.mjs';
import { projectToolDefinition } from '../lib/project-context.mjs';
import { virtualToolDefinition } from '../lib/virtual-dsh.mjs';

// The PTC SDK renders a tool's parameters as TypeScript only when the schema stays inside the host's
// subset (dsh-tools assertSupportedJsonSchema); anything else becomes `unknown`, and the model has
// to guess the arguments. This mirrors that subset.
const KEYWORDS = new Set(['type', 'oneOf', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const',
  'description', 'title', 'default', 'examples', 'deprecated']);

function problems(schema, path = 'schema') {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return [`${path}: not a schema object`];
  const found = [];
  for (const key of Object.keys(schema)) if (!KEYWORDS.has(key)) found.push(`${path}.${key}: unsupported keyword`);
  if (schema.type !== undefined && typeof schema.type !== 'string') found.push(`${path}.type: use one type string (oneOf for alternatives)`);
  for (const [name, child] of Object.entries(schema.properties ?? {})) found.push(...problems(child, `${path}.properties.${name}`));
  if (schema.items !== undefined) found.push(...problems(schema.items, `${path}.items`));
  for (const [index, child] of (schema.oneOf ?? []).entries()) found.push(...problems(child, `${path}.oneOf.${index}`));
  return found;
}

test('every Deep PTC tool schema stays inside the SDK subset, so the model sees typed arguments', async () => {
  const registered = new Map();
  await installCards({ logger: { warn() {} }, effect: register => register(), sessionProjections: { register: async () => ({ stateOf() {}, dispose() {} }) },
    commands: { register() {} }, tools: { register: definition => { registered.set(definition.name, definition); return () => {}; } } }, async () => () => {});
  const tools = [registered.get('ui_card'), questionToolDefinition(), projectToolDefinition(), briefToolDefinition(), virtualToolDefinition()];
  for (const tool of tools) assert.deepEqual(problems(tool.parameters), [], tool.name);
});
