// Deep sleep mode: a per-conversation switch the user flips in the side panel.
//
// The mode has four phases besides off:
//   asking  the model is gathering every open question into one batch of cards;
//   ready   every card is answered and the model starts the unattended run;
//   running the host goal drives new rounds until the model completes it;
//   done    the objective is complete or blocked; the switch stays on for the next task.
//
// The projection only stores what the side panel and the prompt need: the switch, the phase, the
// batch (card ids and titles, never the questions again), the answers counted, the objective and the
// goal round reached. Everything is folded from small records, so a reload, a fork or a replayed log
// shows the same state, and a malformed record changes nothing.

export const SLEEP_EVENT = 'plugin:dsh-deep-ptc-mode/deep-sleep';
export const SLEEP_KEY = 'deepPtcSleep';
export const SLEEP_COMMAND = 'deep-ptc-sleep';
export const SLEEP_TOOL = 'deep_sleep';
export const STATE_VERSION = 1;

// asking -> ready -> confirming -> running -> done. 'confirming' waits on the confirmation card;
// a user message during the run returns the mode to 'asking' (reopen) so new information is briefed
// and confirmed before the run continues.
export const SLEEP_PHASES = ['off', 'asking', 'ready', 'confirming', 'running', 'done'];
/** Cards in one batch: enough to cover the goal, background, route, constraints and acceptance. */
export const MAX_SLEEP_CARDS = 8;
/** Rounds one unattended run may start; the host's own goal cap defaults to 256. */
export const DEFAULT_SLEEP_ROUNDS = 256;
export const DEFAULT_SLEEP_ROUNDS_MAX = 512;
export const MAX_OBJECTIVE = 500;
export const MAX_REASON = 300;
const MAX_TITLE = 120;
const MAX_CARDS = 8;
const SERIES_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/u;

export function blankSleep() {
  return { v: STATE_VERSION, on: false, phase: 'off', lastPhase: undefined, series: undefined, cards: [], answered: 0,
    objective: '', goalId: undefined, rounds: 0, runs: 0, reason: undefined, at: 0 };
}

/** Phases a switch turned back on returns to; any other previous phase starts a new run. */
const RESUMABLE = new Set(['asking', 'ready', 'confirming', 'running']);

const cleanText = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

function readCard(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const id = cleanText(value.id, 64);
  if (id === '') return undefined;
  const row = { id, title: cleanText(value.title, MAX_TITLE), count: Number.isSafeInteger(value.count) ? Math.max(0, value.count) : 0 };
  return row;
}

/** Records the plugin appends; the fold below is the only reader. */
export const records = {
  toggle: (on, at) => ({ v: STATE_VERSION, op: 'toggle', on: on === true, at }),
  briefing: ({ series, cards, at }) => ({ v: STATE_VERSION, op: 'briefing', series, cards, at }),
  answered: (card, at) => ({ v: STATE_VERSION, op: 'answered', card, at }),
  confirm: at => ({ v: STATE_VERSION, op: 'confirm', at }),
  revise: at => ({ v: STATE_VERSION, op: 'revise', at }),
  reopen: (reason, at) => ({ v: STATE_VERSION, op: 'reopen', reason, at }),
  start: ({ objective, goalId, at }) => ({ v: STATE_VERSION, op: 'start', objective, goalId, at }),
  round: (round, at) => ({ v: STATE_VERSION, op: 'round', round, at }),
  complete: at => ({ v: STATE_VERSION, op: 'complete', at }),
  blocked: ({ reason, at }) => ({ v: STATE_VERSION, op: 'blocked', reason, at }),
};

function rearmed(state, at) {
  return { ...state, on: true, phase: 'asking', series: undefined, cards: [], answered: 0, reason: undefined, at };
}

