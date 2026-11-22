// Runtime for the task brief (lib/task-brief.mjs).
//
// - A session projection folds the human user messages and the brief records, so the card, the
//   tool and the prompt read one state, rebuilt from the log after a restart.
// - A protected system prompt section shows the guidance and the current brief on every request.
// - A context reminder nudges the model when a substantive message is left unfiled.
// - The `task_brief` tool (a Deep PTC preset row, lib/brief-tool.mjs) files, reads and completes.
// - The `deep-ptc-brief` command applies the user's decisions and edits from the cards, and condenses
//   or restores messages. Condensing replaces the message's node in the model's history at the next
//   pre-step; the original event stays in the log, so the chat and task_brief source still show it.
// - The card history (`versions`) holds two kinds of rows: a review round, one chat card in which
//   the items of one filing are decided one by one, and a receipt left when a task is completed or
//   given up. Completing records the task in the project cards and empties the brief.

import { versionFields } from './review-versions.mjs';
import { clarifyReview, reviewQuestions } from './cards-context.mjs';
import { randomUUID } from 'node:crypto';
import { gated } from './gate.mjs';
import { importHost } from './host.mjs';
import { isSubagentSession, REPORT_TO_PARENT } from './subagent-interaction.mjs';
import { isDeepPtcSession } from './session-preset.mjs';
import { projectToolDefinition } from './project-context.mjs';
import { CARD_SOURCE, deliver, NO_SESSION, WRONG_MODE } from './model-view.mjs';
import { MAX_MESSAGES, MAX_MESSAGE, MAX_ITEMS, MAX_TEXT, REF, SECTIONS, activeMessages, allDone, applyUpdate, applyUserEdit, blankBrief, BRIEF_GUIDANCE, clip, coverage, isPending,
  messageText, openCoverage, stateText, stubText, substantive, taskTitle } from './task-brief.mjs';

export const BRIEF_KEY = 'deepPtcBrief';
export const BRIEF_EVENT = 'plugin:dsh-deep-ptc-mode/brief';
export const BRIEF_COMMAND = 'deep-ptc-brief';
export const BRIEF_TOOL = 'task_brief';
export const BRIEF_SOURCE = 'deep-ptc-brief';
const REVISION_SOURCE = 'deep-ptc-brief-revision';
const FEEDBACK_START = '\nUser feedback: ';
const SECTION_NAME = 'deep-ptc:task-brief';
const SECTION_ORDER = 10198;
const REMINDER_ORDER = 124;
const BRIEF_CONTEXT_ORDER = 125;
// Open items hold the review until the user has dealt with every item.
const pendingItem = state => state.items.find(item => item.status === 'open' && item.basis !== 'confirmed');
const needsApproval = state => !state.revising && !!pendingItem(state);

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const appended = event => event?.type === 'user/message' && (event.surfaceOp === undefined || event.surfaceOp === 'append');
const humanMessage = event => appended(event) && event.data?.source?.kind === 'user';
// Card answers and button choices are the user's words too: the brief can quote them.
const cardAnswer = event => appended(event) && event.data?.source?.kind === CARD_SOURCE;

