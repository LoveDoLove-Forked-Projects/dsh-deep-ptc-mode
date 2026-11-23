// Follows live conversations and says when something starts or stops waiting for the user, and when a
// turn finishes. The desktop notice and the DSH Go mirror both listen here.
//
// Sources are the plugin's own session records, read after they are folded; nothing is polled. Only
// what is asked while this process runs is announced: opening an old conversation announces nothing.

import { basename } from 'node:path';
import { briefRuntime, BRIEF_EVENT } from './brief-context.mjs';
import { CARDS_EVENT } from './card-state.mjs';
import { cardsRuntime } from './cards-context.mjs';
import { briefDecisions, cardDecisions, commandFor, dismissLine, hostLanguage, projectDecisions } from './decisions.mjs';
import { deliver } from './model-view.mjs';
import { PROJECT_EVENT, projectRuntime, PROPOSAL_EVENT } from './project-context.mjs';
import { isDeepPtcSession } from './session-preset.mjs';
import { isSubagentSession } from './subagent-interaction.mjs';

const RECORDS = new Set([CARDS_EVENT, BRIEF_EVENT, PROJECT_EVENT, PROPOSAL_EVENT, 'turn/start', 'turn/end']);
const SETTLE_MS = 40;
// A queued message or a finished background job opens the next turn right away: that is not the end.
const IDLE_MS = 700;

const safe = (fn, fallback) => { try { return fn() ?? fallback; } catch { return fallback; } };

/** Everything that waits for the user in one conversation now. */
export function decisionsOf(session, language = hostLanguage()) {
  const own = !isSubagentSession(session);
  const cards = safe(() => {
    const store = cardsRuntime.store;
    const state = store?.read(session);
    return cardDecisions(state, language).filter(decision => store.enabled(state.versions.find(row => decision.key === `card:${row.id}:${row.rev}`)?.review));
  }, []);
  const brief = safe(() => own && briefRuntime.api?.enabled() ? briefDecisions(briefRuntime.api.read(session), language) : [], []);
  const project = safe(() => own && projectRuntime.api?.enabled() ? projectDecisions(projectRuntime.api.stateOf(session), session.id, language) : [], []);
  return [...cards, ...brief, ...project];
}

// Host command texts read `English / 中文`; show the half the user reads.
const localized = (text, language) => {
  const parts = String(text ?? '').replace(/^\[dpt:[^\]]*\] ?/u, '').split(' / ');
  return parts.length === 2 ? parts[language === 'zh' ? 1 : 0] : parts.join(' / ');
};

