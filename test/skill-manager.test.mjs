import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { catalogDigest, catalogEntries, catalogMessageOf, catalogSource, catalogText, readCatalogSource } from '../lib/skill-catalog.mjs';
import { createSkillStore, normalizeSkillStore } from '../lib/skill-store.mjs';
import { installSkillManager } from '../lib/skill-manager.mjs';
import { isModelInvocable, isSkillName, renderSkillContent } from '../lib/skill-render.mjs';

const temporary = () => mkdtempSync(join(tmpdir(), 'dpt-skills-'));

function helpers() {
  let next = 0;
  return {
    createUserMessage: input => ({ id: 'm' + ++next, ...input }),
    isModelInvocable: skill => skill.modelInvocable !== false,
    isUserInvocable: skill => skill.userInvocable !== false,
    isSkillName: name => typeof name === 'string' && /^[a-z0-9][a-z0-9._-]*$/u.test(name),
    renderSkillContent: skill => '<skill_content name="' + skill.name + '">\n' + skill.content + '\n</skill_content>',
  };
}

/** A session surface like the host's: every decision message is appended and stays visible. */
function sessionLog(seed = []) {
  const events = seed.map(message => ({ type: 'user/message', data: message }));
  const surface = { nodes: events.map((_, index) => index) };
  return {
    events,
    surface,
    session: { get seq() { return events.length; }, eventAt: index => events[index], surface },
    show(message) {
      events.push({ type: 'user/message', data: message });
      surface.nodes.push(events.length - 1);
    },
  };
}

function setup({ skills = [], hidden = [], owner = true, snapshot, session, readable = true } = {}) {
  const directory = temporary();
  const store = createSkillStore({ directory });
  for (const name of hidden) store.setHidden(name, true);
  const registered = new Map();
  const handlers = new Map();
  const ctx = {
    logger: { warn() {} },
    effect(register) { const dispose = register(); return () => dispose?.(); },
    tools: {
      register(definition) { registered.set(definition.name, definition); return () => registered.delete(definition.name); },
      get(name) { return owner ? registered.get(name) : { name: 'skill', foreign: true }; },
    },
    on(name, handler) { handlers.set(name, handler); return () => {}; },
    skills: {
      async list() { return skills; },
      async get(name) { const skill = skills.find(row => row.name === name); return skill === undefined ? undefined : { ...skill }; },
      async snapshot() { return snapshot === undefined ? { skills, complete: true } : snapshot(); },
    },
    workingDirectory: { ensure: async () => '/work' },
    get(name) { return name === 'agentPresets' ? { presetForSession: () => 'deep-ptc' } : undefined; },
  };
  installSkillManager(ctx, helpers(), { store });
  const log = session ?? sessionLog();
  // An older host keeps the session object but cannot replay its log.
  const agent = { session: readable ? log.session : { id: 'session-1' } };
  const preStep = async (claimed = [], decided) => {
    for (const message of claimed) log.show(message);
    const next = async () => decided ?? { kind: 'continue', messages: claimed };
    const decision = await handlers.get('agent/pre-step')({ agent, messages: claimed, signal: undefined }, next);
    for (const message of decision?.messages ?? []) if (!claimed.includes(message)) log.show(message);
    return decision;
  };
  return { ctx, store, agent, registered, preStep, directory, log };
}

const sample = () => [
  { name: 'dsh-doc', description: 'DSH documentation', provider: 'filesystem', source: 'bundled', modelInvocable: true, userInvocable: true, content: '# doc' },
  { name: 'secret-notes', description: 'Private notes', provider: 'runtime', source: 'runtime', modelInvocable: true, userInvocable: true, content: '# secret' },
  { name: 'user-only', description: 'User gesture only', provider: 'runtime', source: 'runtime', modelInvocable: false, userInvocable: true, content: '# user' },
];

