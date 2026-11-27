import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PREFIX, cliCommand, mirrorHome, mirrorProfile, parseArgs, removeTree, sourceProfile, sweep } from '../lib/preview.mjs';
import { VIRTUAL_COMMAND, VIRTUAL_TOOL, command, createApi, createOperations, hostPath, readStatus, stagePackage, virtualToolDefinition } from '../lib/virtual-dsh.mjs';
import { describePending, outcomeFor } from '../lib/virtual-client.mjs';
import { findBrowser } from '../lib/virtual-ui.mjs';
import { cardsRuntime } from '../lib/cards-context.mjs';
import { blankCards, CARDS_EVENT, foldCardsState, latestOf, records } from '../lib/card-state.mjs';
import { STOPPED } from '../lib/cards.mjs';
import { PROFILE } from '../lib/preview.mjs';

const slash = path => path.replaceAll('\\', '/');

// A DSH home like a real desktop one: a profile with a linked local plugin and an outside .tgz,
// plus sessions, storages and memory that must not reach the virtual DSH.
function realHome() {
  const root = mkdtempSync(join(tmpdir(), 'dpt-real-'));
  const home = join(root, '.dsh');
  const profile = join(home, 'profiles', 'desktop');
  mkdirSync(profile, { recursive: true });
  mkdirSync(join(home, 'local-plugins', 'ui', 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(home, 'local-plugins', 'ui', 'package.json'), '{"name":"ui"}');
  writeFileSync(join(home, 'local-plugins', 'ui', 'node_modules', 'dep', 'x.js'), '');
  const tgz = join(root, 'outside', 'pkg-1.0.0.tgz');
  mkdirSync(join(root, 'outside'), { recursive: true });
  writeFileSync(tgz, '');
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: {
    ui: `link:${slash(join(home, 'local-plugins', 'ui'))}`, pkg: `file:${slash(tgz)}`, 'dsh-deep-ptc-mode': '2.2.0' } }, null, 2));
  writeFileSync(join(profile, 'pnpm-lock.yaml'), [
    'importers:', '  .:', '    dependencies:',
    '      ui:', '        specifier: link:' + slash(join(home, 'local-plugins', 'ui')), '        version: link:../../local-plugins/ui',
    '      pkg:', '        specifier: file:' + slash(tgz), '        version: file:../../../outside/pkg-1.0.0.tgz', '',
    'packages:', '  pkg@file:../../../outside/pkg-1.0.0.tgz:', '    resolution: {tarball: file:../../../outside/pkg-1.0.0.tgz}', ''].join('\n'));
  writeFileSync(join(profile, 'pnpm-workspace.yaml'), 'storeDir: D:\\.pnpm-store\n');
  writeFileSync(join(profile, 'cordis.yml'), '[]');
  mkdirSync(join(profile, 'node_modules'), { recursive: true });
  for (const dir of ['skills/my-skill', 'sessions/ws', 'storages', 'llm-deepseek']) mkdirSync(join(home, dir), { recursive: true });
  writeFileSync(join(home, 'skills', 'my-skill', 'SKILL.md'), '# mine');
  writeFileSync(join(home, 'sessions', 'ws', 'log'), 'private');
  writeFileSync(join(home, 'storages', 'memory.json'), '{}');
  writeFileSync(join(home, 'AGENTS.md'), 'my instructions');
  writeFileSync(join(home, '.credentials.yaml'), 'token: x');
  writeFileSync(join(home, 'cordis.patch.yml'), '[]');
  return { root, home, tgz };
}