export function installAttention(ctx, options = {}) {
  const language = options.language ?? hostLanguage();
  const sessions = new Map();
  const listeners = { open: new Set(), close: new Set(), done: new Set() };
  const timers = new Set();
  const on = kind => listener => { listeners[kind].add(listener); return () => listeners[kind].delete(listener); };
  const emit = (kind, entry) => {
    for (const listener of listeners[kind]) {
      try { listener(entry); } catch (error) { ctx.logger?.warn?.('Deep PTC: a notice failed (%s)', error?.message); }
    }
  };
  const later = (fn, ms) => {
    const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms);
    timer.unref?.();
    timers.add(timer);
  };
  const agentOf = id => safe(() => ctx.get('agents')?.get?.(id));
  const placeOf = session => basename(String(session?.header?.cwd ?? session?.cwd ?? '').replace(/[\\/]+$/u, ''));

  function refresh(session) {
    const row = sessions.get(session.id);
    if (row === undefined) return;
    row.scheduled = false;
    const now = new Map(decisionsOf(session, language).map(decision => [decision.key, decision]));
    for (const [key, entry] of row.current) {
      if (now.has(key)) { entry.decision = now.get(key); continue; }
      row.current.delete(key);
      row.settled = { group: entry.decision.group, at: Date.now(), via: entry.via };
      emit('close', entry);
    }
    for (const [key, decision] of now) {
      if (row.current.has(key)) continue;
      const entry = { id: `${session.id}|${key}`, key, sessionId: session.id, session, agent: agentOf(session.id), place: placeOf(session), decision,
        fresh: !Number.isSafeInteger(decision.since) || decision.since >= row.firstSeq,
        // The next item of a review the user is walking through: no second chime, and it stays where they are.
        follows: row.settled?.group === decision.group && Date.now() - row.settled.at < 1500 ? row.settled.via ?? 'chat' : undefined };
      row.current.set(key, entry);
      emit('open', entry);
    }
  }

  ctx.on('session/event', (session, event) => {
    if (!RECORDS.has(event?.type)) return;
    let row = sessions.get(session.id);
    if (row === undefined) sessions.set(session.id, row = { session, firstSeq: event.seq ?? 0, current: new Map(), scheduled: false });
    row.session = session;
    if (event.type === 'turn/end' && !isSubagentSession(session) && event.data?.reason?.kind !== 'aborted' && isDeepPtcSession(ctx, session)) {
      const failed = event.data?.reason?.kind === 'error';
      later(() => {
        const agent = agentOf(session.id);
        if (agent?.status === 'running' || agent?.inbox?.hasPending) return;
        emit('done', { sessionId: session.id, place: placeOf(session), failed });
      }, IDLE_MS);
    }
    if (row.scheduled) return;
    row.scheduled = true;
    later(() => refresh(session), SETTLE_MS);
  });
  const unwatch = options.watch?.(() => { for (const row of sessions.values()) later(() => refresh(row.session), SETTLE_MS); });
  ctx.effect(() => () => { unwatch?.(); for (const timer of timers) clearTimeout(timer); timers.clear(); sessions.clear(); }, 'Deep PTC: attention');

  const entryOf = id => {
    for (const row of sessions.values()) for (const entry of row.current.values()) if (entry.id === id) return entry;
    return undefined;
  };
  async function run(entry, line, via) {
    const agent = agentOf(entry.sessionId);
    const commands = ctx.get('commands');
    if (agent === undefined || typeof commands?.execute !== 'function') {
      return { error: language === 'zh' ? '这个对话已不在运行，请回到 DSH 里操作。' : 'This conversation is no longer loaded; continue in DSH.' };
    }
    entry.via = via;
    try {
      const outcome = await commands.execute(agent, line, [], new AbortController().signal);
      if (outcome?.result?.kind === 'success') return {};
      entry.via = undefined;
      return { error: localized(outcome?.result?.text, language) || 'failed' };
    } catch (error) {
      entry.via = undefined;
      return { error: String(error?.message ?? error) };
    }
  }

  return {
    language,
    onOpen: on('open'), onClose: on('close'), onDone: on('done'),
    list: () => [...sessions.values()].flatMap(row => [...row.current.values()]),
    /** Apply one answer through the decision's host command. Never throws: `{}` or `{ error }`. */
    async submit(id, button, values, via) {
      const entry = entryOf(id);
      // Already settled elsewhere: nothing left to do here.
      if (entry === undefined) return {};
      const command = commandFor(entry.decision, button, values);
      return command.error ? { error: localized(command.error, language) } : run(entry, command.line, via);
    },
    /** Close a decision without choosing, with the user's words when they wrote some. Never throws. */
    async dismiss(id, said, via) {
      const entry = entryOf(id);
      const line = entry && dismissLine(entry.decision);
      if (!line) return {};
      if (said) {
        try {
          await deliver(agentOf(entry.sessionId), { summary: entry.decision.title,
            text: `The user answered card «${entry.decision.title}» in their own words instead of a button: «${said}». Follow their words.` });
        } catch (error) { ctx.logger?.warn?.('Deep PTC: a written card answer was not delivered (%s)', error?.message); }
      }
      return run(entry, line, via);
    },
  };
}
