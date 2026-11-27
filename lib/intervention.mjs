// What the user says to a subagent directly reaches its parent as an internal card: a record in the
// parent's log that enters the parent's context and is never drawn in the chat.
//
// - The subagent files it: `task_brief report` with the user's instructions as checkable items.
// - If it does not within two steps, waits for the user on a card, or ends its turn first, the user's
//   words are passed on as they are, so the parent always learns about them in time.
// - Every live ancestor receives the card; one that is not loaded receives it when it next runs.

import { CARDS_EVENT } from './card-state.mjs';
import { isSubagentSession } from './subagent-interaction.mjs';
import { hasDirectInput, ownSince } from './subagent-direct.mjs';
import { importHost } from './host.mjs';
import { isDeepPtcSession } from './session-preset.mjs';
import { CARD_SOURCE, quote } from './model-view.mjs';
import { messageText } from './task-brief.mjs';

export const INTERVENTION_EVENT = 'plugin:dsh-deep-ptc-mode/intervention';
export const INTERVENTION_KEY = 'deepPtcInterventions';
const CONTEXT_ORDER = 127;
const REMINDER_ORDER = 128;
// Internal cards kept in the parent's context; older ones stay in the log.
const KEEP = 6;
const MAX_WORDS = 1200;
const FALLBACK_STEPS = 2;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
// What the user chose, without the model-view scaffolding around it.
const answerOnly = text => text.split('\n').filter(line => /^\w+ = /u.test(line)).join('\n') || text;
const clip = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export const blankInterventions = () => ({ v: 1, next: 1, cards: [] });

/** Fold internal cards in the parent's log; a fork keeps its own list only. */
export function foldInterventions(state, event) {
  if (event?.type !== INTERVENTION_EVENT || !isRecord(event.data) || event.data.v !== 1 || event.seq < (state.own ?? 0)) return state;
  const { v: _v, ...card } = event.data;
  if (typeof card.child !== 'string' || !Array.isArray(card.words)) return state;
  // An organized card replaces the raw one for the same words.
  const cards = state.cards.filter(row => !(row.auto && row.child === card.child && row.key === card.key));
  return { ...state, next: state.next + 1, cards: [...cards, { ...card, id: `I${state.next}` }].slice(-KEEP) };
}

function parse(value) {
  if (!isRecord(value) || value.v !== 1 || !Array.isArray(value.cards)) throw new Error('Invalid Deep PTC interventions');
  return value;
}

/** The parent's view of the internal cards. */
export function interventionText(state) {
  if (!state?.cards?.length) return '';
  const lines = ['Internal cards: the user wrote to your subagents directly. These are the user’s words with full authority; the chat does not show these cards.',
    'Take them into account now: update the task brief, your plan and other subagents where they change scope, constraints or acceptance. Do not ask the user to repeat them, and do not undo them.'];
  for (const card of state.cards) {
    lines.push(`[${card.id}] subagent ${card.label ? `${quote(card.label)} ` : ''}${card.child}${card.title ? ` — ${card.title}` : ''}`);
    for (const words of card.words) lines.push(`  ${words.card ? 'card answer' : 'user'}: ${quote(words.text)}`);
    for (const item of card.items ?? []) lines.push(`  - ${item.section}: ${item.text}`);
    if (card.summary) lines.push(`  subagent: ${card.summary}`);
    if (card.auto) lines.push('  (passed on as written; the subagent has not organized it yet)');
  }
  return lines.join('\n');
}

/** The runtime task_brief report uses; set once the layer is installed. */
export const interventionRuntime = { report: undefined };

async function sessionRecords() {
  const { appendPluginRecord } = await importHost('@deepseek-ai/dsh-session');
  if (typeof appendPluginRecord !== 'function') throw new Error('the installed session module has no appendPluginRecord');
  return appendPluginRecord;
}

export function apply(ctx, options = {}) {
  return ctx.plugin({ name: 'deep-ptc-interventions', inject: ['sessionProjections', 'systemPrompt'], apply: child => install(child, options.records ?? sessionRecords) }).await()
    .catch(error => ctx.logger.warn('Deep PTC: direct messages to subagents are not passed to the parent (%s)', error.message));
}