test('catalog entries drop hidden names and keep the official message frames', () => {
  const entries = catalogEntries([
    { name: 'b-skill', description: 'B <tag>' },
    { name: 'a-skill', description: 'A' },
    { name: 'hidden-skill', description: 'H' },
  ], ['hidden-skill']);
  assert.deepEqual(entries.map(entry => entry.name), ['a-skill', 'b-skill']);
  const text = catalogText(entries);
  assert.match(text, /<available_skills>/u);
  assert.match(text, /- `a-skill`: A/u);
  assert.match(text, /B &lt;tag&gt;/u);
  assert.doesNotMatch(text, /hidden-skill/u);
  assert.match(catalogText(entries, { update: true }), /replaces every earlier available-skills list/u);
  const source = catalogSource(entries);
  const read = readCatalogSource(source);
  assert.deepEqual(read.entries.map(entry => entry.name), ['a-skill', 'b-skill']);
  const message = { source, content: [] };
  assert.equal(catalogMessageOf([{ source: { kind: 'user' } }, message]).message, message);
  assert.equal(catalogDigest(entries), catalogDigest([...entries]));
});

test('the skill tool loads a visible skill and refuses a hidden or user-only one', async () => {
  const host = setup({ skills: sample(), hidden: ['secret-notes'] });
  const tool = host.registered.get('skill');
  assert.equal(tool.resident, true, 'the manager keeps the loader in the PTC SDK');
  const loaded = await tool.execute({ name: 'dsh-doc' }, { agent: host.agent, signal: undefined });
  assert.equal(loaded.name, 'dsh-doc');
  assert.equal(loaded.content, '# doc');
  await assert.rejects(tool.execute({ name: 'secret-notes' }, { agent: host.agent }), /hidden by the Deep PTC skill settings/u);
  await assert.rejects(tool.execute({ name: 'user-only' }, { agent: host.agent }), /not available for model invocation/u);
  await assert.rejects(tool.execute({ name: 'missing' }, { agent: host.agent }), /unknown or no longer available/u);
  await assert.rejects(tool.execute({ name: 'Bad Name' }, { agent: host.agent }), /invalid skill name/u);
});

test('the catalog lists visible skills, stays quiet when unchanged and publishes one update when a toggle changes', async () => {
  const host = setup({ skills: sample(), hidden: ['secret-notes'] });
  const first = await host.preStep();
  const catalog = catalogMessageOf(first.messages);
  assert.ok(catalog, 'a catalog message is published');
  assert.match(catalog.message.content[0].text, /- `dsh-doc`: DSH documentation/u);
  assert.doesNotMatch(catalog.message.content[0].text, /secret-notes|user-only/u);
  assert.equal(catalog.message.source.update, undefined);

  const second = await host.preStep();
  assert.deepEqual(second.messages, [], 'an unchanged catalog does not touch the step messages');
  assert.equal(host.log.events.filter(event => event.data?.source?.kind === 'skill-catalog').length, 1);

  host.store.setHidden('dsh-doc', true);
  const third = await host.preStep();
  const replaced = catalogMessageOf(third.messages);
  assert.match(replaced.message.content[0].text, /available skill catalog changed/u);
  assert.equal(replaced.message.source.update, true);
  assert.doesNotMatch(replaced.message.content[0].text, /dsh-doc/u);
  assert.doesNotMatch(replaced.message.content[0].text, /secret-notes/u);
});

test('one catalog per session, however many steps run', async () => {
  const host = setup({ skills: sample() });
  for (let step = 0; step < 6; step += 1) await host.preStep();
  assert.equal(host.log.events.filter(event => event.data?.source?.kind === 'skill-catalog').length, 1);
  assert.equal(host.log.surface.nodes.length, 1, 'the surface holds the single catalog message');
});

test('a resumed session reuses the catalog already in its log', async () => {
  const first = setup({ skills: sample() });
  const published = (await first.preStep()).messages[0];
  const resumed = setup({ skills: sample(), session: sessionLog([published]) });
  assert.deepEqual((await resumed.preStep()).messages, []);
});

test('a host without a readable session log falls back to process memory', async () => {
  const host = setup({ skills: sample(), readable: false });
  assert.ok(catalogMessageOf((await host.preStep()).messages), 'the first step still publishes');
  assert.deepEqual((await host.preStep()).messages, [], 'later steps remember what they published');
});

test('an empty catalog is not published until a skill exists', async () => {
  const host = setup({ skills: [] });
  assert.deepEqual((await host.preStep()).messages, []);
  assert.equal(host.log.events.length, 0);
});