/** A card answer as quotable text: `prompt：value` per answer, without the model-view scaffolding. */
export function cardAnswerText(text) {
  const lines = [];
  for (const line of text.split('\n')) {
    const match = /^[A-Za-z][\w]* = (.*?)(?:\s{2,}# (.*))?$/u.exec(line);
    if (!match) continue;
    const words = [...match[1].matchAll(/«([^»]*)»/gu)].map(found => found[1]);
    const value = words.length ? words.join('、') : match[1].replace(/^\[|\]$/gu, '');
    lines.push(match[2] ? `${match[2]}：${value}` : value);
  }
  return lines.join('\n');
}

// ---- State ------------------------------------------------------------------------------------

/** The card rows of one brief version: items and the source messages with their coverage. */
function viewRows(state) {
  const filed = activeMessages(state).filter(message => message.condensed || message.pending || message.skipped?.length || state.items.some(item => item.from === message.ref));
  return { items: state.items, messages: filed.map(message => ({ ref: message.ref, turn: message.turn, preview: message.text.slice(0, 160),
    ...coverage(message, state.items), ...message.condensed ? { condensed: true } : {}, ...message.pending ? { pending: message.pending } : {} })) };
}

/** One card version, kept for the turn it was current: history renders from these. */
function versionOf(state) {
  const rows = viewRows(state);
  return { rev: state.rev, turn: state.updatedTurn, items: rows.items, messages: rows.messages };
}

// Keep the newest messages, but never drop one the brief still points at.
function trimMessages(messages, items) {
  if (messages.length <= MAX_MESSAGES) return messages;
  const used = new Set(items.map(item => item.from));
  const out = [];
  let budget = messages.length - MAX_MESSAGES;
  for (const message of messages) {
    if (budget > 0 && !used.has(message.ref) && !message.condensed) { budget--; continue; }
    out.push(message);
  }
  return out;
}

const MARKS = ['skipped', 'condensed', 'pending', 'stubSeq'];
function marksOf(message) {
  return Object.fromEntries(MARKS.filter(key => message[key] !== undefined).map(key => [key, message[key]]));
}

/**
 * A record carries the brief and each message's marks; message text is folded from the log.
 * One review round keeps one chat node: while a round is open, every record names its anchor, so the
 * next item replaces the decided one in the same card instead of opening a node further down.
 * @param extra - `{ completed }` when the record archives the task.
 */
export function briefRecord(brief, feedback, extra = {}) {
  const prior = brief.versions?.at(-1);
  const open = prior?.round && !prior.settled;
  const anchor = open && !extra.completed ? prior.anchor ?? prior.rev : brief.rev;
  return { v: 1, single: true, rev: brief.rev, anchor, ...(brief.revising ? { revising: brief.revising } : {}), ...(feedback ? { feedback } : {}),
    ...(Number.isSafeInteger(brief.since) ? { since: brief.since } : {}), ...(extra.completed ? { completed: extra.completed } : {}),
    updatedTurn: brief.updatedTurn, next: brief.next, items: brief.items,
    marks: Object.fromEntries(brief.messages.filter(message => Object.keys(marksOf(message)).length).map(message => [message.ref, marksOf(message)])) };
}

// The user's decisions a record makes: items that waited for review before it and no longer do.
function decisionsOf(state, next, record) {
  if (state.revising) return [];
  const out = [];
  for (const item of state.items.filter(isPending)) {
    const after = next.items.find(row => row.id === item.id);
    if (after && isPending(after)) continue;
    if (next.revising?.item?.id === item.id) out.push({ item, outcome: 'returned', feedback: record.feedback ?? next.revising.feedback });
    else out.push({ item: after ?? item, outcome: after ? 'confirmed' : 'declined' });
  }
  return out;
}

// A later decision on the same item replaces the earlier one; a returned item keeps the user's note.
function mergeDecisions(list = [], entries) {
  const out = [...list];
  for (const entry of entries) {
    const at = out.findIndex(row => row.item.id === entry.item.id);
    if (at < 0) { out.push(entry); continue; }
    out[at] = { ...entry, ...(out[at].feedback && !entry.feedback ? { feedback: out[at].feedback } : {}) };
  }
  return out;
}

export function foldBrief(state, event) {
  if (event?.type === 'turn/start') {
    const turn = event.data?.turn;
    return Number.isSafeInteger(turn) && turn > state.turn ? { ...state, turn } : state;
  }
  const revisionNotice = appended(event) && event.data?.source?.kind === REVISION_SOURCE;
  if ((humanMessage(event) || cardAnswer(event) || revisionNotice) && Number.isSafeInteger(event.seq)) {
    const ref = `m${event.seq}`;
    if (state.messages.some(message => message.ref === ref)) return state;
    const card = cardAnswer(event);
    const content = messageText(event.data);
    const text = revisionNotice ? content.slice(content.indexOf(FEEDBACK_START) + FEEDBACK_START.length) : card ? cardAnswerText(content) : content;
    if (text.trim() === '') return state;
    return { ...state, messages: trimMessages([...state.messages, { ref, seq: event.seq, turn: state.turn, text, ...card ? { card: true } : {} }], state.items) };
  }
  if (event?.type !== BRIEF_EVENT || !isRecord(event.data) || event.data.v !== 1) return state;
  const record = event.data;
  if (!Array.isArray(record.items) || !isRecord(record.next) || !Number.isSafeInteger(record.rev)) return state;
  const marks = isRecord(record.marks) ? record.marks : {};
  const messages = state.messages.map(message => {
    const { skipped: _s, condensed: _c, pending: _p, stubSeq: _q, ...rest } = message;
    const mark = isRecord(marks[message.ref]) ? marks[message.ref] : {};
    return { ...rest, ...Array.isArray(mark.skipped) ? { skipped: mark.skipped.filter(span => typeof span === 'string') } : {},
      ...mark.condensed === true ? { condensed: true } : {}, ...mark.pending === 'condense' || mark.pending === 'restore' ? { pending: mark.pending } : {},
      ...Number.isSafeInteger(mark.stubSeq) ? { stubSeq: mark.stubSeq } : {} };
  });
  const items = record.items.filter(item => isRecord(item) && typeof item.id === 'string' && SECTIONS.includes(item.section) && typeof item.text === 'string');
  const next = { ...state, rev: record.rev, updatedTurn: Number.isSafeInteger(record.updatedTurn) ? record.updatedTurn : state.turn, next: record.next, items, messages };
  if (record.single) {
    if (record.revising) next.revising = record.revising;
    else delete next.revising;
    if (Number.isSafeInteger(record.since)) next.since = record.since;
    const history = [...(state.versions ?? [])];
    if (record.rev < state.rev) return state;
    if (record.rev === state.rev) return { ...next, versions: history };
    const prior = history.at(-1);
    const round = prior?.round && !prior.settled ? prior : undefined;
    const decided = decisionsOf(state, next, record);
    // Completing archives the task: the open round closes and a receipt takes its own node.
    if (isRecord(record.completed)) {
      if (round) history[history.length - 1] = { ...round, rev: next.rev, items: [], queue: [], decided: mergeDecisions(round.decided, decided), settled: true };
      history.push({ completed: record.completed, rev: next.rev, anchor: record.anchor, turn: next.updatedTurn, items: [], messages: [] });
      return { ...next, tasks: [...(state.tasks ?? []), record.completed].slice(-20), versions: history };
    }
    const head = !next.revising && pendingItem(next);
    const queue = next.items.filter(isPending).map(item => item.id);
    if (head || next.revising) {
      const fields = { rev: next.rev, items: head ? [head] : [], queue, waiting: next.revising ? next.revising.item.id : undefined };
      if (round) {
        history[history.length - 1] = { ...round, ...fields, decided: mergeDecisions(round.decided, decided),
          askedSeq: head && head.id === round.items[0]?.id ? round.askedSeq : event.seq };
      } else {
        history.push({ round: true, anchor: record.anchor, turn: next.updatedTurn, askedSeq: event.seq, messages: [], ...fields, decided });
      }
    } else if (round) {
      history[history.length - 1] = { ...round, rev: next.rev, items: [], queue: [], waiting: undefined, decided: mergeDecisions(round.decided, decided), settled: true };
    }
    return { ...next, versions: history };
  }
  const versions = Array.isArray(state.versions) ? state.versions : [];
  const last = versions[versions.length - 1];
  // Replace the draft as it changes. A settled approval is immutable, including when a
  // second approval is requested later in the very same turn.
  const history = versions.slice();
  if (!last || next.rev > last.rev) {
    const draft = last && !last.settled && needsApproval(last);
    const version = { ...versionOf(next), anchor: record.anchor ?? (draft ? last.anchor ?? last.rev : next.rev) };
    if (draft) {
      history.pop();
      version.turn = last.turn;
      if (!needsApproval(next)) version.settled = true;
    } else if (last && !last.settled && last.turn === next.updatedTurn) {
      history.pop();
    }
    if (record.feedback && draft) Object.assign(version, { items: last.items, messages: last.messages, feedback: record.feedback, settled: true });
    history.push(version);
  }
  return { ...next, versions: history };
}

export function parseBrief(value) {
  if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.items) || !Array.isArray(value.messages)) throw new Error('Invalid Deep PTC task brief');
  return { ...value, versions: Array.isArray(value.versions) ? value.versions : [] };
}