test('the virtual DSH copies the environment, never sessions, plugin data or memory', () => {
  const real = realHome();
  const target = join(mkdtempSync(join(tmpdir(), 'dpt-virtual-')), '.dsh');
  assert.equal(sourceProfile(real.home), 'desktop');
  const plugins = mirrorProfile(real.home, 'desktop', target);
  assert.deepEqual(plugins, ['ui'], 'linked local plugins come along');
  assert.ok(existsSync(join(target, 'local-plugins', 'ui', 'package.json')));
  assert.equal(existsSync(join(target, 'local-plugins', 'ui', 'node_modules')), false, 'dependencies are reinstalled, not copied');
  assert.equal(existsSync(join(target, 'profiles', 'virtual', 'node_modules')), false);
  const pkg = JSON.parse(readFileSync(join(target, 'profiles', 'virtual', 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies.ui, `link:${slash(join(target, 'local-plugins', 'ui'))}`, 'the link points at the copy');
  assert.equal(pkg.dependencies.pkg, `file:${slash(real.tgz)}`, 'an outside archive keeps its absolute path');
  const lock = readFileSync(join(target, 'profiles', 'virtual', 'pnpm-lock.yaml'), 'utf8');
  assert.match(lock, /version: link:\.\.\/\.\.\/local-plugins\/ui$/mu);
  const outside = slash(join('..', '..', '..', '..')) ;
  assert.doesNotMatch(lock, /file:\.\.\/\.\.\/\.\.\/outside/u, 'relative paths are recomputed from the new profile');
  assert.ok(lock.includes(`file:${slash(real.tgz)}`) && lock.includes(outside), 'the lockfile still names the same archive');

  const copied = mirrorHome(real.home, target, { credentials: false });
  assert.deepEqual(copied.sort(), ['cordis.patch.yml', 'skills']);
  for (const kept of ['sessions', 'storages', 'AGENTS.md', '.credentials.yaml', 'llm-deepseek']) assert.equal(existsSync(join(target, kept)), false, kept);
  assert.deepEqual(mirrorHome(real.home, join(mkdtempSync(join(tmpdir(), 'dpt-virtual-')), '.dsh')).filter(entry => entry.includes('cred') || entry.includes('llm')).sort(),
    ['.credentials.yaml', 'llm-deepseek'], 'credentials are copied from the running user only when asked');
});

test('leftovers of a stopped run are swept; a running or just-created one is left alone', () => {
  const base = mkdtempSync(join(tmpdir(), 'dpt-sweep-'));
  const dead = join(base, PREFIX + 'dead');
  mkdirSync(dead);
  writeFileSync(join(dead, 'preview.json'), JSON.stringify({ pid: 2 ** 30, childPid: null }));
  const live = join(base, PREFIX + 'live');
  mkdirSync(live);
  writeFileSync(join(live, 'preview.json'), JSON.stringify({ pid: process.pid }));
  const fresh = join(base, PREFIX + 'fresh');
  mkdirSync(fresh);
  const old = join(base, PREFIX + 'old');
  mkdirSync(old);
  const hourAgo = new Date(Date.now() - 3_600_000);
  utimesSync(old, hourAgo, hourAgo);
  const removed = sweep(base);
  assert.deepEqual(removed.map(dir => dir.slice(base.length + 1 + PREFIX.length)).sort(), ['dead', 'old']);
  assert.ok(existsSync(live) && existsSync(fresh));
});

test('removing a virtual home unlinks junctions instead of following them into the real plugin', () => {
  const root = mkdtempSync(join(tmpdir(), 'dpt-remove-'));
  const target = join(root, 'real-plugin');
  const home = join(root, 'home');
  mkdirSync(target, { recursive: true });
  mkdirSync(join(home, 'node_modules'), { recursive: true });
  writeFileSync(join(target, 'package.json'), '{"name":"real"}');
  const link = join(home, 'node_modules', 'real-plugin');
  symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
  removeTree(home);
  assert.equal(existsSync(home), false, 'the virtual home is removed');
  assert.ok(existsSync(join(target, 'package.json')), 'the linked plugin is untouched');
});

test('arguments: named flags, and the 2.2.0 positional form still works', () => {
  assert.deepEqual(parseArgs(['--package', 'a.tgz', '--no-credentials', '--profile', 'web']), { credentials: false, keep: false, package: 'a.tgz', profile: 'web' });
  assert.deepEqual(parseArgs(['built.tgz', 'C:/x/dsh/lib/bin.js']), { credentials: true, keep: false, package: 'built.tgz', cli: 'C:/x/dsh/lib/bin.js' });
  assert.deepEqual(parseArgs([]), { credentials: true, keep: false }, 'no package: a copy of the current environment');
  assert.throws(() => parseArgs(['--bogus']), /Unknown argument/u);
});

test('the CLI of the running host is preferred: the desktop app ships one beside its executable', () => {
  const install = mkdtempSync(join(tmpdir(), 'dpt-app-'));
  const shim = join(install, 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
  mkdirSync(join(shim, '..'), { recursive: true });
  writeFileSync(shim, '@echo off');
  const found = cliCommand(undefined, { execPath: join(install, 'DeepSeek Harness.exe'), env: { PATH: '' }, platform: 'win32' });
  assert.deepEqual(found, { command: shim, args: [], shell: true });
  const bin = join(install, 'bin.js');
  writeFileSync(bin, '');
  assert.deepEqual(cliCommand(bin, { execPath: 'node', env: {}, platform: 'win32' }), { command: 'node', args: [bin], shell: false });
});

const pause = ms => new Promise(done => setTimeout(done, ms));

// A running virtual DSH as the launcher leaves it: a state file and a home with the copied profile.
function runningVirtual() {
  const dir = mkdtempSync(join(tmpdir(), 'dpt-state-'));
  const file = join(dir, 'state.json');
  const root = join(dir, 'virtual');
  mkdirSync(join(root, '.dsh', 'profiles', PROFILE), { recursive: true });
  mkdirSync(join(root, 'workspace'), { recursive: true });
  writeFileSync(join(root, '.dsh', 'profiles', PROFILE, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } }, dependencies: { 'dsh-ops': '0.5.0' } }));
  writeFileSync(join(root, '.dsh', 'profiles', PROFILE, 'cordis.patch.yml'), '- id: a\n  config: {}\n');
  writeFileSync(join(root, 'dsh.log'), Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n'));
  writeFileSync(file, JSON.stringify({ state: 'running', pid: process.pid, childPid: null, root, url: 'http://127.0.0.1:1/?token=t', port: 1 }));
  return { file, root };
}

test('the panel command starts one virtual DSH, reports its state and stops it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dpt-state-'));
  const file = join(dir, 'state.json');
  const ctx = { get: name => name === 'agentPresets' ? { presetForSession: () => 'deep-ptc' } : undefined };
  const agent = { session: { id: 's' } };
  const started = [];
  const fake = { connected: true, sent: [], send(message) { this.sent.push(message); }, on() {} };
  const api = createApi({ stateFile: file, spawn: (script, args, opts) => { started.push({ script, args, opts }); return fake; } });
  const run = request => command(ctx, api, agent, JSON.stringify(request));
  assert.equal(VIRTUAL_COMMAND, 'deep-ptc-virtual-dsh');
  assert.match(run({ op: 'status' }).text, /^\[dpt:virtual\] \{"state":"stopped"\}$/u);
  const reply = run({ op: 'start', credentials: false });
  if (reply.kind === 'error') { assert.match(reply.text, /DSH CLI not found/u); return; } // no DSH CLI on this machine
  assert.match(reply.text, /"state":"preparing"/u);
  assert.equal(started.length, 1);
  assert.ok(started[0].script.endsWith('preview.mjs'));
  assert.ok(started[0].args.includes('--no-credentials') && started[0].args.includes('--state'));
  assert.equal(started[0].opts.env.ELECTRON_RUN_AS_NODE, '1');
  // While it runs, a second start reports the running one instead of starting another.
  writeFileSync(file, JSON.stringify({ state: 'running', pid: process.pid, url: 'http://127.0.0.1:1/?token=t' }));
  assert.match(run({ op: 'start' }).text, /"state":"running".*"url":"http:\/\/127\.0\.0\.1:1\/\?token=t"/u);
  assert.equal(started.length, 1);
  assert.match(run({ op: 'stop' }).text, /stopping/u);
  assert.deepEqual(fake.sent, [{ type: 'stop', keep: false }], 'a clean stop: the launcher removes credentials and its directory');
  writeFileSync(file, JSON.stringify({ state: 'running', pid: 2 ** 30, url: 'http://127.0.0.1:1/' }));
  assert.deepEqual(readStatus(file), { state: 'stopped', error: null }, 'a state whose process is gone reads as stopped');
  assert.equal(command({ get: () => ({ presetForSession: () => 'ptc' }) }, api, agent, '{"op":"status"}').kind, 'error', 'Deep PTC only');
});

