// Virtual DSH control: the side panel's button and the model's virtual_dsh tool share this runtime.
//
// The panel starts, stops and opens a virtual DSH (lib/preview.mjs). The tool also installs and
// removes extra plugins, reads and writes its configuration, restarts it and reads its log. Every
// change happens inside the virtual DSH's own temporary home; the user's real DSH is never touched.
// One state file is shared with a virtual DSH the model started through the shell.
//
// The tool posts an approval card in the chat for a start count the user can adjust; the click grants
// a quota of uses. One use is from opening the virtual DSH to closing it: restarts and new builds in
// between cost nothing. The side panel's button is the user's own channel and spends none of it; what the
// user opened there, this conversation's model may test in but not close. Only one exists at a time. The launcher
// is a child of the host, stopped when the host stops; anything a hard stop leaves behind is swept on
// the next start or load.
//
// Nothing here waits inside run_code, whose budget an approval, an install or a test turn outlasts. Work
// that takes longer than a moment becomes an operation: the call returns, the turn waits at the tool
// boundary (lib/card-wait.mjs) like it does for a card, and the result arrives as a message.
import { isSubagentSession, REPORT_TO_PARENT } from './subagent-interaction.mjs';
import { createHash } from 'node:crypto';
import { fork, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gated } from './gate.mjs';
import { NO_SESSION, WRONG_MODE, coded, deliver } from './model-view.mjs';
import { PROFILE, alive, cliCommand, dshHome, killTree, virtualEnv } from './preview.mjs';
import { sweepAll, virtualBase } from './virtual-home.mjs';
import { isDeepPtcSession } from './session-preset.mjs';
import { importHost } from './host.mjs';
import { cardsRuntime } from './cards-context.mjs';
import { OPEN, STOPPED, STOPPING, readCardInput } from './cards.mjs';
import { latestOf, latestVersions, records } from './card-state.mjs';
import { cancel as cancelTurn, chat, connect, sessions as listSessions, transcript } from './virtual-client.mjs';
import { answer as answerTurn, describePending, openInbox } from './virtual-inbox.mjs';
import { createUi } from './virtual-ui.mjs';

export const VIRTUAL_COMMAND = 'deep-ptc-virtual-dsh';
export const VIRTUAL_TOOL = 'virtual_dsh';
export const VIRTUAL_KEY = 'deepPtcVirtual';
export const VIRTUAL_EVENT = 'plugin:dsh-deep-ptc-mode/virtual';
const PREVIEW = fileURLToPath(new URL('./preview.mjs', import.meta.url));
const LIVE = ['preparing', 'installing', 'adding package', 'starting', 'running', 'restarting'];
// One approval covers this many starts unless the user changes the number on the card.
const DEFAULT_STARTS = 10;
const MAX_STARTS = 50;
const APPROVAL_PREFIX = 'virtual-dsh-approval-';
export const stateFile = (home = dshHome()) => join(home, 'storages', 'deep-ptc-virtual-dsh.json');

function readState(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
}

const addedFile = root => join(root, 'added.json');
const readAdded = root => { try { return JSON.parse(readFileSync(addedFile(root), 'utf8')); } catch { return []; } };

/** What the panel and the tool see: the state file, corrected when its process is gone. */
export function readStatus(file = stateFile()) {
  const state = readState(file);
  if (state === undefined) return { state: 'stopped' };
  const live = LIVE.includes(state.state);
  if (live && !alive(state.pid)) return { state: state.error ? 'failed' : 'stopped', error: state.error ?? null };
  const root = live && state.root && existsSync(state.root) ? state.root : null;
  return { state: state.state ?? 'stopped', url: live ? state.url ?? null : null, error: state.error ?? null,
    package: state.package ?? null, root, added: root ? readAdded(root) : [] };
}

/** The runtime the preset row's tool uses; set once the profile-level layer is installed. */
export const virtualRuntime = { api: undefined, operations: undefined };

/**
 * @param options - `{ enabled, watch, spawn, stateFile, run }`: the deep creative mode setting, its
 *   subscription, and test seams for starting the launcher and running the DSH CLI.
 */
export function apply(ctx, options = {}) {
  return ctx.plugin({ name: 'deep-ptc-virtual-dsh', inject: ['commands', 'sessionProjections'], apply: async child => {
    // Leftovers from a run the host could not stop cleanly.
    try { sweepAll(); } catch (error) { child.logger?.warn?.('Deep PTC: virtual DSH sweep failed (%s)', error.message); }
    const records = options.records ?? (await importHost('@deepseek-ai/dsh-session')).appendPluginRecord;
    const parse = value => { if (value === null || typeof value !== 'object' || value.v !== 1) throw new Error('Invalid virtual DSH state'); return value; };
    const projection = await child.sessionProjections.register({ key: VIRTUAL_KEY, stateVersion: 1, stateSchema: { parse },
      init: () => ({ v: 1, status: { state: 'unknown' }, hash: '' }),
      apply: (state, event) => event.type === VIRTUAL_EVENT && event.data?.v === 1 ? event.data : state,
      wire: { viewSchema: { parse }, view: state => state, summary: false } });
    child.effect(() => () => projection.dispose());
    const api = createApi(options);
    api.watch(session => projection.stateOf(session)?.hash, (session, status, hash) => records(session, VIRTUAL_EVENT, { v: 1, status, hash }));
    virtualRuntime.api = api;
    virtualRuntime.operations = createOperations({ waits: options.waits, logger: child.logger });
    child.effect(() => () => { api.close(); api.stop(); if (virtualRuntime.api === api) virtualRuntime.api = undefined; });
    child.effect(() => child.on('session/event', (session, event) => {
      if (event?.type === 'turn/end' && event.data?.reason?.kind === 'aborted') virtualRuntime.operations.mute(session.id);
    }));
    gated(child, options.enabled, options.watch, () => child.commands.register({ name: VIRTUAL_COMMAND, recordInput: false,
      description: '虚拟 DSH 环境 / Virtual DSH',
      handler: ({ agent, rawInput }) => command(child, api, agent, rawInput) }), 'Deep PTC: virtual DSH');
    // Profile-level, so switching deep creative mode on gives running Deep PTC conversations the tool too.
    child.inject(['tools'], scope => gated(scope, options.enabled, options.watch, () => scope.tools.register(
      virtualToolDefinition(virtualRuntime, { approval: () => scope.get?.('approval') }),
      { when: ({ agent }) => isDeepPtcSession(scope, agent?.session) && !isSubagentSession(agent.session) }), 'Deep PTC: virtual DSH tool'));
  } }).await().catch(error => ctx.logger.warn('Deep PTC: the virtual DSH controls are off (%s)', error.message));
}