/** What the card reads: the brief, each filed message with its coverage, and the per-turn history. */
export function briefView(state) {
  const rows = viewRows(state);
  return { ...(state.delegated ? { delegated: true } : {}), v: 1, rev: state.rev, ...(state.revising ? { revising: state.revising } : {}), turn: state.turn, updatedTurn: state.updatedTurn, items: rows.items, messages: rows.messages,
    title: taskTitle(state), tasks: Array.isArray(state.tasks) ? state.tasks.slice(-8) : [], versions: Array.isArray(state.versions) ? state.versions : [] };
}

export function parseBriefView(value) {
  if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.items) || !Array.isArray(value.messages)) throw new Error('Invalid Deep PTC task brief view');
  return { ...value, versions: Array.isArray(value.versions) ? value.versions : [] };
}

// ---- Runtime ----------------------------------------------------------------------------------

/** The runtime the preset row's tool uses; set once the profile-level layer is installed. */
export const briefRuntime = { api: undefined };

let messageFactory;
async function createMessage(content, summary) {
  messageFactory ??= importHost('@deepseek-ai/dsh-llm').then(module => module.createUserMessage).catch(() => undefined);
  const create = await messageFactory;
  const source = { kind: BRIEF_SOURCE, form: 'notice', summary };
  return typeof create === 'function' ? create({ content, source }) : { id: randomUUID(), role: 'user', content, source };
}

export async function sessionRecords() {
  const { appendPluginRecord } = await importHost('@deepseek-ai/dsh-session');
  if (typeof appendPluginRecord !== 'function') throw new Error('the installed session module has no appendPluginRecord');
  return appendPluginRecord;
}

/**
 * @param options - `{ enabled, watch }`: the setting getter and its change subscription.
 */