// A card store that folds the approval card and answers it like the user would, after a tick.
function approvalCards(answers = [{ action: 'approve', starts: '3' }]) {
  let state = blankCards();
  let seq = 0;
  let next = 0;
  const shown = [];
  const store = {
    read: () => state,
    async append(session, record) {
      seq += 1;
      state = foldCardsState(state, { type: CARDS_EVENT, seq, data: record });
      if (record.op !== 'show') return;
      const version = latestOf(state, record.id);
      if (!version?.actions?.length) return;
      shown.push(version);
      const answer = answers[Math.min(next++, answers.length - 1)];
      if (answer.action === 'wait') return;
      setTimeout(() => {
        const live = latestOf(state, record.id);
        if (live === undefined || live.phase !== 'open') return;
        const result = answer.action === 'approve'
          ? { action: 'approve', label: 'Allow', values: { starts: String(answer.starts ?? '3') }, at: 1 }
          : { action: 'deny', label: 'Deny', at: 1 };
        seq += 1;
        state = foldCardsState(state, { type: CARDS_EVENT, seq, data: records.phase(live, STOPPED, result) });
      }, 5);
    },
    waits: { add() {} },
    enabled: () => true,
  };
  return { store, shown };
}

test('chatting with the virtual DSH before a start points at the start action instead of a card', async () => {
  const priorStore = cardsRuntime.store;
  cardsRuntime.store = undefined;
  try {
    const dir = mkdtempSync(join(tmpdir(), 'dpt-state-'));
    const api = createApi({ stateFile: join(dir, 'state.json') });
    const tool = virtualToolDefinition({ api }, { approval: () => ({ request: async () => 'rejected' }) });
    await assert.rejects(() => tool.execute({ action: 'chat', message: 'hi' }, { agent: { session: { id: 'no-start' } } }), /not running[\s\S]*start first/iu);
  } finally {
    cardsRuntime.store = priorStore;
  }
});

