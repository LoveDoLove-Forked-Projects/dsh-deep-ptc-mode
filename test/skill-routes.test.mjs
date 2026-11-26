import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtinSkills, installSkillRoutes, SKILL_ROUTE_PREFIX } from '../lib/skill-routes.mjs';
import { createSkillStore } from '../lib/skill-store.mjs';

function setup({ agents = [], skills = [] } = {}) {
  let registered;
  const ctx = {
    logger: { warn() {} },
    get(name) {
      if (name === 'webServer') return { register(options) { registered = options; return () => {}; } };
      if (name === 'agents') return { list: () => agents };
      if (name === 'skills') return { list: async () => skills };
      if (name === 'agentPresets') return { presetForSession: session => session?.header?.agentPreset };
      return undefined;
    },
  };
  const store = createSkillStore({ directory: mkdtempSync(join(tmpdir(), 'dpt-skill-routes-')) });
  installSkillRoutes(ctx, { store });
  return { registered, store };
}

function call(slot, method, path, body) {
  return new Promise((resolve, reject) => {
    const response = { statusCode: 0, headers: {}, body: '',
      writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
      end(chunk) { this.body = String(chunk ?? ''); resolve(this); },
      destroy() { reject(new Error('response destroyed')); } };
    const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    request.method = method;
    request.url = path;
    request.headers = {};
    slot.handler(request, response);
  });
}

test('the built-in fallback lists the plugin skills once each', () => {
  const rows = builtinSkills();
  const names = rows.map(row => row.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(names.includes('deep-ptc-cards'));
  assert.ok(names.includes('deep-ptc-project-cards'));
  assert.ok(names.includes('deep-ptc-dsh-operations'));
  assert.equal(rows.find(row => row.name === 'deep-ptc-cards').source, 'plugin');
});

test('the route lists the fallback, saves a switch and lists it again', async () => {
  const { registered } = setup();
  assert.equal(registered.kind, 'prefix');
  assert.equal(registered.path, SKILL_ROUTE_PREFIX);

  const first = await call(registered, 'GET', SKILL_ROUTE_PREFIX + '/list');
  assert.equal(first.statusCode, 200);
  const listed = JSON.parse(first.body);
  assert.equal(listed.origin, 'builtin');
  assert.ok(listed.skills.some(row => row.name === 'deep-ptc-cards' && row.hidden === false));

  const saved = await call(registered, 'POST', SKILL_ROUTE_PREFIX + '/set', { name: 'deep-ptc-cards', hidden: true });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(JSON.parse(saved.body).hidden, ['deep-ptc-cards']);

  const again = JSON.parse((await call(registered, 'GET', SKILL_ROUTE_PREFIX + '/list')).body);
  assert.equal(again.skills.find(row => row.name === 'deep-ptc-cards').hidden, true);
  assert.deepEqual(again.hidden, ['deep-ptc-cards']);
});

test('a live Deep PTC conversation supplies the merged list', async () => {
  const agent = { session: { id: 's', header: { agentPreset: 'deep-ptc', cwd: '/work' } } };
  const { registered } = setup({ agents: [agent], skills: [
    { name: 'dsh-doc', description: 'DSH documentation', source: 'bundled', provider: 'filesystem', modelInvocable: true },
  ] });
  const listed = JSON.parse((await call(registered, 'GET', SKILL_ROUTE_PREFIX + '/list')).body);
  assert.equal(listed.origin, 'live');
  assert.ok(listed.skills.some(row => row.name === 'dsh-doc'));
  assert.ok(listed.skills.some(row => row.name === 'deep-ptc-cards'), 'plugin skills are merged in');
});

test('bad input and unknown paths answer with a status, not a crash', async () => {
  const { registered } = setup();
  const bad = await call(registered, 'POST', SKILL_ROUTE_PREFIX + '/set', { name: 'bad name', hidden: true });
  assert.equal(bad.statusCode, 400);
  const missing = await call(registered, 'GET', SKILL_ROUTE_PREFIX + '/nope');
  assert.equal(missing.statusCode, 404);
});