/** Fold one session event; anything unrecognised, malformed or out of order changes nothing. */
export function foldSleep(state, event) {
  if (event.type !== SLEEP_EVENT || event.data === null || typeof event.data !== 'object') return state;
  const record = event.data;
  if (record.v !== STATE_VERSION) return state;
  const at = Number.isSafeInteger(record.at) && record.at > 0 ? record.at : state.at;
  switch (record.op) {
    case 'toggle':
      // Off then on again continues what was going on (a paused run resumes); a finished or fresh
      // run starts over with a new batch.
      if (record.on === true) {
        return RESUMABLE.has(state.lastPhase)
          ? { ...state, on: true, phase: state.lastPhase, lastPhase: undefined, reason: undefined, at }
          : { ...rearmed(state, at), lastPhase: undefined };
      }
      return { ...state, on: false, phase: 'off', lastPhase: state.phase === 'off' ? state.lastPhase : state.phase, at };
    case 'briefing': {
      if (state.on !== true) return state;
      if (typeof record.series !== 'string' || !SERIES_ID.test(record.series)) return state;
      if (!Array.isArray(record.cards) || record.cards.length === 0 || record.cards.length > MAX_CARDS) return state;
      const cards = record.cards.map(readCard);
      if (cards.some(card => card === undefined)) return state;
      return { ...state, phase: 'asking', series: record.series, cards, answered: 0, at };
    }
    case 'answered': {
      if (state.on !== true || state.phase !== 'asking') return state;
      const id = cleanText(record.card, 64);
      if (!state.cards.some(card => card.id === id)) return state;
      const answered = Math.min(state.cards.length, state.answered + 1);
      return { ...state, answered, phase: answered >= state.cards.length ? 'ready' : 'asking', at };
    }
    case 'confirm':
      if (state.on !== true || state.phase === 'running' || state.phase === 'off') return state;
      return { ...state, phase: 'confirming', reason: undefined, at };
    case 'revise':
      if (state.on !== true || state.phase !== 'confirming') return state;
      return { ...state, phase: 'asking', at };
    case 'reopen':
      if (state.on !== true || state.phase === 'off') return state;
      return { ...state, phase: 'asking', reason: cleanText(record.reason, MAX_REASON) || undefined, at };
    case 'start': {
      if (state.on !== true) return state;
      const objective = cleanText(record.objective, MAX_OBJECTIVE);
      if (objective === '') return state;
      return { ...state, phase: 'running', objective, goalId: cleanText(record.goalId, 64) || undefined,
        rounds: Math.max(state.rounds, 0), runs: state.runs + 1, at };
    }
    case 'round': {
      if (!Number.isSafeInteger(record.round) || record.round < 1) return state;
      return record.round > state.rounds ? { ...state, rounds: record.round, at } : state;
    }
    case 'complete':
      if (state.on !== true) return state;
      return { ...state, phase: 'done', reason: undefined, at };
    case 'blocked':
      if (state.on !== true) return state;
      return { ...state, phase: 'done', reason: cleanText(record.reason, MAX_REASON) || 'blocked', at };
    default:
      return state;
  }
}

/** Validate a projected state (the host persists and replays it). */
export function parseSleepState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid deep sleep state');
  if (value.v !== STATE_VERSION || typeof value.on !== 'boolean' || !SLEEP_PHASES.includes(value.phase)) throw new Error('Invalid deep sleep state');
  if (!Array.isArray(value.cards) || !Number.isSafeInteger(value.answered) || typeof value.objective !== 'string') throw new Error('Invalid deep sleep state');
  if (value.lastPhase !== undefined && !SLEEP_PHASES.includes(value.lastPhase)) throw new Error('Invalid deep sleep state');
  if (!Number.isSafeInteger(value.rounds) || value.rounds < 0 || !Number.isSafeInteger(value.runs) || value.runs < 0) throw new Error('Invalid deep sleep state');
  if (value.answered < 0 || !Number.isSafeInteger(value.at) || value.at < 0) throw new Error('Invalid deep sleep state');
  return value;
}

/**
 * While deep sleep mode is on the user is away from item-by-item review: a filed brief is confirmed
 * as a whole and the deep-sleep confirmation card is the approval. Only the model's filing is
 * folded this way; the user's own edits in the panel stay their own decision.
 */
export function confirmBriefItems(brief) {
  if (brief === null || typeof brief !== 'object' || !Array.isArray(brief.items)) return brief;
  return { ...brief, items: brief.items.map(item => item.status === 'open' && item.basis !== 'confirmed' ? { ...item, basis: 'confirmed' } : item) };
}

/** The one-line status the panel and the tool share. */
export function sleepStatus(state) {
  if (state === undefined || state.on !== true) return 'off';
  return state.phase;
}