// ---- Operations -------------------------------------------------------------------------------

// What a run_code program may still hold on to without risking its budget.
const INLINE_MS = 20_000;
export const VIRTUAL_SOURCE = 'deep-ptc-virtual-dsh';

/**
 * Long work outside run_code. A result that is ready within a moment is the call's own value; anything
 * longer is delivered as a message, and the turn waits for it unless the user writes meanwhile.
 * @param options - `{ waits }`: lib/card-wait.mjs; without it the result still arrives as a message.
 */
export function createOperations({ waits, logger, send = deliver, inlineMs = INLINE_MS } = {}) {
  const open = new Map();
  let seq = 0;
  return {
    /** The operation under way in a conversation. */
    current: sessionId => [...open.values()].find(op => op.sessionId === sessionId),
    /** The user stopped the turn: finish quietly instead of opening another one. */
    mute(sessionId) { for (const op of open.values()) if (op.sessionId === sessionId) op.muted = true; },
    async run(exec, label, work, { waitsForUser = false, inline = inlineMs } = {}) {
      const op = { id: `virtual-${++seq}`, label, sessionId: exec.agent?.session?.id, stage: waitsForUser ? 'waiting for the user to allow it in the approval card' : 'working', since: Date.now() };
      open.set(op.id, op);
      let detached = false;
      const settled = Promise.resolve().then(() => work(op)).then(value => ({ value }), error => ({ error }));
      void settled.then(async outcome => {
        try {
          if (detached && !op.muted) {
            const text = outcome.error ? `[Virtual DSH: ${label} failed]\n${outcome.error.message ?? outcome.error}` : `[Virtual DSH: ${label}]\n${JSON.stringify(outcome.value)}`;
            await send(exec.agent, { text, summary: `虚拟 DSH · ${label}${outcome.error ? ' · 失败' : ''}` }, VIRTUAL_SOURCE);
          }
        } catch (error) { logger?.warn?.('Deep PTC: a virtual DSH result was not delivered (%s)', error?.message); }
        finally { open.delete(op.id); waits?.changed?.(); }
      });
      if (!waitsForUser && inline > 0) {
        let timer;
        const first = await Promise.race([settled, new Promise(done => { timer = setTimeout(done, inline); timer.unref?.(); })]);
        clearTimeout(timer);
        if (first !== undefined) { if (first.error) throw first.error; return first.value; }
      }
      detached = true;
      waits?.add?.(exec, () => open.has(op.id));
      return { operation: op.id, state: op.stage, next: 'End this program now. The turn waits for the result and continues by itself; the result arrives as a [Virtual DSH: …] message. Do not poll, sleep or call it again.' };
    },
  };
}

// ---- Packages ---------------------------------------------------------------------------------

/** A path as this host opens it: WSL's /mnt/d/x and Git Bash's /d/x name Windows drives. */
export function hostPath(value, platform = process.platform) {
  const text = String(value ?? '').trim().replace(/^file:(?:\/\/\/?)?/u, '');
  if (platform !== 'win32') return text;
  const match = /^\/(?:mnt\/)?([a-zA-Z])\/(.*)$/u.exec(text);
  return match ? `${match[1].toUpperCase()}:\\${match[2].replaceAll('/', '\\')}` : text;
}

function pack(directory, target) {
  return new Promise((done, fail) => {
    const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--silent', '--pack-destination', `"${target}"`], { cwd: directory, shell: true, windowsHide: true, env: npmEnv() });
    let output = '';
    const keep = chunk => { output = (output + chunk).slice(-4000); };
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    child.on('error', error => fail(new Error(`npm pack could not run: ${error.message}. Pack the plugin yourself and pass the .tgz.`)));
    child.on('exit', code => {
      const file = readdirSync(target).filter(name => name.endsWith('.tgz')).map(name => join(target, name)).sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
      if (code === 0 && file) done(file); else fail(new Error(`npm pack failed in ${directory}:\n${output.slice(-1500)}`));
    });
  });
}
function npmEnv() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

/**
 * The archive to install for a package argument: a .tgz, or a plugin directory, which is packed first.
 * Each build gets its own short name, so a rebuilt archive at the same path is never mistaken for the
 * one already installed, and an unusual source path never reaches the package manager.
 */