test('the virtual_dsh tool adds and removes plugins, edits configuration and reads the log inside the virtual home', async () => {
  const { file, root } = runningVirtual();
  const calls = [];
  const restarts = [];
  const fake = { connected: true, send(message) { restarts.push(message); }, on() {} };
  // The launcher this host started: a restart is a message to it, never a process kill.
  const api = createApi({ stateFile: file, process: fake, run: async (args, at) => { calls.push({ args, at }); return { status: 0, output: 'ok' }; } });
  // One approval per conversation: the first change asks, later ones do not; a refusal stops it.
  const asked = [];
  let answer = 'rejected';
  const approval = () => ({ request: async request => { asked.push(request); return answer; } });
  const sent = [];
  const tool = virtualToolDefinition({ api, operations: createOperations({ send: async (_agent, message) => { sent.push(message); } }) }, { approval });
  assert.equal(tool.name, VIRTUAL_TOOL);
  const exec = { agent: { session: { id: 's' } }, callId: 'call-1' };
  const status = await tool.execute({ action: 'status' }, exec);
  assert.equal(status.state, 'running');
  assert.deepEqual(status.added, []);
  assert.equal(asked.length, 0, 'reading status needs no approval');
  await tool.execute({ action: 'add_plugin', spec: 'dsh-x' }, exec);
  await pause(30);
  assert.match(sent.at(-1).text, /add plugin failed[\s\S]*not authorized/u);
  assert.equal(calls.length, 0, 'nothing ran without approval');
  answer = 'allowed-once';
  assert.equal(asked[0].toolName, VIRTUAL_TOOL);
  assert.equal(asked[0].callId, 'call-1');
  assert.match(asked[0].reason, /One approval covers the whole conversation/u);
  await assert.rejects(() => virtualToolDefinition({ api }).execute({ action: 'restart' }, { agent: { session: { id: 'other' } } }), /No approval is available/u,
    'without an approval service it fails closed');

  api.setQuota('s', 3);
  const pkg = join(root, '..', 'my-plugin-1.0.0.tgz');
  writeFileSync(pkg, '');
  const added = await tool.execute({ action: 'add_plugin', spec: pkg }, exec);
  const staged = calls[0].args.at(-1);
  assert.match(staged, /deep-ptc-packages.*my-plugin-1\.0\.0-[0-9a-f]{10}\.tgz$/u, 'a copy with its own name');
  assert.equal(calls[0].at, root, 'the CLI runs against the virtual home only');
  assert.equal(added.state, 'running');
  assert.deepEqual(restarts, [{ type: 'restart' }], 'installing restarts the virtual DSH with its environment and port');
  await tool.execute({ action: 'add_plugin', spec: 'dsh-some-plugin@1.2.0' }, exec);
  assert.deepEqual(readStatus(file).added.map(row => row.spec), [staged, 'dsh-some-plugin@1.2.0']);
  await assert.rejects(() => tool.execute({ action: 'add_plugin', spec: join(root, 'missing.tgz') }, exec), /does not exist/u);
  await tool.execute({ action: 'remove_plugin', name: 'dsh-some-plugin' }, exec);
  assert.deepEqual(calls.at(-1).args, ['plugin', '--profile', PROFILE, 'remove', 'dsh-some-plugin']);
  await assert.rejects(() => tool.execute({ action: 'remove_plugin', name: '../x' }, exec), /package name/u);

  const listed = await tool.execute({ action: 'list_plugins' }, exec);
  assert.deepEqual(listed.bundles, ['@deepseek-ai/dsh-base']);
  assert.deepEqual(listed.plugins[0], { name: 'dsh-ops', version: '0.5.0', added: false });

  const config = await tool.execute({ action: 'read_config' }, exec);
  assert.match(config.profile, /- id: a/u);
  await assert.rejects(() => tool.execute({ action: 'write_config', file: 'profile', content: 'a: [' }, exec), /Not valid YAML/u);
  await tool.execute({ action: 'write_config', file: 'profile', content: '- id: b\n  config: {}\n' }, exec);
  assert.equal(readFileSync(join(root, '.dsh', 'profiles', PROFILE, 'cordis.patch.yml'), 'utf8'), '- id: b\n  config: {}\n');
  assert.equal((await tool.execute({ action: 'logs', lines: 3 }, exec)).log, 'line 7\nline 8\nline 9');
  for (const parameter of Object.values(tool.parameters.properties)) assert.equal(typeof parameter.type, 'string', 'SDK schema subset');
});

