import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import React from 'react';
import Renderer, { act } from 'react-test-renderer';

function setup() {
  let plugin;
  let dictionaries;
  const entries = new Map([['settings.section', []]]);
  const localeListeners = new Set();
  let revision = 0;
  const writes = [];
  let snapshot = { status: 'ready', writable: true, revision: 4, value: { notifyVolume: 70, notifyCardSound: 'default', notifyDoneSound: 'default' } };
  const listeners = new Set();
  const form = {
    getSnapshot: () => snapshot,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    async mutate(ops, expected) {
      writes.push({ ops, expected });
      snapshot = { ...snapshot, revision: snapshot.revision + 1,
        value: { ...snapshot.value, ...Object.fromEntries(ops.map(op => [op.path[0], op.value])) } };
      for (const listener of listeners) listener();
      return true;
    },
  };
  vm.runInNewContext(readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: definition => { plugin = definition.factory(name => { assert.equal(name, 'react'); return React; }); } } },
    setTimeout, clearTimeout,
  });
  const ctx = {
    locale: { bind: () => key => dictionaries?.en?.[key] ?? key, register: (_, value) => { dictionaries = value; return () => {}; },
      getSnapshot: () => ({ revision }), subscribe(listener) { localeListeners.add(listener); return () => localeListeners.delete(listener); } },
    effect: callback => callback(),
    configForms: { get: () => form, whileServed: (_, register) => register(new Set(['deep-ptc-settings'])) },
    slots: {
      inject: (_, register) => register(),
      entries: name => entries.get(name) ?? [],
      entriesOfSlot: name => entries.get(name) ?? [],
      subscribe: () => () => {},
      register(slot, component) {
        if (entries.has(slot.name)) entries.get(slot.name).push({ slot, component });
        return () => {};
      },
    },
  };
  ctx.inject = (deps, callback) => { try { return callback({}); } catch { return undefined; } };
  plugin.apply(ctx);
  return { section: entries.get('settings.section')[0], form, writes };
}

test('the sound settings render a volume that saves and previews, and two independent sources', async () => {
  const fixture = setup();
  assert.ok(fixture.section, 'the settings page registers a section');
  let view;
  await act(async () => { view = Renderer.create(React.createElement(fixture.section.component, {})); });
  try {
    const text = JSON.stringify(view.toJSON());
    assert.match(text, /Sounds/u, 'the section is titled by the locale copy');
    const ranges = view.root.findAll(node => node.type === 'input' && node.props.type === 'range');
    assert.equal(ranges.length, 1, 'one volume slider');
    assert.equal(ranges[0].props.value, 70);
    await act(async () => ranges[0].props.onChange({ target: { value: '30' } }));
    await new Promise(resolve => setTimeout(resolve, 420));
    assert.equal(fixture.writes.length, 1, 'the volume is saved once after the drag');
    const volumeWrite = fixture.writes[0].ops[0];
    assert.equal(volumeWrite.op, 'set');
    assert.deepEqual([...volumeWrite.path], ['notifyVolume']);
    assert.equal(volumeWrite.value, 30);
    const selects = view.root.findAll(node => node.type === 'select' && node.props?.className === 'dpt-sound-select');
    assert.equal(selects.length, 2, 'card sound and task end sound are chosen separately');
    await act(async () => selects[0].props.onChange({ target: { value: 'default' } }));
    const sourceWrite = fixture.writes.at(-1).ops[0];
    assert.deepEqual([...sourceWrite.path], ['notifyCardSound']);
    assert.equal(sourceWrite.value, 'default');
    assert.match(JSON.stringify(view.toJSON()), /Upload audio/u, 'an upload control is present');
  } finally { await act(async () => view.unmount()); }
});