export async function stagePackage(spec, { packer = pack, root = join(virtualBase(), 'deep-ptc-packages') } = {}) {
  const source = resolve(hostPath(spec));
  if (!existsSync(source)) throw new Error(`${source} does not exist. Pass a built .tgz or the plugin's directory.`);
  mkdirSync(root, { recursive: true });
  // Archives of earlier runs.
  for (const name of readdirSync(root)) { try { if (Date.now() - statSync(join(root, name)).mtimeMs > 864e5) rmSync(join(root, name), { recursive: true, force: true }); } catch { /* in use */ } }
  let file = source;
  if (statSync(source).isDirectory()) {
    if (!existsSync(join(source, 'package.json'))) throw new Error(`${source} has no package.json.`);
    const target = join(root, `pack-${Date.now().toString(36)}`);
    mkdirSync(target, { recursive: true });
    file = await packer(source, target);
  } else if (!/\.(tgz|tar\.gz)$/iu.test(source)) throw new Error('package: a .tgz archive or a plugin directory');
  const hash = createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 10);
  const staged = join(root, `${basename(file).replace(/\.(tgz|tar\.gz)$/iu, '').replace(/[^\w.-]/gu, '_')}-${hash}.tgz`);
  copyFileSync(file, staged);
  return staged;
}

// Startup trouble worth telling the tester about; notices every DSH on this machine prints are left out.
const TROUBLE = /failed to import|startup failed|did not activate|cannot find (?:package|module)|\bError:|unhandled/iu;
function troubleIn(log) {
  return [...new Set(log.split(/\r?\n/u).filter(line => TROUBLE.test(line) && !/disabling profile plugin row/iu.test(line)).map(line => line.trim().slice(0, 300)))].slice(0, 8);
}

