import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { builtinSkills, installSkillRoutes, SKILL_ROUTE_PREFIX } from '../lib/skill-routes.mjs';
import { createSkillStore } from '../lib/skill-store.mjs';

function setup({ agents = [], skills = [], store = createSkillStore({ directory: mkdtempSync(join(tmpdir(), 'dpt-skill-routes-')) }) } = {}) {
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

test('without a conversation the settings page reads the last complete cached list', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dpt-skill-routes-'));
  const store = createSkillStore({ directory });
  store.remember([
    { name: 'cached-model', description: 'Cached', source: 'user-dsh', provider: 'filesystem', modelInvocable: true },
    { name: 'cached-user-only', description: 'User only', source: 'user-dsh', provider: 'runtime', modelInvocable: false },
  ]);
  const { registered } = setup({ store });
  const listed = JSON.parse((await call(registered, 'GET', SKILL_ROUTE_PREFIX + '/list')).body);
  assert.equal(listed.origin, 'cache');
  const byName = Object.fromEntries(listed.skills.map(row => [row.name, row]));
  assert.equal(byName['cached-model'].modelInvocable, true);
  assert.equal(byName['cached-user-only'].modelInvocable, false);
  assert.ok(byName['deep-ptc-cards'], 'plugin skills are still merged in');
});

test('the live list follows the host invocation policy from invocation', async () => {
  const agent = { session: { id: 's', header: { agentPreset: 'deep-ptc', cwd: '/work' } } };
  const { registered } = setup({ agents: [agent], skills: [
    { name: 'both-ways', description: 'Both', source: 'bundled', provider: 'filesystem', invocation: { modelInvocable: true, userInvocable: true } },
    { name: 'user-gesture-only', description: 'User only', source: 'runtime', provider: 'runtime', invocation: { modelInvocable: false, userInvocable: true } },
    { name: 'no-invocation', description: 'No policy', source: 'custom', provider: '' },
  ] });
  const listed = JSON.parse((await call(registered, 'GET', SKILL_ROUTE_PREFIX + '/list')).body);
  const byName = Object.fromEntries(listed.skills.map(row => [row.name, row]));
  assert.equal(byName['both-ways'].modelInvocable, true);
  assert.equal(byName['user-gesture-only'].modelInvocable, false);
  assert.equal(byName['no-invocation'].modelInvocable, false);
  assert.equal(byName['deep-ptc-cards'].modelInvocable, true);
});

test('bad input and unknown paths answer with a status, not a crash', async () => {
  const { registered } = setup();
  const bad = await call(registered, 'POST', SKILL_ROUTE_PREFIX + '/set', { name: 'bad name', hidden: true });
  assert.equal(bad.statusCode, 400);
  const missing = await call(registered, 'GET', SKILL_ROUTE_PREFIX + '/nope');
  assert.equal(missing.statusCode, 404);
});