export async function install(ctx, records = sessionRecords) {
  const append = await records();
  const projection = await ctx.sessionProjections.register({ key: INTERVENTION_KEY, stateVersion: 1, stateSchema: { parse },
    init: (_header, inherited) => ({ ...blankInterventions(), own: Number(inherited ?? 0) }), apply: foldInterventions });
  ctx.effect(() => () => projection.dispose());
  // Per subagent: the user's words not yet reported, and the model steps since the first of them.
  const open = new WeakMap();
  // Cards for an ancestor that is not loaded, by session id.
  const waiting = new Map();
  const agentOf = id => { try { return ctx.get('agents')?.get?.(id); } catch { return undefined; } };
  const parentOf = session => session?.header?.parentSession;

  async function store(id, card) {
    const session = agentOf(id)?.session;
    if (session === undefined) { waiting.set(id, [...waiting.get(id) ?? [], card]); return; }
    await append(session, INTERVENTION_EVENT, card);
  }
  async function flush(session) {
    const cards = waiting.get(session.id);
    if (cards === undefined) return;
    waiting.delete(session.id);
    for (const card of cards) await append(session, INTERVENTION_EVENT, card);
  }
  function ancestors(session) {
    const out = [];
    for (let id = parentOf(session); typeof id === 'string' && !out.includes(id) && out.length < 8; id = parentOf(agentOf(id)?.session)) out.push(id);
    return out;
  }
  const labelOf = session => clip(session?.header?.label ?? session?.header?.agentName ?? session?.header?.title, 120);

  async function send(session, row, filed = {}) {
    const card = { v: 1, child: session.id, ...labelOf(session) ? { label: labelOf(session) } : {}, key: row.key, words: row.words, ...filed };
    for (const id of ancestors(session)) {
      // A fresh snapshot per record: the log keeps its own copy.
      try { await store(id, structuredClone(card)); } catch (error) { ctx.logger?.warn?.('Deep PTC: an internal card did not reach %s (%s)', id, error?.message); }
    }
  }
  async function passOn(session, row) {
    if (row.passed === row.words.length) return;
    row.passed = row.words.length;
    await send(session, row, { auto: true });
  }

  ctx.effect(() => ctx.on('session/event', (session, event) => {
    if (waiting.has(session.id)) void flush(session).catch(error => ctx.logger?.warn?.('Deep PTC: internal cards not stored (%s)', error?.message));
    if (!isSubagentSession(session) || !isDeepPtcSession(ctx, session) || event?.seq < ownSince(session)) return;
    const row = open.get(session);
    if (event.type === 'user/message') {
      const card = event.data?.source?.kind === CARD_SOURCE;
      if (!hasDirectInput(event) && !card) return;
      const text = clip(card ? answerOnly(messageText(event.data)) : messageText(event.data), MAX_WORDS);
      if (text === '') return;
      const words = [...row?.words ?? [], { text, ...card ? { card: true } : {} }];
      open.set(session, { key: row?.key ?? `m${event.seq}`, steps: row?.steps ?? 0, passed: row?.passed ?? 0, words: words.slice(-8) });
    } else if (row !== undefined && event.type === CARDS_EVENT && event.data?.op === 'show') {
      void passOn(session, row);
    } else if (row !== undefined && event.type === 'assistant/message') {
      row.steps += 1;
      if (row.steps >= FALLBACK_STEPS) void passOn(session, row);
    } else if (row !== undefined && event.type === 'turn/end') {
      void passOn(session, row);
      open.delete(session);
    }
  }));

  ctx.systemPrompt.context({ name: 'deep-ptc:interventions', order: CONTEXT_ORDER, required: true, interpolate: false, text: ({ agent }) => {
    try { return isDeepPtcSession(ctx, agent?.session) ? interventionText(projection.stateOf(agent.session)) : ''; } catch { return ''; }
  } });
  ctx.systemPrompt.context({ name: 'deep-ptc:report-intervention', order: REMINDER_ORDER, text: ({ agent }) => {
    const row = agent?.session && open.get(agent.session);
    return row && row.reported !== row.words.length
      ? 'The user wrote to you directly. Before your next other tool call, tell the parent with task_brief action=report: title, the user’s instructions as items (quote their words), and summary (how it changes your assignment and what you will do). Then follow the user.' : '';
  } });

  const runtime = {
    /** task_brief report, called by the subagent. */
    async report(session, { title, items, summary }) {
      const row = open.get(session);
      if (row === undefined) throw new Error('There is no new message from the user in this conversation to report.');
      row.reported = row.words.length;
      row.passed = row.words.length;
      await send(session, row, { ...title ? { title } : {}, ...items.length ? { items } : {}, ...summary ? { summary } : {} });
      return { reported: ancestors(session).length, words: row.words.length };
    },
  };
  interventionRuntime.report = runtime.report;
  ctx.effect(() => () => { if (interventionRuntime.report === runtime.report) interventionRuntime.report = undefined; });
}