/** Run the DSH CLI against the virtual home without blocking the host. */
function runCli(args, root, timeoutMs = 300_000) {
  const cli = cliCommand(undefined);
  const quote = value => /[\s"&|<>^]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value;
  const all = [...cli.args, ...args];
  return new Promise(done => {
    const childProcess = spawn(cli.shell ? quote(cli.command) : cli.command, cli.shell ? all.map(quote) : all,
      { cwd: join(root, 'workspace'), env: virtualEnv(root), shell: cli.shell, windowsHide: true });
    let output = '';
    const keep = chunk => { output = (output + chunk.toString()).slice(-20_000); };
    childProcess.stdout.on('data', keep);
    childProcess.stderr.on('data', keep);
    const timer = setTimeout(() => killTree(childProcess.pid), timeoutMs);
    childProcess.on('error', error => { clearTimeout(timer); done({ status: 1, output: String(error.message) }); });
    childProcess.on('exit', status => { clearTimeout(timer); done({ status: status ?? 1, output }); });
  });
}

export function createApi(options = {}) {
  const file = options.stateFile ?? stateFile();
  const start = options.spawn ?? ((script, argv, opts) => fork(script, argv, opts));
  const cliRun = options.run ?? runCli;
  // `options.process`: a launcher already running (tests).
  const runtime = { process: options.process };
  // The model's authorization is a quota of uses, granted on the approval card. A side-panel start
  // shares that one run with its conversation and grants no uses.
  const quotas = new Map();
  let shared;
  let owner = 'user';
  const usedCards = new Map();
  let approvalSeq = 0;

  function launch(extra) {
    let cli;
    try { cli = cliCommand(undefined); } catch (error) { throw new Error(String(error.message)); }
    const args = ['--state', file, '--cli', cli.args[0] ?? cli.command, ...extra];
    // The host may be Electron running as Node: the child needs the same mode to run a script.
    runtime.process = start(PREVIEW, args, { cwd: dirname(PREVIEW), env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], windowsHide: true });
    const current = runtime.process;
    current.on?.('exit', () => { if (runtime.process === current) runtime.process = undefined; });
    // Until the launcher writes its own state, the file must not show how the previous run ended.
    if (Number.isSafeInteger(current?.pid)) { try { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify({ state: 'preparing', pid: current.pid, childPid: null, root: null, url: null, error: null })); } catch { /* the launcher writes it */ } }
  }

  async function waitFor(states, timeoutMs = 240_000) {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const status = readStatus(file);
      if (states.includes(status.state) || ['failed', 'stopped'].includes(status.state)) return status;
      if (Date.now() > until) return { ...status, error: status.error ?? 'timed out waiting for the virtual DSH' };
      await new Promise(done => setTimeout(done, 1500));
    }
  }

  // Sessions whose side panel shows the virtual DSH: each gets the status as it changes, pushed through
  // a session projection, whoever started the virtual DSH (the button, the tool or the shell).
  const watchers = new Set();
  let timer;
  let pushed;
  let shown;
  // The conversation whose model started it: its user gets the virtual DSH opened in the sidebar.
  let opener;
  const tick = () => {
    const current = readStatus(file);
    const status = opener && current.state !== 'stopped' ? { ...current, open: opener } : current;
    const hash = JSON.stringify(status);
    for (const session of watchers) {
      if (shown?.(session) === hash) continue;
      Promise.resolve(pushed?.(session, status, hash)).catch(() => watchers.delete(session));
    }
  };
  let client;
  const virtualClient = async () => {
    const status = readStatus(file);
    if (status.state !== 'running' || !status.url) throw new Error(`The virtual DSH is ${status.state}. Start it and wait for running first.`);
    if (client?.url !== status.url) {
      client?.inbox?.close();
      client = { url: status.url, connection: await connect(status.url) };
    }
    return client.connection;
  };
  // Opened with the first test message, so a question or approval raised there is seen and answerable.
  const inbox = async () => {
    const connection = await virtualClient();
    if (client.inbox === undefined || client.inbox.closed) client.inbox = (options.openInbox ?? openInbox)(connection);
    await client.inbox.ready;
    return client.inbox;
  };
  const withPending = async result => {
    if (result.outcome !== 'input-required') return result;
    let waiting = [];
    try {
      const box = await inbox();
      for (let attempt = 0; attempt < 10 && waiting.length === 0; attempt++) {
        waiting = box.list(result.session);
        if (waiting.length === 0) await new Promise(done => setTimeout(done, 200));
      }
    } catch { /* the conversation is still readable */ }
    return { ...result, waiting: waiting.map(describePending), next: 'Answer with virtual_dsh answer (session and answers or decision), or operate the interface with ui.' };
  };
  const ui = (options.createUi ?? createUi)(() => {
    const status = readStatus(file);
    if (status.state !== 'running' || !status.url || !status.root) throw new Error(`The virtual DSH is ${status.state}. Start it first.`);
    return { url: status.url, root: status.root };
  });

  const api = {
    /** Push status changes to `push(session, status, hash)` for subscribed sessions. */
    watch(current, push) { shown = current; pushed = push; },
    subscribe(session) {
      if (!session || watchers.has(session)) return;
      if (watchers.size >= 32) watchers.delete(watchers.values().next().value);
      watchers.add(session);
      timer ??= setInterval(tick, 2000);
      timer.unref?.();
      tick();
    },
    close() { if (timer) clearInterval(timer); timer = undefined; watchers.clear(); ui.close(); client?.inbox?.close(); },
    status: () => readStatus(file),
    /** The user opened it from this conversation's side panel: its model may test in that run. */
    share(sessionId) { shared = sessionId; owner = 'user'; },
    sharedWith: sessionId => !!sessionId && shared === sessionId,
    /** Who opened the running one: `user` (the side panel or the shell) or `model`. */
    openedBy: () => owner,
    quota(sessionId) { return sessionId ? quotas.get(sessionId) : undefined; },
    setQuota(sessionId, total, cardId = null) {
      if (!sessionId) return undefined;
      const quota = { total, remaining: total, cardId, at: Date.now() };
      quotas.set(sessionId, quota);
      return quota;
    },
    spend(sessionId) { const quota = quotas.get(sessionId); if (quota && quota.remaining > 0) quota.remaining -= 1; return quota; },
    cardUsed(sessionId, cardId) { return !!usedCards.get(sessionId)?.has(cardId); },
    markCard(sessionId, cardId) {
      if (!sessionId || !cardId) return;
      let used = usedCards.get(sessionId);
      if (used === undefined) { used = new Set(); usedCards.set(sessionId, used); }
      used.add(cardId);
    },
    nextApprovalId() { return APPROVAL_PREFIX + Date.now().toString(36) + '-' + (++approvalSeq); },

    /** Talk to the virtual DSH as a user would: a message in a (new) session, then the turn's events. */
    async chat(args) {
      const connection = await virtualClient();
      await inbox().catch(() => {});
      return withPending(await chat(connection, { ...args, cwd: args.cwd ?? (readStatus(file).root ? join(readStatus(file).root, 'workspace') : undefined) }));
    },
    /** Answer the question or approval that waits in a session there. */
    async answer(args) {
      if (!args.session) throw new Error('session: the session that waits');
      return withPending(await answerTurn(await virtualClient(), await inbox(), args));
    },
    /** One step in its web interface. */
    ui: args => ui.step(args),
    /** Open it in this conversation's sidebar once it runs. */
    showTo(session) { if (session?.id) { opener = { session: session.id, at: Date.now() }; api.subscribe(session); tick(); } },

    /** How a start or restart ended, with what the tester needs next. */
    report(status = readStatus(file)) {
      const log = (() => { try { return readFileSync(join(status.root, 'dsh.log'), 'utf8'); } catch { return ''; } })();
      if (status.state !== 'running') return { state: status.state, error: status.error ?? 'It did not reach running.', problems: troubleIn(log), next: 'Read logs for the full startup output, fix the cause, then start again.' };
      let deps = {};
      try { deps = JSON.parse(readFileSync(join(status.root, '.dsh', 'profiles', PROFILE, 'package.json'), 'utf8')).dependencies ?? {}; } catch { /* unknown */ }
      const name = status.package ? installedName(status.root, status.package) : null;
      const version = name && (() => { try { return JSON.parse(readFileSync(join(status.root, '.dsh', 'profiles', PROFILE, 'node_modules', name, 'package.json'), 'utf8')).version; } catch { return deps[name] ?? null; } })();
      return { state: 'running', ...name ? { testing: { name, version } } : {}, added: status.added ?? [], problems: troubleIn(log),
        next: 'Test with chat (preset deep-ptc for a Deep PTC conversation), answer what waits with answer, operate the interface with ui. It opens in the user’s right sidebar.' };
    },
    /** Wait for a start under way to settle. */
    async settled(timeoutMs) { return waitFor(['running'], timeoutMs); },
    async transcript(sessionId, limit) { if (!sessionId) throw new Error('session: a session id from chat or sessions'); return transcript(await virtualClient(), sessionId, limit); },
    async sessions() { return { sessions: await listSessions(await virtualClient()) }; },
    async cancel(sessionId) { if (!sessionId) throw new Error('session: the session to cancel'); return cancelTurn(await virtualClient(), sessionId); },

    /** Start a fresh virtual DSH, unless one is already running. */
    start({ package: pkg, credentials = true, by = 'user' } = {}) {
      const current = readStatus(file);
      if (!['stopped', 'failed'].includes(current.state)) return current;
      owner = by;
      if (by === 'model') shared = undefined;
      launch([...pkg ? ['--package', resolve(hostPath(pkg))] : [], ...credentials === false ? ['--no-credentials'] : []]);
      return { state: 'preparing' };
    },

    /** Stop it; `keep` leaves the environment for a restart. */
    stop({ keep = false } = {}) {
      const current = runtime.process;
      runtime.process = undefined;
      opener = undefined;
      shared = undefined;
      owner = 'user';
      ui.close();
      client?.inbox?.close();
      client = undefined;
      if (current?.connected) { try { current.send({ type: 'stop', keep }); return { state: keep ? 'restarting' : 'stopping' }; } catch { /* hard stop */ } }
      const state = readState(file);
      if (!state) return { state: 'stopped' };
      // The launcher first: otherwise it records its DSH's end as a failure.
      if (state.pid && alive(state.pid)) killTree(state.pid);
      if (state.childPid && LIVE.includes(state.state)) killTree(state.childPid);
      if (!keep) { try { writeFileSync(file, JSON.stringify({ ...state, state: 'stopped', url: null, error: null })); } catch { /* read as stopped: its process is gone */ } }
      // A hard stop skips the launcher's cleanup: forget the credentials now, sweep the rest.
      if (!keep && state.root) {
        for (const entry of ['.credentials.yaml', 'llm-deepseek']) { try { rmSync(join(state.root, '.dsh', entry), { recursive: true, force: true }); } catch { /* swept later */ } }
        setTimeout(() => { try { sweepAll(); } catch { /* next start */ } }, 2000).unref?.();
      }
      return { state: keep ? 'restarting' : 'stopping' };
    },

    /** Restart the running virtual DSH with its current environment and port. */
    async restart() {
      const state = readState(file);
      const status = readStatus(file);
      if (!status.root) throw new Error('No virtual DSH is running. Start one first.');
      if (runtime.process?.connected) runtime.process.send({ type: 'restart' });
      else {
        // Started elsewhere (the shell): replace its launcher, keeping the directory and the port.
        if (state.childPid) killTree(state.childPid);
        if (state.pid) killTree(state.pid);
        await new Promise(done => setTimeout(done, 1500));
        launch(['--reuse', status.root, ...state.port ? ['--port', String(state.port)] : []]);
      }
      await new Promise(done => setTimeout(done, 1000));
      return waitFor(['running']);
    },

    /** Install an extra plugin (a .tgz, a directory or an npm spec) and restart. */
    async addPlugin(spec) {
      const status = readStatus(file);
      if (!status.root) throw new Error('No virtual DSH is running. Start one first.');
      if (typeof spec !== 'string' || spec.trim() === '') throw new Error('spec: a .tgz path, a plugin directory or an npm package name');
      const path = hostPath(spec);
      const local = isAbsolute(path) || /^\.{1,2}[\\/]/u.test(path) ? await (options.stage ?? stagePackage)(path) : undefined;
      const target = local ?? spec.trim();
      const result = await cliRun(['plugin', '--profile', PROFILE, 'add', target], status.root);
      if (result.status !== 0) throw new Error(`Installing ${target} failed:\n${result.output.slice(-1500)}`);
      const name = installedName(status.root, target);
      writeFileSync(addedFile(status.root), JSON.stringify([...readAdded(status.root).filter(row => row.name !== name), { name, spec: target }], null, 1));
      return { ...await api.restart(), installed: name };
    },

    /** Remove a plugin from the virtual DSH and restart. */
    async removePlugin(name) {
      const status = readStatus(file);
      if (!status.root) throw new Error('No virtual DSH is running. Start one first.');
      if (typeof name !== 'string' || !/^(@[\w.-]+\/)?[\w.-]+$/u.test(name)) throw new Error('name: the installed package name');
      const result = await cliRun(['plugin', '--profile', PROFILE, 'remove', name], status.root);
      if (result.status !== 0) throw new Error(`Removing ${name} failed:\n${result.output.slice(-1500)}`);
      writeFileSync(addedFile(status.root), JSON.stringify(readAdded(status.root).filter(row => row.name !== name), null, 1));
      return { ...await api.restart(), removed: name };
    },

    /** The plugins the virtual DSH's profile depends on, and which of them were added here. */
    plugins() {
      const status = readStatus(file);
      if (!status.root) throw new Error('No virtual DSH is running. Start one first.');
      const pkg = JSON.parse(readFileSync(join(status.root, '.dsh', 'profiles', PROFILE, 'package.json'), 'utf8'));
      const added = new Set(readAdded(status.root).map(row => row.name));
      return { bundles: pkg.dsh?.profile?.bundles ?? [],
        plugins: Object.entries(pkg.dependencies ?? {}).map(([name, version]) => ({ name, version, added: added.has(name) })) };
    },

    /** The virtual DSH's configuration: the profile's cordis.patch.yml and the home's. */
    readConfig() {
      const status = readStatus(file);
      if (!status.root) throw new Error('No virtual DSH is running. Start one first.');
      const read = path => { try { return readFileSync(path, 'utf8'); } catch { return ''; } };
      return { profile: read(configPath(status.root, 'profile')), home: read(configPath(status.root, 'home')) };
    },

    /** Replace one configuration file after checking it parses as YAML, then restart. */
    async writeConfig(which, content) {
      const status = readStatus(file);
      if (!status.root) throw new Error('No virtual DSH is running. Start one first.');
      if (which !== 'profile' && which !== 'home') throw new Error('file: profile or home');
      if (typeof content !== 'string') throw new Error('content: the whole YAML file');
      try { yaml().load(content); } catch (error) { throw new Error(`Not valid YAML: ${error.message}`); }
      writeFileSync(configPath(status.root, which), content);
      return { ...await api.restart(), written: which };
    },

    /** The end of the virtual DSH's log. */
    logs(lines = 80) {
      const status = readStatus(file);
      if (!status.root) throw new Error('No virtual DSH is running. Start one first.');
      let text = '';
      try { text = readFileSync(join(status.root, 'dsh.log'), 'utf8'); } catch { /* nothing yet */ }
      const count = Number.isSafeInteger(lines) ? Math.min(Math.max(lines, 1), 400) : 80;
      return { log: text.split(/\r?\n/u).slice(-count).join('\n') };
    },
  };
  return api;
}