test('the side panel of every subscribed conversation gets status changes pushed', async () => {
  const { file } = runningVirtual();
  const api = createApi({ stateFile: file });
  const pushes = [];
  const shown = new Map();
  api.watch(session => shown.get(session), (session, status, hash) => { pushes.push({ session: session.id, state: status.state }); shown.set(session, hash); });
  const one = { id: 'one' };
  api.subscribe(one);
  api.subscribe(one);
  assert.deepEqual(pushes, [{ session: 'one', state: 'running' }], 'pushed at once, and only on change');
  writeFileSync(file, JSON.stringify({ state: 'stopped' }));
  await new Promise(done => setTimeout(done, 2300));
  assert.deepEqual(pushes.at(-1), { session: 'one', state: 'stopped' });
  api.close();
});

test('a turn in the virtual DSH is summarized for the tester: words, tool calls, results, errors', async () => {
  const { summarize } = await import('../lib/virtual-client.mjs');
  const lines = summarize([
    { type: 'event', event: { type: 'user/message', seq: 5, surfaceOp: 'append', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'hi' }] } } },
    { type: 'event', event: { type: 'user/message', seq: 6, surfaceOp: 'append', data: { source: { kind: 'runtime-context' }, content: [{ type: 'text', text: 'cwd' }] } } },
    { type: 'event', event: { type: 'assistant/message', seq: 7, data: { message: { content: [{ type: 'text', text: 'hello' }, { type: 'tool-call', name: 'run_code', arguments: '{"code":"1"}' }] } } } },
    { type: 'event', event: { type: 'tool/result', seq: 8, data: { message: { isError: true, content: [{ type: 'text', text: 'boom' }] } } } },
    { type: 'event', event: { type: 'turn/end', seq: 9, data: { reason: { kind: 'error', message: 'model failed' } } } },
  ], { afterSeq: 4 });
  assert.deepEqual(lines, ['[user] hi', '[assistant] hello', '[tool call] run_code {"code":"1"}', '[tool result error] boom', '[turn ended: error model failed]']);
});