export function apply(ctx, options = {}) {
  const enabled = () => { try { return options.enabled?.() !== false; } catch { return true; } };
  const runtime = ctx.plugin({ name: 'deep-ptc-brief-layer', inject: ['commands', 'sessionProjections'],
    apply: child => install(child, sessionRecords, { ...options, enabled }) }).await()
    .catch(error => ctx.logger.warn('Deep PTC: the task brief is off (%s)', error.message));
  const prompt = ctx.plugin({ name: 'deep-ptc-brief-prompt', inject: ['systemPrompt'], apply: child => {
    gated(child, enabled, options.watch, () => {
      const section = child.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER,
        text: ({ agent }) => sectionText(ctx, agent) });
      // The brief itself changes as the model files it, so it rides in the runtime-context snapshot:
      // a change appends the small snapshot instead of re-sending the whole system prompt.
      const brief = child.systemPrompt.context({ name: 'deep-ptc:task-brief-state', order: BRIEF_CONTEXT_ORDER, required: true,
        text: ({ agent }) => briefContextText(ctx, agent) });
      const reminder = child.systemPrompt.context({ name: 'deep-ptc:task-brief-reminder', order: REMINDER_ORDER,
        text: ({ agent }) => reminderText(ctx, agent) });
      return () => { section?.(); brief?.(); reminder?.(); };
    }, 'Deep PTC: task brief prompt');
  } }).await().catch(error => ctx.logger.warn('Deep PTC: the task brief is not in the prompt (%s)', error.message));
  return Promise.all([runtime, prompt]);
}

function stateOf(agent) {
  const api = briefRuntime.api;
  return api === undefined || agent?.session === undefined ? undefined : api.read(agent.session);
}

/** The fixed guidance: the same text on every request, so the system prompt stays cached. */
export function sectionText(ctx, agent) {
  return isDeepPtcSession(ctx, agent?.session) && !isSubagentSession(agent.session) ? BRIEF_GUIDANCE : '';
}

/** The current brief, for the runtime-context snapshot. */
export function briefContextText(ctx, agent) {
  try {
    if (isSubagentSession(agent?.session) || !isDeepPtcSession(ctx, agent?.session)) return '';
    const state = stateOf(agent);
    if (!state) return '';
    return [stateText(state), state.revising && ('Revise ' + state.revising.item.id + ' «' + state.revising.item.text + '» and ask again. User feedback: ' + state.revising.feedback)].filter(Boolean).join('\n');
  } catch (error) {
    ctx.logger?.warn?.('Deep PTC: task brief unreadable (%s)', error.message);
    return '';
  }
}

// Steps since the latest human message, per live session, for the reminder.
const pace = new WeakMap();
export function reminderText(ctx, agent) {
  try {
    const row = pace.get(agent?.session);
    if (row === undefined || isSubagentSession(agent.session) || row.steps < 1 || row.shown >= 2 || !isDeepPtcSession(ctx, agent.session)) return '';
    const state = stateOf(agent);
    const message = state?.messages.find(item => item.ref === row.ref);
    if (message === undefined || !substantive(message.text) || message.seq <= state.since) return '';
    if (message.skipped?.length || state.items.some(item => item.from === message.ref)) return '';
    row.shown += 1;
    return `The user's latest message ${message.ref} is not in the task brief. Before your next tool call, file its goals, constraints and acceptance criteria as individually reviewable task_brief items (quote their words; mark implicit needs inferred). If it truly holds no task content, skip its text instead.`;
  } catch { return ''; }
}

export async function install(ctx, records = sessionRecords, options = {}) {
  const appendPluginRecord = await records();
  const projection = await ctx.sessionProjections.register({ key: BRIEF_KEY, stateVersion: 7, stateSchema: { parse: parseBrief },
    init: header => ({ ...blankBrief(), ...(isSubagentSession({ header }) ? { delegated: true } : {}) }), apply: foldBrief, wire: { viewSchema: { parse: parseBriefView }, view: briefView, summary: false } });
  ctx.effect(() => () => projection.dispose());
  const enabled = () => { try { return options.enabled?.() !== false; } catch { return true; } };
  const read = session => projection.stateOf(session) ?? blankBrief();
  const save = (session, brief, feedback, extra) => appendPluginRecord(session, BRIEF_EVENT, briefRecord(brief, feedback, extra));
  const api = { ctx, read, save, enabled, waits: options.waits };
  briefRuntime.api = api;
  ctx.effect(() => () => { if (briefRuntime.api === api) briefRuntime.api = undefined; });

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (humanMessage(event) && Number.isSafeInteger(event.seq)) pace.set(session, { ref: `m${event.seq}`, steps: 0, shown: 0 });
    else if (event?.type === 'assistant/message') { const row = pace.get(session); if (row) row.steps += 1; }
  }));
  ctx.effect(() => ctx.on('agent/pre-step', async (payload, next) => {
    try { if (enabled() && isDeepPtcSession(ctx, payload?.agent?.session)) await settleCondensing(ctx, api, payload.agent.session); }
    catch (error) { ctx.logger.warn('Deep PTC: condensing failed (%s)', error.message); }
    return typeof next === 'function' ? next() : undefined;
  }));
  ctx.commands.register({ name: BRIEF_COMMAND, recordInput: false,
    description: '编辑本次任务卡 / Edit the task brief',
    handler: async ({ agent, rawInput }) => {
      const finish = options.waits?.delivering(agent?.session?.id);
      try { return await command(api, agent, rawInput); } finally { finish?.(); }
    } });
}