const configPath = (root, which) => which === 'profile' ? join(root, '.dsh', 'profiles', PROFILE, 'cordis.patch.yml') : join(root, '.dsh', 'cordis.patch.yml');

let yamlModule;
const yaml = () => (yamlModule ??= createRequire(import.meta.url)('js-yaml'));

/** The package name an add installed: read from the archive name, the directory or the spec. */
function installedName(root, target) {
  try {
    if (existsSync(join(target, 'package.json'))) return JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).name;
  } catch { /* fall through */ }
  const deps = (() => { try { return JSON.parse(readFileSync(join(root, '.dsh', 'profiles', PROFILE, 'package.json'), 'utf8')).dependencies ?? {}; } catch { return {}; } })();
  for (const [name, value] of Object.entries(deps)) if (String(value).includes(basename(target))) return name;
  return target.replace(/@[^@/]+$/u, '');
}

const answer = status => ({ kind: 'success', text: coded('virtual', JSON.stringify(status)) });

/** The panel's command: status, start and stop. */
export function command(ctx, api, agent, rawInput) {
  if (!agent?.session) return { kind: 'error', text: NO_SESSION };
  if (!isDeepPtcSession(ctx, agent.session)) return { kind: 'error', text: WRONG_MODE };
  let request;
  try { request = JSON.parse(String(rawInput ?? '')); } catch { return { kind: 'error', text: 'Invalid request. / 无效的请求。' }; }
  api.subscribe?.(agent.session);
  try {
    if (request?.op === 'status') return answer(api.status());
    if (request?.op === 'stop') return answer(api.stop());
    if (request?.op === 'start') {
      const before = api.status?.().state;
      const status = api.start({ credentials: request.credentials !== false });
      // The user's own channel: the model may test in this run, and its granted uses stay untouched.
      if (before === undefined || before === 'stopped' || before === 'failed') api.share?.(agent.session.id);
      return answer(status);
    }
  } catch (error) { return { kind: 'error', text: String(error?.message ?? error) }; }
  return { kind: 'error', text: 'Invalid request. / 无效的请求。' };
}