// ---- Uses, operations and answers --------------------------------------------------------------

// A model's side of the tool over a virtual DSH that opens and closes at once.
function bench({ answers, cards = true } = {}) {
  const ui = approvalCards(answers);
  const prior = { store: cardsRuntime.store, enabled: cardsRuntime.enabled };
  cardsRuntime.store = cards ? ui.store : undefined;
  cardsRuntime.enabled = () => cards;
  const api = createApi({ stateFile: join(mkdtempSync(join(tmpdir(), 'dpt-state-')), 'state.json') });
  let state = 'stopped';
  const log = [];
  api.status = () => ({ state });
  const start = api.start;
  api.start = options => { log.push('open'); state = 'running'; api.markOwner?.(options.by); owner = options.by; return { state: 'preparing' }; };
  let owner = 'user';
  api.openedBy = () => owner;
  api.settled = async () => ({ state });
  api.restart = async () => { log.push('restart'); return { state }; };
  api.addPlugin = async spec => { log.push('add ' + spec); return { state, installed: spec }; };
  api.stop = () => { log.push('close'); state = 'stopped'; owner = 'user'; return { state: 'stopping' }; };
  api.report = status => ({ state: status.state });
  const sent = [];
  const waits = { added: [], add(_exec, pending) { this.added.push(pending); }, changed() {} };
  const operations = createOperations({ waits, send: async (_agent, message) => { sent.push(message); }, inlineMs: 50 });
  const tool = virtualToolDefinition({ api, operations }, { stage: async spec => 'staged:' + spec });
  const exec = { agent: { session: { id: 's' } }, callId: 'c' };
  return { api, ui, log, sent, waits, operations, exec, user: () => { state = 'running'; owner = 'user'; api.share('s'); },
    run: args => tool.execute(args, exec), restore: () => { Object.assign(cardsRuntime, prior); void start; } };
}

test('one card grants several uses; a use runs from start to stop and restarts are free', async () => {
  const b = bench({ answers: [{ action: 'approve', starts: '2' }, { action: 'approve', starts: '5' }] });
  try {
    const first = await b.run({ action: 'start', starts: 3 });
    assert.match(first.next, /End this program now/u, 'the program never waits for the user');
    assert.equal(b.waits.added[0](), true, 'the turn does');
    assert.equal(b.ui.shown[0].blocks.find(block => block.type === 'field').value, '3');
    await pause(400);
    assert.equal(b.waits.added[0](), false);
    assert.match(b.sent[0].text, /^\[Virtual DSH: start\]\n\{"state":"running","uses_left":1\}/u, 'the user allowed two instead of three');
    await b.run({ action: 'restart' });
    await b.run({ action: 'start', package: 'D:/plugin' });
    await b.run({ action: 'add_plugin', spec: 'x' });
    assert.deepEqual(b.log, ['open', 'restart', 'add staged:D:/plugin', 'add x'], 'a new build goes into the running one');
    assert.equal(b.api.quota('s').remaining, 1);
    assert.equal((await b.run({ action: 'stop' })).uses_left, 1);
    assert.equal((await b.run({ action: 'start' })).uses_left, 0, 'inside the quota nothing asks');
    assert.equal(b.ui.shown.length, 1);
    await b.run({ action: 'restart' });
    await b.run({ action: 'stop' });
    await b.run({ action: 'start' });
    assert.equal(b.ui.shown.length, 2, 'the uses are spent: a new card');
    await pause(400);
    assert.equal(b.api.quota('s').remaining, 4);
  } finally { b.restore(); }
});