/**
 * Apply pending condense and restore marks to the model's history: replace the message's node
 * with its stub, or the stub with the original content. Runs before a model request.
 */
export async function settleCondensing(ctx, api, session) {
  let state = api.read(session);
  if (!state.messages.some(message => message.pending)) return;
  const visible = new Set(Array.isArray(session.surface?.nodes) ? session.surface.nodes : []);
  const messages = [];
  for (const message of state.messages) {
    if (!message.pending) { messages.push(message); continue; }
    const { pending, ...rest } = message;
    try {
      if (pending === 'condense' && !message.condensed && visible.has(message.seq)) {
        const stub = await createMessage([{ type: 'text', text: stubText(state, message) }], `任务卡替身 · ${message.ref}`);
        const event = session.append('user/message', stub, { surfaceOp: { op: 'replace', startSeq: message.seq, endSeq: message.seq }, sourceEventSeqs: [message.seq] });
        messages.push({ ...rest, condensed: true, stubSeq: event.seq });
        continue;
      }
      if (pending === 'restore' && message.condensed && Number.isSafeInteger(message.stubSeq) && visible.has(message.stubSeq)) {
        const original = session.eventAt(message.seq);
        const restored = await createMessage(original.data.content, `原话已恢复 · ${message.ref}`);
        session.append('user/message', restored, { surfaceOp: { op: 'replace', startSeq: message.stubSeq, endSeq: message.stubSeq }, sourceEventSeqs: [message.stubSeq, message.seq] });
        const { condensed: _c, stubSeq: _s, ...plain } = rest;
        messages.push(plain);
        continue;
      }
    } catch (error) {
      ctx.logger.warn('Deep PTC: could not %s %s (%s)', pending, message.ref, error.message);
    }
    // Nothing to do (compacted away, already in place) or it failed: drop the mark.
    messages.push(rest);
  }
  state = { ...state, messages };
  await api.save(session, state);
}