test('a typed /skill-name loads that skill even when it is hidden from the model', async () => {
  const host = setup({ skills: sample(), hidden: ['secret-notes'] });
  const user = { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: 'please use /secret-notes now' }] };
  const decision = await host.preStep([user], { kind: 'continue', messages: [user] });
  const injected = decision.messages.filter(message => message.source?.kind === 'skill-invocation');
  assert.equal(injected.length, 1);
  assert.match(injected[0].content[0].text, /skill_content name="secret-notes"/u);
});

test('the manager stays quiet when another plugin owns the skill tool', async () => {
  const host = setup({ skills: sample(), owner: false });
  const decision = await host.preStep([]);
  assert.equal(catalogMessageOf(decision.messages), undefined);
});

test('a partial discovery keeps the last complete list for the settings page', async () => {
  const full = sample();
  let visible = full;
  let complete = true;
  const host = setup({ skills: full, snapshot: () => ({ skills: visible, complete }) });
  await host.preStep([]);
  assert.deepEqual(host.store.known().map(row => row.name), ['dsh-doc', 'secret-notes', 'user-only']);

  visible = [full[0]];
  complete = false;
  await host.preStep();
  assert.deepEqual(host.store.known().map(row => row.name), ['dsh-doc', 'secret-notes', 'user-only']);

  // The settings route reopens the same store after the conversation closes.
  const settings = createSkillStore({ directory: host.directory });
  assert.deepEqual(settings.known().map(row => row.name), ['dsh-doc', 'secret-notes', 'user-only']);
  assert.equal(settings.known().find(row => row.name === 'user-only').modelInvocable, false);
});

test('the store keeps hidden names and a validated known list', () => {
  const directory = temporary();
  const store = createSkillStore({ directory });
  store.setHidden('deep-ptc-cards', true);
  store.setHidden('dsh-doc', true);
  store.setHidden('dsh-doc', false);
  assert.deepEqual(store.hidden(), ['deep-ptc-cards']);
  store.remember([
    { name: 'a-skill', description: 'A', source: 'user-dsh', provider: 'p', modelInvocable: true },
    { name: 'a-skill', description: 'duplicate' },
    { name: 'bad name!', description: 'x' },
    { name: 'b-skill', description: 'B', modelInvocable: false },
  ]);
  assert.deepEqual(store.known().map(row => row.name), ['a-skill', 'b-skill']);
  const again = createSkillStore({ directory });
  assert.deepEqual(again.hidden(), ['deep-ptc-cards']);
  assert.equal(again.known().length, 2);
  assert.equal(again.known()[1].modelInvocable, false);
});

test('stored values never carry junk', () => {
  const value = normalizeSkillStore({ hidden: ['ok-name', 'bad name', '', 'ok-name', 42], known: [{ name: 'x' }] });
  assert.deepEqual(value.hidden, ['ok-name']);
  assert.deepEqual(value.known.map(row => [row.name, row.source]), [['x', 'unknown']]);
  assert.equal(value.known[0].modelInvocable, false);
});
test('the local renderer matches the host frame and the name grammar', () => {
  assert.equal(isSkillName('deep-ptc-cards'), true);
  assert.equal(isSkillName('Bad Name'), false);
  assert.equal(isSkillName('has_underscore'), false);
  assert.equal(isModelInvocable({ invocation: { modelInvocable: true } }), true);
  assert.equal(isModelInvocable({ invocation: { modelInvocable: false } }), false);
  const text = renderSkillContent({ name: 'a-b', provider: 'p', content: '# body', resourceBase: { kind: 'directory', path: '/tmp/skills' } });
  assert.match(text, /^<skill_content name="a-b">\n<skill_resources>/u);
  assert.match(text, /Base directory for this skill: \/tmp\/skills/u);
  assert.match(text, /<skill_instructions>\n# body\n<\/skill_instructions>/u);
  assert.match(renderSkillContent({ name: 'x', provider: 'p', content: 'b', resourceBase: { kind: 'opaque', description: 'd' } }), /Resources for this skill: d/u);
});