test('a denied card opens nothing and says so', async () => {
  const b = bench({ answers: [{ action: 'deny' }] });
  try {
    await b.run({ action: 'start' });
    await pause(400);
    assert.match(b.sent[0].text, /did not authorize/u);
    assert.deepEqual(b.log, []);
  } finally { b.restore(); }
});

test('what the user opens in the side panel is their own channel', async () => {
  const b = bench();
  try {
    b.user();
    assert.equal((await b.run({ action: 'start' })).opened_by, 'user', 'the model joins it without a card');
    assert.equal(b.ui.shown.length, 0);
    assert.equal(b.api.quota('s'), undefined, 'no use was granted or spent');
    await assert.rejects(() => b.run({ action: 'stop' }), /The user opened/u);
    assert.deepEqual(b.log, [], 'only one exists');
  } finally { b.restore(); }
});

test('a second action is refused while one is under way, and a stopped turn stays silent', async () => {
  const b = bench({ answers: [{ action: 'wait' }] });
  try {
    const original = b.ui.store.append;
    b.ui.store.append = async (session, record) => { const row = await original(session, record); return row; };
    const slow = b.operations.run(b.exec, 'chat', () => new Promise(done => setTimeout(() => done('late'), 150)));
    assert.match((await slow).operation, /^virtual-/u);
    await assert.rejects(() => b.run({ action: 'restart' }), /busy with chat/u);
    assert.equal((await b.run({ action: 'status' })).operation.doing, 'chat');
    b.operations.mute('s');
    await pause(200);
    assert.deepEqual(b.sent, []);
    assert.equal(b.operations.current('s'), undefined);
  } finally { b.restore(); }
});

test('a package may be an archive or a directory, in any spelling of its path', async () => {
  assert.equal(hostPath('/mnt/d/a/b.tgz', 'win32'), 'D:\\a\\b.tgz');
  assert.equal(hostPath('/d/a', 'win32'), 'D:\\a');
  assert.equal(hostPath('/home/a', 'linux'), '/home/a');
  const dir = mkdtempSync(join(tmpdir(), 'dpt-pkg-'));
  const root = join(dir, 'staged');
  const file = join(dir, '插件 1.tgz');
  writeFileSync(file, 'one');
  const first = await stagePackage(file, { root });
  writeFileSync(file, 'two');
  assert.notEqual(await stagePackage(file, { root }), first, 'a rebuilt archive is a new one');
  assert.match(first, /__1-[0-9a-f]{10}\.tgz$/u);
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'package.json'), '{"name":"p"}');
  assert.ok(existsSync(await stagePackage(join(dir, 'src'), { root, packer: async (_source, target) => { const out = join(target, 'p-1.0.0.tgz'); writeFileSync(out, 'x'); return out; } })));
  await assert.rejects(() => stagePackage(join(dir, 'missing'), { root }), /does not exist/u);
});

test('what waits in a conversation there can be read and answered', () => {
  const question = { event: 'user-questions/request', request: { questions: [{ id: 'q', question: '颜色', options: [{ label: '红' }, { label: '蓝' }] }, { id: 'n', question: '备注' }] } };
  assert.deepEqual(describePending(question).questions[0].options, ['红', '蓝']);
  assert.deepEqual(outcomeFor(question, { answers: [{ choose: ['蓝'] }, { question: 'n', text: 'hi' }] }).value.answers, [{ id: 'q', selected: ['蓝'] }, { id: 'n', selected: [], custom: 'hi' }]);
  assert.throws(() => outcomeFor(question, { answers: [{ choose: ['绿'] }] }), /no option 绿/u);
  assert.throws(() => outcomeFor(question, {}), /needs an answer/u);
  assert.equal(outcomeFor({ event: 'approval/request', request: {} }, { decision: 'allow' }).value, 'allowed-once');
  assert.throws(() => outcomeFor({ event: 'approval/request', request: {} }, {}), /allow or reject/u);
});

test('the interface is driven with a browser already on the machine', () => {
  const edge = join('X', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  assert.equal(findBrowser({ env: { ProgramFiles: 'X' }, platform: 'win32', exists: file => file === edge }), edge);
  assert.equal(findBrowser({ env: {}, platform: 'linux', exists: () => true }), undefined);
});
