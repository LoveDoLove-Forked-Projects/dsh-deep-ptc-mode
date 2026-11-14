// Regression for #18: apply() must never hold the Host boot.
//
// Earlier, apply() awaited `ctx.plugin({inject:[...]}).await()` and the agent-presets registry. When a
// service never settled on a given boot, the plugin stayed `starting` and the profile failed:
//   "Host startup exceeded 60 seconds; Still loading: deep-ptc-settings
//    (dsh-deep-ptc-mode, starting, 56 s)."
// Thanks to Freezecatmeow for the diagnosis and the first version of these tests (#19).
//
// Now apply() waits for no service: the layers start when their services exist, the preset is
// published in the background, and only a Deep PTC resolve waits for that first publication.
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, Config } from '../lib/index.mjs';

const never = () => new Promise(() => {});
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
// A minimal valid PTC composition so the official and creative presets parse.
const presetDocument = () => ({ content: '- id: ptc\n  config:\n    plugins:\n      - name: example-plugin\n        config: {}\n' });

function context({ plugin = () => ({ await: async () => {}, dispose: async () => {} }), agentPresets }) {
  const warnings = [];
  const ctx = {
    logger: { info() {}, warn: (...args) => warnings.push(args.join(' ')), error() {} },
    plugin,
    effect: () => () => {},
    on: () => () => {},
    inject() {},
    get commands() { return { register() {} }; },
    get sessionProjections() { return { register: async () => ({ stateOf: () => undefined, dispose() {} }) }; },
    agentPresets,
  };
  return { ctx, warnings };
}

test('apply() returns at once even when no host service ever becomes ready', async () => {
  const { ctx } = context({
    plugin: () => ({ await: never, dispose: async () => {} }),
    agentPresets: { register: never, readDocument: never, list: never, compositionInventory: never },
  });
  const started = Date.now();
  await apply(ctx, Config({}));
  assert.ok(Date.now() - started < 1_000, 'nothing in apply() waits for a service');
});

test('the preset is still published in the background on a healthy boot', async () => {
  const published = deferred();
  const { ctx } = context({ agentPresets: {
    register: async definition => { published.resolve(definition); return () => {}; },
    readDocument: async () => presetDocument(), list: async () => [], compositionInventory: async () => [],
  } });
  await apply(ctx, Config({}));
  const definition = await published.promise;
  assert.equal(definition.id, 'deep-ptc');
});

test('a Deep PTC resolve waits for the first publication; other presets do not', async () => {
  const registry = deferred();
  const resolved = [];
  const agentPresets = {
    async resolve(id) { resolved.push(id); return { id }; },
    register: async () => { await registry.promise; return () => {}; },
    readDocument: async () => presetDocument(), list: async () => [], compositionInventory: async () => [],
  };
  const { ctx } = context({ agentPresets });
  await apply(ctx, Config({}));
  const deep = agentPresets.resolve('deep-ptc');
  await agentPresets.resolve('ptc');
  await new Promise(done => setTimeout(done, 50));
  assert.deepEqual(resolved, ['ptc'], 'deep-ptc is held until our preset is registered');
  registry.resolve();
  assert.deepEqual(await deep, { id: 'deep-ptc' });
  assert.deepEqual(resolved, ['ptc', 'deep-ptc']);
});