// Approval: the tool posts a card in the chat for a number of uses; allowing it grants that quota.
const NEEDS_GRANT = new Set(['start', 'restart', 'add_plugin', 'remove_plugin', 'write_config', 'chat', 'answer', 'ui', 'cancel']);
// They use a running virtual DSH and never launch one.
const USES_ONLY = new Set(['chat', 'answer', 'ui', 'cancel']);
const GRANT_REASON = 'Deep PTC asks to use a virtual DSH for testing in this conversation: start and restart it as often as needed, install or remove plugins and edit its configuration inside its temporary home, and send it test messages. One approval covers the whole conversation. The virtual DSH copies your sign-in and runs with your permission settings, so its test sessions can act on this computer. You can stop it any time in the side panel.';
const NOT_AUTHORIZED = 'Testing in the virtual DSH is not authorized in this conversation. The approval card could not be shown (conversation cards may be off). Ask the user to open the virtual DSH from the side panel (Deep creative mode): you can then test in that run. If the user declined the approval card, respect that refusal.';

/** A requested start count: the model proposes it, the user can change it on the card. */
function clampStarts(value) {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : typeof value === 'number' ? Math.trunc(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 1 ? Math.min(parsed, MAX_STARTS) : DEFAULT_STARTS;
}

/** The approval card: a start count the user can adjust, then Allow or Deny. */
function approvalCardBody(proposed) {
  return {
    title: '虚拟 DSH 使用授权 / Virtual DSH testing',
    subtitle: '模型请求启动隔离的虚拟 DSH 来测试这次改动 / The model asks to start a virtual DSH for this task',
    icon: 'server',
    tone: 'warn',
    blocks: [
      { type: 'text', text: '从打开到关闭算一次，其间重启、更换测试包不另计；次数内模型不会再询问。你在侧栏自己打开的不占次数。 / One use is from opening to closing; restarts and new builds in between are free, and the model will not ask again within the count. What you open in the side panel does not count.' },
      { type: 'field', name: 'starts', label: '允许使用次数 / Uses allowed', kind: 'number', value: proposed, min: 1, max: MAX_STARTS, step: 1 },
    ],
    note: '只对本次会话有效；可随时在侧栏停止。 / This authorization covers this conversation only; stop the environment any time in the side panel.',
    actions: [
      { id: 'approve', label: '允许 / Allow', style: 'primary', reply: 'The user allowed {starts} virtual DSH uses in this conversation. The requested one is opening.' },
      { id: 'deny', label: '不允许 / Deny', reply: 'The user declined virtual DSH testing in this conversation.' },
    ],
  };
}

/** An approved card that has not paid for a quota yet: a previous call may have been interrupted. */
function findApprovedCard(api, store, session) {
  try {
    let best;
    for (const version of latestVersions(store.read(session)).values()) {
      if (!version.id.startsWith(APPROVAL_PREFIX)) continue;
      if (version.phase !== STOPPED || version.result?.action !== 'approve') continue;
      if (api.cardUsed?.(session.id, version.id)) continue;
      if (best === undefined || version.rev > best.rev) best = version;
    }
    if (best === undefined) return undefined;
    return { total: clampStarts(best.result.values?.starts), cardId: best.id };
  } catch { return undefined; }
}

const POLL_MS = 250;

/** Post the approval card; its decision is read later, outside any program's budget. */
async function postApproval(api, session, proposed) {
  const store = cardsRuntime.store;
  const before = store.read(session);
  const id = api.nextApprovalId();
  const parsed = readCardInput(approvalCardBody(proposed));
  if (parsed.issues !== undefined) throw new Error('The virtual DSH approval card is invalid: ' + parsed.issues.join('; '));
  await store.append(session, records.show(before, id, parsed.card));
  if (latestOf(store.read(session), id) === undefined) throw new Error('The virtual DSH approval card could not be shown.');
  return id;
}

/** The start count the user granted on the card, however long they take. */
async function decidedOn(session, id, op) {
  for (;;) {
    const store = cardsRuntime.store;
    if (op.muted || store === undefined) throw new Error('The turn was stopped before the approval card was answered. The card stays in the chat; an approval there still counts for the next start.');
    const version = latestOf(store.read(session), id);
    if (version !== undefined && version.phase !== OPEN && version.phase !== STOPPING) {
      if (version.phase === STOPPED && version.result?.action === 'approve') return clampStarts(version.result.values?.starts);
      throw new Error('The user did not authorize testing in the virtual DSH.');
    }
    await new Promise(done => { setTimeout(done, POLL_MS).unref?.(); });
  }
}

/**
 * What this call still needs before it may run: undefined when it is authorized, otherwise a function
 * that obtains the authorization inside an operation.
 */
async function grantFor(runtime, exec, approval, args) {
  const session = exec.agent?.session;
  if (isSubagentSession(session)) throw new Error(REPORT_TO_PARENT);
  if (!session?.id) throw new Error(NO_SESSION);
  const api = runtime.api;
  const action = args.action;
  const running = api.status?.().state === 'running';
  const quota = api.quota?.(session.id);
  if (USES_ONLY.has(action)) {
    if (!running) throw new Error('The virtual DSH is not running. Call virtual_dsh start first; starting asks the user for authorization.');
    if (quota !== undefined || api.sharedWith?.(session.id)) return undefined;
  } else if (action === 'start' && running && args.package === undefined && (quota !== undefined || api.sharedWith?.(session.id))) {
    return undefined;
  } else if (quota !== undefined && (quota.remaining > 0 || running)) return undefined;
  if (cardsRuntime.store !== undefined && cardsRuntime.enabled()) {
    const approved = findApprovedCard(api, cardsRuntime.store, session);
    if (approved !== undefined) { api.setQuota(session.id, approved.total, approved.cardId); api.markCard(session.id, approved.cardId); return undefined; }
    // Posted now, so the card is on screen before the program ends.
    const id = await postApproval(api, session, clampStarts(args.starts));
    return async op => {
      const total = await decidedOn(session, id, op);
      api.setQuota(session.id, total, id);
      api.markCard(session.id, id);
    };
  }
  const service = approval?.();
  if (typeof service?.request !== 'function') throw new Error('No approval is available here. Ask the user to start the virtual DSH from the side panel (Deep creative mode).');
  return async () => {
    const outcome = await service.request({ agent: exec.agent, toolName: VIRTUAL_TOOL, ...exec.callId ? { callId: exec.callId } : {}, reason: GRANT_REASON });
    if (outcome !== 'allowed-once') throw new Error(NOT_AUTHORIZED);
    api.setQuota(session.id, DEFAULT_STARTS);
  };
}

const LABELS = { start: 'start', restart: 'restart', add_plugin: 'add plugin', remove_plugin: 'remove plugin', write_config: 'write configuration', chat: 'chat', answer: 'answer', ui: 'interface step', cancel: 'cancel' };
// The host accepts lossless JSON only: undefined fields are left out.
const lossless = value => value === undefined ? null : JSON.parse(JSON.stringify(value));

/** The work behind one action, run inside an operation. */
async function perform(api, args, exec, options) {
  const session = exec.agent.session;
  // One use is from opening to closing, so only opening spends: what changes a running one is free.
  const uses = () => { const quota = api.quota?.(session.id); return quota ? { uses_left: quota.remaining } : {}; };
  const opened = status => { if (status?.state === 'running') api.spend?.(session.id); return { ...api.report(status), ...uses() }; };
  const reported = async result => ({ ...api.report(result), ...result.installed ? { installed: result.installed } : {}, ...result.removed ? { removed: result.removed } : {}, ...result.written ? { written: result.written } : {} });
  switch (args.action) {
    case 'start': {
      const before = api.status();
      const staged = args.package === undefined ? undefined : await (options.stage ?? stagePackage)(args.package);
      if (before.state === 'running') {
        api.showTo(session);
        // A running virtual DSH takes the new build in place instead of being started over.
        return staged === undefined ? { ...api.report(before), opened_by: api.openedBy?.() ?? 'user', ...uses() } : reported(await api.addPlugin(staged));
      }
      if (!LIVE.includes(before.state)) { api.start({ package: staged, credentials: args.credentials, by: 'model' }); api.showTo(session); return opened(await api.settled()); }
      // Someone is opening it already: join that run.
      api.showTo(session);
      return api.report(await api.settled());
    }
    case 'restart': return reported(await api.restart());
    case 'add_plugin': return reported(await api.addPlugin(args.spec));
    case 'remove_plugin': return reported(await api.removePlugin(args.name));
    case 'write_config': return reported(await api.writeConfig(args.file, args.content));
    case 'chat': return api.chat({ message: args.message, session: args.session, preset: args.preset, waitSeconds: args.wait_seconds });
    case 'answer': return api.answer({ session: args.session, decision: args.decision, answers: args.answers, waitSeconds: args.wait_seconds });
    case 'ui': return api.ui({ do: args.do, session: args.session, ref: args.ref, text: args.text, key: args.key });
    case 'cancel': return api.cancel(args.session);
    default: throw new Error('Unknown action');
  }
}

/** The virtual_dsh tool, bound to the shared runtime at call time. */
export function virtualToolDefinition(runtime = virtualRuntime, options = {}) {
  const fallback = createOperations({});
  return {
    name: VIRTUAL_TOOL,
    resident: true,
    description: 'Start, operate and test in the virtual DSH: a fresh DSH with the same host version, plugins, skills and settings as the user\'s, without their sessions or memory. start boots it and waits until it runs; pass package (a .tgz or a plugin directory, which is packed for you) to test a build, also while it is running to replace the build. restart, add_plugin, remove_plugin, list_plugins, read_config, write_config, logs, stop. chat sends a message as the user would and returns that turn: replies, tool calls, results, errors, and what waits for an answer; answer replies to a question or approval that waits there; transcript, sessions and cancel inspect and stop its conversations. ui operates its web interface in a browser: do open, read, click, type, press, screenshot. The first start posts an approval card with a number of uses the user can adjust. One use is from start to stop; restarts and new builds in between are free. Debugging usually takes several, so ask for enough at once (starts). Only one virtual DSH exists at a time; the user may open one from the side panel, which costs you nothing and is theirs to close. A call that takes longer than a moment returns an operation: end the program, the turn waits and the result arrives as a message. Never poll. The user sees it in the side panel and it opens in their right sidebar.',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['status', 'start', 'stop', 'restart', 'add_plugin', 'remove_plugin', 'list_plugins', 'read_config', 'write_config', 'logs', 'chat', 'answer', 'ui', 'transcript', 'sessions', 'cancel'] },
      package: { type: 'string', description: 'start: absolute path of a built .tgz or of the plugin\'s directory.' },
      credentials: { type: 'boolean', description: 'start: false to start it signed out (default: copy the user\'s sign-in).' },
      starts: { type: 'integer', description: 'start: how many uses to ask for (default 10, max 50); the user can change it on the card.' },
      spec: { type: 'string', description: 'add_plugin: .tgz path, plugin directory or npm package spec.' },
      name: { type: 'string', description: 'remove_plugin: the installed package name.' },
      file: { type: 'string', enum: ['profile', 'home'], description: 'write_config: which cordis.patch.yml to replace.' },
      content: { type: 'string', description: 'write_config: the complete YAML file.' },
      lines: { type: 'integer', description: 'logs and transcript: how many lines, up to 400.' },
      message: { type: 'string', description: 'chat: what to send, as a user would type it.' },
      session: { type: 'string', description: 'chat, answer, transcript, cancel, ui open: a session id in the virtual DSH; chat starts a new session without it.' },
      preset: { type: 'string', description: 'chat: agent preset for a new session, e.g. deep-ptc (default: the virtual DSH\'s default).' },
      wait_seconds: { type: 'integer', description: 'chat and answer: how long the turn may take, up to 1800 (default 300; 0 returns at once).' },
      decision: { type: 'string', enum: ['allow', 'reject'], description: 'answer: for an approval.' },
      answers: { type: 'array', description: 'answer: one entry per question, in order.', items: { type: 'object', additionalProperties: false, properties: {
        question: { type: 'string', description: 'The question id; optional when the order matches.' },
        choose: { type: 'array', items: { type: 'string' }, description: 'Option labels exactly as listed.' },
        text: { type: 'string', description: 'A written answer.' } } } },
      do: { type: 'string', enum: ['open', 'reload', 'read', 'click', 'type', 'press', 'screenshot'], description: 'ui: the step. open shows a session; read lists the visible text and controls with refs.' },
      ref: { type: 'string', description: 'ui click, type: a control ref from the last read (e12).' },
      text: { type: 'string', description: 'ui click: a control\'s visible name instead of a ref. ui type: the text.' },
      key: { type: 'string', description: 'ui press, or after type: Enter, Escape, Tab, Backspace, Space or an arrow key.' },
    } },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const api = runtime.api;
      if (api === undefined) throw new Error('The virtual DSH is not ready yet; try again in a moment');
      const session = exec.agent?.session;
      if (!session) throw new Error('No active conversation');
      const operations = runtime.operations ?? options.operations ?? fallback;
      // The side panel of this conversation follows the virtual DSH from now on.
      api.subscribe?.(session);
      const busy = operations.current(session.id);
      switch (args.action) {
        case 'status': return lossless({ ...api.status(), ...busy ? { operation: { id: busy.id, doing: busy.label, stage: busy.stage }, next: 'End this program: the turn waits for the operation and its result arrives as a message.' } : {} });
        case 'stop':
          if (LIVE.includes(api.status().state) && api.openedBy?.() === 'user') throw new Error('The user opened this virtual DSH themselves, so closing it is theirs to do in the side panel. Only one can exist at a time: test in it, or ask them to close it.');
          if (api.status().state !== 'stopped' && api.quota?.(session.id) === undefined) throw new Error(NOT_AUTHORIZED);
          return lossless({ ...api.stop(), uses_left: api.quota?.(session.id)?.remaining });
        case 'list_plugins': return lossless(api.plugins());
        case 'read_config': return lossless(api.readConfig());
        case 'logs': return lossless(api.logs(args.lines));
        case 'transcript': return lossless(await api.transcript(args.session, args.lines));
        case 'sessions': return lossless(await api.sessions());
        default: break;
      }
      if (!NEEDS_GRANT.has(args.action)) throw new Error('Unknown action');
      if (busy && !(args.action === 'cancel')) {
        throw new Error(`The virtual DSH is busy with ${busy.label} (${busy.stage}). End this program; the turn continues with its result.`);
      }
      const grant = await grantFor(runtime, exec, options.approval, args);
      return lossless(await operations.run(exec, LABELS[args.action], async op => {
        if (grant !== undefined) { await grant(op); op.stage = 'working'; }
        return lossless(await perform(api, args, exec, options));
      }, { waitsForUser: grant !== undefined }));
    },
  };
}