const shortDate = date => `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;

/**
 * Finish or give up the current task: record it in the project cards (Completed tasks, T…), leave a
 * receipt in the chat and empty the brief for the next task. The items stay in the receipt and the log.
 * Recording is best effort: with project cards off or unwritable, the task still closes.
 * @returns the `completed` summary stored in the record.
 */
export async function completeTask(api, agent, state, { status = 'done', summary, title, byUser = false } = {}) {
  const dropped = status === 'dropped';
  const checkable = item => item.status === 'open' && (item.section === 'goal' || item.section === 'acceptance');
  const open = state.items.filter(checkable);
  // The model completes only what it has checked; the user's word marks the open checks done.
  if (!dropped && !byUser && open.length > 0) {
    throw new Error(`Verify and mark the finished goal and acceptance items first (task_brief update done: [${open.map(item => item.id).join(', ')}]), then complete. If the user gave the task up, use status dropped.`);
  }
  const items = state.items.filter(item => item.status !== 'dropped')
    .map(item => !dropped && byUser && checkable(item) ? { ...item, status: 'done' } : item);
  if (items.length === 0) throw new Error('The task brief is empty; there is no task to complete');
  const name = clip(title, 60) || taskTitle(state);
  const note = clip(summary, 200);
  const at = new Date();
  let record;
  try {
    const result = await projectToolDefinition().execute({ action: 'write', card: 'tasks', mode: 'append',
      items: [{ text: `${name}${note ? ` — ${note}` : ''} (${shortDate(at)})`, status: dropped ? 'dropped' : 'done' }] }, { agent });
    record = /\+(T\d+)/u.exec(result?.changes ?? '')?.[1];
  } catch (error) {
    api.ctx.logger?.warn?.('Deep PTC: the finished task is not in the project cards (%s)', error.message);
  }
  const count = section => items.filter(item => item.section === section).length;
  const doneCount = section => items.filter(item => item.section === section && item.status === 'done').length;
  const completed = { status: dropped ? 'dropped' : 'done', title: name, ...(note ? { summary: note } : {}), ...(record ? { record } : {}), at: at.toISOString(),
    counts: { goal: count('goal'), goalDone: doneCount('goal'), acceptance: count('acceptance'), acceptanceDone: doneCount('acceptance'), constraint: count('constraint') },
    items: items.map(({ id, section, text, status: itemStatus }) => ({ id, section, text, status: itemStatus })) };
  const since = Math.max(-1, ...state.messages.map(message => message.seq ?? -1));
  const { revising: _r, ...rest } = state;
  await api.save(agent.session, { ...rest, rev: state.rev + 1, updatedTurn: state.turn, items: [], since }, undefined, { completed });
  return completed;
}

const ok = text => ({ kind: 'success', text });
const fail = text => ({ kind: 'error', text });

/** One edit from the brief card. */
export async function command(api, agent, rawInput) {
  const session = agent?.session;
  if (!session) return fail(NO_SESSION);
  if (isSubagentSession(session)) return fail(REPORT_TO_PARENT);
  if (!api.enabled()) return fail('The task brief is turned off in settings. / 任务卡已在设置中关闭。');
  if (!isDeepPtcSession(api.ctx, session)) return fail(WRONG_MODE);
  let request;
  try { request = JSON.parse(String(rawInput ?? '')); } catch { return fail('Invalid request. / 无效的请求。'); }
  if (!isRecord(request)) return fail('Invalid request. / 无效的请求。');
  const state = api.read(session);
  if (Number.isSafeInteger(request.rev) && request.rev !== state.rev) return fail('The brief changed; check the latest version. / 任务卡已更新，请查看最新内容。');
  if (request.op === 'complete') {
    let done;
    try { done = await completeTask(api, agent, state, { status: request.status === 'dropped' ? 'dropped' : 'done', summary: request.summary, byUser: true }); }
    catch (error) { return fail(String(error?.message ?? error)); }
    const where = done.record ? ` and recorded as ${done.record} in the project cards (Completed tasks)` : '';
    await deliver(agent, { summary: (done.status === 'dropped' ? '任务卡 · 已放弃 ' : '任务卡 · 已完成 ') + done.title,
      text: `The user marked the task «${done.title}» ${done.status === 'dropped' ? 'abandoned' : 'complete'}. It is archived${where}. The task brief is now empty: file the next task when the user gives one.` }, BRIEF_SOURCE);
    return ok(done.status);
  }
  // Save an edit; when it ends the review, tell the model it can continue.
  const saveReview = async brief => {
    await api.save(session, brief);
    if (needsApproval(state) && !needsApproval(brief)) {
      try {
        await deliver(agent, { summary: '任务卡已审阅 · v' + brief.rev,
          text: 'The user finished reviewing task brief v' + brief.rev + '. Continue using the reviewed items in the current task brief.' }, BRIEF_SOURCE);
      } catch (error) { api.ctx.logger.warn('Deep PTC: brief review notice not delivered (%s)', error.message); }
    }
  };
  const head = pendingItem(state);
  // Confirm every remaining item at once; items offering versions still need their own choice.
  if (request.op === 'confirm-rest') {
    if (!needsApproval(state)) return fail('This review is already closed.');
    const ids = new Set(state.items.filter(item => isPending(item) && !item.review?.options).map(item => item.id));
    if (ids.size === 0) return fail('Choose a version for each remaining item.');
    await saveReview({ ...state, rev: state.rev + 1, updatedTurn: state.turn, items: state.items.map(item => ids.has(item.id) ? { ...item, basis: 'confirmed' } : item) });
    return ok('confirmed');
  }
  if (state.revising && ['confirm', 'edit', 'status', 'remove', 'rethink', 'condense'].includes(request.op)) return fail('Waiting for a revised proposal.');
  if (head && needsApproval(state)) {
    if (request.op === 'confirm') {
      if (request.ids && (!Array.isArray(request.ids) || request.ids.length !== 1 || request.ids[0] !== head.id)) return fail('Review the current item first.');
      request.ids = [head.id];
    }
    if (request.id && request.id !== head.id && ['rethink', 'edit', 'status', 'remove'].includes(request.op)) return fail('Review the current item first.');
    if (request.op === 'condense' && state.items.filter(item => item.status === 'open' && item.basis !== 'confirmed').length > 1) return fail('Review each item before condensing.');
  }
  if (head?.review?.options && ['confirm', 'edit', 'condense', 'status'].includes(request.op)) {
    if (request.op !== 'confirm' || request.rev !== state.rev) return fail('Select a version of the current task draft.');
    const chosen = head.review.options.find(option => option.value === request.choice);
    if (!chosen) return fail('Choose one of the offered versions.');
    const items = state.items.map(row => row === head ? { ...row, text: chosen.text, basis: 'confirmed', selected: chosen.value } : row);
    await api.save(session, { ...state, rev: state.rev + 1, updatedTurn: state.turn, items });
    await deliver(agent, { summary: '任务卡 · ' + chosen.label, text: 'The user selected ' + chosen.label + ' for task item ' + head.id + ': ' + chosen.text }, BRIEF_SOURCE);
    return ok('confirmed');
  }
  if (request.op === 'rethink') {
    if (!needsApproval(state)) return fail('This review is already closed.');
    const feedback = String(request.feedback ?? '').trim().slice(0, 1000);
    const note = feedback || '请重新整理这个条目再询问。';
    await api.save(session, { ...state, rev: state.rev + 1, items: state.items.filter(item => item.id !== head.id),
      revising: { item: head, feedback: note } }, note);
    await deliver(agent, { summary: '任务卡 · 请重新拟定 ' + head.id,
      text: 'The user requested a revision to ' + head.id + ' «' + head.text + '». Their input is feedback, not approval. ' +
        'Use task_brief update with the revised item, id ' + head.id + ', and ask again before proceeding to another item.' + FEEDBACK_START + note }, REVISION_SOURCE);
    return ok('returned');
  }
  if (request.op === 'condense' || request.op === 'restore') {
    const wanted = request.ref === 'all' ? activeMessages(state).filter(message => request.op === 'condense'
      ? !message.condensed && state.items.some(item => item.from === message.ref) : message.condensed)
      : state.messages.filter(message => message.ref === request.ref);
    if (wanted.length === 0) return fail(request.op === 'condense' ? 'No filed message to condense. / 没有可精简的消息。' : 'Nothing to restore. / 没有可恢复的消息。');
    const refs = new Set(wanted.map(message => message.ref));
    // Condensing is the user's check that the brief is right: their items become confirmed.
    const items = request.op === 'condense' ? state.items.map(item => refs.has(item.from) && item.basis === 'user' ? { ...item, basis: 'confirmed' } : item) : state.items;
    const messages = state.messages.map(message => refs.has(message.ref) ? { ...message, pending: request.op } : message);
    await saveReview({ ...state, rev: state.rev + 1, updatedTurn: state.turn, items, messages });
    return ok(request.op === 'condense' ? 'condense' : 'restore');
  }
  const result = applyUserEdit(state, request, state.turn);
  if (result.error) return fail(result.error);
  if (request.op === 'remove' && head?.id === request.id) {
    if (head.quote && head.from) {
      result.brief.messages = result.brief.messages.map(row => row.ref === head.from
        ? { ...row, skipped: [...new Set([...(row.skipped ?? []), head.quote])] } : row);
    }
    await api.save(session, result.brief);
    await deliver(agent, { summary: '任务卡 · 不设置 ' + head.id,
      text: 'The user declined task item ' + head.id + ' «' + head.text + '». Leave it out of the brief.' }, BRIEF_SOURCE);
    return ok('declined');
  }
  await saveReview(result.brief);
  return ok(`v${result.brief.rev}`);
}

// ---- The tool ---------------------------------------------------------------------------------

async function assignTask(ctx, exec, args) {
  const target = typeof args.child === 'string' ? args.child.trim() : '';
  const title = clip(args.title, 120);
  if (!target || !title || !Array.isArray(args.items) || !args.items.length || args.items.length > MAX_ITEMS) {
    throw new Error('assign requires a direct child id, a title and 1–40 task items.');
  }
  const lines = args.items.map(item => {
    const text = clip(item?.text, MAX_TEXT);
    if (!text || !SECTIONS.includes(item.section) || item.section === 'question') {
      throw new Error('Each assignment item needs text and a goal, constraint, acceptance or context section.');
    }
    return '- ' + item.section + ': ' + text;
  });
  if (!args.items.some(item => item.section === 'goal')) throw new Error('Give the child at least one concrete goal.');
  const host = ctx.get('subagents');
  if (typeof host?.sendMessage !== 'function') throw new Error('Subagent message delivery is unavailable.');
  const childId = typeof host.resolveName === 'function' ? await host.resolveName(exec.agent, target, exec.signal) : target;
  const children = typeof host.listChildren === 'function' ? await host.listChildren(exec.agent.id, exec.signal)
    : (await host.listDescendants(exec.agent.id, exec.signal)).filter(row => row.depth === 1);
  if (!children.some(row => row.id === childId && row.mode === 'continuable')) {
    throw new Error('Choose one of your direct continuable subagents from list_agents.');
  }
  const text = ['[Deep PTC task assignment]', title, ...lines].join('\n');
  const messageId = await host.sendMessage(exec.agent, childId, [{ type: 'text', text }], { signal: exec.signal });
  return { child: childId, messageId, status: 'assigned' };
}

/** The task_brief tool, bound to the shared runtime at call time. */
export function briefToolDefinition(runtime = briefRuntime) {
  const item = { type: 'object', additionalProperties: false, required: ['text'], properties: {
    id: { type: 'string', description: 'Existing item id (G1, C2, …) to reword; omit for a new item.' },
    ...versionFields({ text: { type: 'string', description: 'Exact task item to file if chosen.' } }, ['text']),
    section: { type: 'string', enum: SECTIONS, description: 'New items: goal, constraint, acceptance, context or question.' },
    text: { type: 'string', description: 'One self-contained fact in the user\'s language, up to 300 characters.' },
    quote: { type: 'string', description: 'The user\'s words this item restates, copied exactly from their message.' },
    from: { type: 'string', description: 'Message ref (m…) the quote is from; default: the newest message containing it.' },
    inferred: { type: 'boolean', description: 'true for an implicit need the user did not state; no quote.' },
  } };
  return {
    name: BRIEF_TOOL,
    resident: true,
    description: 'File the user\'s goals, constraints, acceptance criteria, context and open questions into this conversation\'s task brief, the checklist you work and verify against. update adds or rewords items. Write each item’s question in the user’s language; offer usable versions with exact text, labels and consequences whenever more than one draft makes sense (quote the user verbatim, or mark inferred), marks items done, removes items and skips text with no task content; it returns any unfiled text. clarify asks the user to choose between plausible interpretations before any item is filed. read returns the brief with coverage; source returns a user message\'s original text, including condensed ones. assign sends a structured task card to one of your continuable direct subagents using its name or id from list_agents. Include only that child’s scope, constraints and acceptance criteria. complete archives the finished (or dropped) task to the project cards and empties the brief for the next task.',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      questions: reviewQuestions,
      title: { type: 'string', description: 'Assignment title for assign.' },
      child: { type: 'string', description: 'assign: name or id of your continuable direct subagent. Give a concrete goal and include scope limits and acceptance checks when relevant.' },
      action: { type: 'string', enum: ['update', 'read', 'source', 'clarify', 'complete', 'assign'] },
      status: { type: 'string', enum: ['done', 'dropped'], description: 'complete: done (default) or dropped when the user gave the task up.' },
      summary: { type: 'string', description: 'complete: one line on the outcome, up to 200 characters.' },
      items: { type: 'array', items: item, description: 'Up to 40 items in the whole brief.' },
      done: { type: 'array', items: { type: 'string' }, description: 'Ids of items now finished and verified.' },
      remove: { type: 'array', items: { type: 'string' }, description: 'Ids of items no longer wanted.' },
      skip: { type: 'array', description: 'Spans of user text with no task content (greetings, filler).', items: { type: 'object', additionalProperties: false,
        required: ['quote'], properties: { quote: { type: 'string' }, from: { type: 'string' } } } },
      ref: { type: 'string', description: 'source: the message ref (m…).' },
    } },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const api = runtime.api;
      if (api === undefined) throw new Error('The task brief is not ready yet; try again in a moment');
      if (!api.enabled()) throw new Error('The task brief is turned off in settings');
      const session = exec.agent?.session;
      if (!session) throw new Error('No active conversation');
      if (isSubagentSession(session) && args.action !== 'read' && args.action !== 'source') throw new Error(REPORT_TO_PARENT);
      if (args.action === 'assign') return assignTask(api.ctx, exec, args);
      const state = api.read(session);
      if (args.action === 'clarify' || (args.action === 'update' && args.questions !== undefined)) {
        return clarifyReview('brief', args, exec);
      }
      if (args.action === 'read') {
        return { rev: state.rev, items: state.items, unfiled: openCoverage(state),
          messages: state.messages.map(message => ({ ref: message.ref, turn: message.turn, ...message.condensed ? { condensed: true } : {} })) };
      }
      if (args.action === 'source') {
        if (typeof args.ref !== 'string' || !REF.test(args.ref)) throw new Error('source needs ref, e.g. m42');
        const message = state.messages.find(row => row.ref === args.ref);
        let text = message?.text;
        try { text = messageText(session.eventAt(Number(args.ref.slice(1)))?.data).slice(0, MAX_MESSAGE) || text; } catch { /* the folded copy */ }
        if (!text) throw new Error(`Unknown message ${args.ref}`);
        return { ref: args.ref, text };
      }
      if (args.action === 'complete') {
        const done = await completeTask(api, exec.agent, state, { status: args.status, summary: args.summary, title: args.title });
        return { archived: done.record ?? 'in this conversation', status: done.status, title: done.title,
          next: 'The brief is empty. File the next task when the user gives one.' };
      }
      if (args.action !== 'update') throw new Error('action must be update, read, source, clarify or complete');
      const revision = state.revising;
      if (revision && (args.done?.length || args.remove?.length || args.items?.length !== 1 || (args.items[0]?.id && args.items[0].id !== revision.item.id))) {
        throw new Error('Revise only ' + revision.item.id + ' using the user feedback: ' + revision.feedback);
      }
      const input = revision ? { ...args, items: [{ ...args.items[0], id: revision.item.id }] } : args;
      const base = revision ? { ...state, revising: undefined, items: [revision.item, ...state.items] } : state;
      const result = applyUpdate(base, input, state.turn);
      if (revision && result.rejected.length) throw new Error(result.rejected.join('; '));
      if (revision && result.brief === base) result.brief = { ...base, rev: state.rev + 1, updatedTurn: state.turn };
      if (result.brief !== state) await api.save(session, result.brief);
      if (result.brief !== state && needsApproval(result.brief)) {
        api.waits?.add(exec, () => api.enabled() && needsApproval(api.read(session)));
      }
      const unfiled = openCoverage(result.brief);
      return { rev: result.brief.rev, changes: result.text || 'none',
        ...result.rejected.length ? { rejected: result.rejected } : {},
        ...unfiled.length ? { unfiled, next: 'File the unfiled text as items, or skip it if it holds no task content.' } : { coverage: 'every filed message is fully accounted for' },
        ...allDone(result.brief) && !needsApproval(result.brief) ? { finished: 'Every goal and acceptance item is done. Once the work is verified, call task_brief action=complete with a one-line summary.' } : {} };
    },
  };
}
