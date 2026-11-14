// Regression: apply() must not hang when a host service is slow or never ready.
//
// Before the fix, apply() awaited `ctx.plugin({inject:[...]}).await()` and
// agentPresets reads/registration without a bound. If a service never settled on a
// given boot, apply() never resolved, the plugin stayed in the Host's `starting`
// phase, and the whole profile failed to boot:
//   "Host startup exceeded 60 seconds; Still loading: deep-ptc-settings
//    (dsh-deep-ptc-mode, starting, 56 s)."
//
// These tests stand in a ctx whose services never resolve and assert apply() still
// settles, and that with ready services apply() settles fast and publishes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { apply, Config } from '../lib/index.mjs';

// A ctx whose awaited services never settle: reproduce the failing boot.
function stalledContext() {
  const never = () => new Promise(() => {});
  const warnings = [];
  const ctx = {
    logger: { info() {}, warn: (...args) => warnings.push(args.join(' ')), error() {} },
    plugin: () => ({ await: never, dispose: async () => {} }),
    effect: () => () => {},
    on: () => () => {},
    inject() {},
    get commands() { return { register() {} }; },
    get sessionProjections() { return { register: never }; },
    get agentPresets() {
      return { register: never, readDocument: never, list: never, compositionInventory: never };
    },
  };
  return { ctx, warnings };
}

// A ctx whose services are ready: the ordinary, healthy boot.
function readyContext() {
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    plugin: () => ({ await: async () => {}, dispose: async () => {} }),
    effect: () => () => {},
    on: () => () => {},
    inject() {},
    get commands() { return { register() {} }; },
    get sessionProjections() { return { register: async () => ({ stateOf: () => undefined, dispose() {} }) }; },
    get agentPresets() {
      return {
        register: async () => () => {},
        readDocument: async () => ({ content: readyPresetDocument() }),
        list: async () => [],
        compositionInventory: async () => [],
      };
    },
  };
  return ctx;
}

// A minimal valid PTC composition so loadCurrentPreset/loadCreativePreset parse it.
function readyPresetDocument() {
  return '- id: ptc\n  config:\n    plugins:\n      - name: example-plugin\n        config: {}\n';
}

test('apply() settles when host services never become ready (bounded, does not hang the boot)', async () => {
  const { ctx, warnings } = stalledContext();
  const started = Date.now();
  // If apply() were still unbounded this would hang; the test-runner timeout catches it too.
  await apply(ctx, Config({}));
  const elapsed = Date.now() - started;
  // Worst case budget is 44 s (6+6+6+6 service/signature + 20 publication); allow headroom.
  assert.ok(elapsed < 60_000, `apply() should settle well under the Host's 60 s limit, took ${elapsed} ms`);
  assert.ok(warnings.some(line => /did not become ready/i.test(line)), 'a timeout should be reported as a warning');
}, { timeout: 90_000 });

test('apply() settles quickly when services are ready (healthy boot is unchanged)', async () => {
  const ctx = readyContext();
  const started = Date.now();
  await apply(ctx, Config({}));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5_000, `a healthy boot should settle in well under a second, took ${elapsed} ms`);
});
