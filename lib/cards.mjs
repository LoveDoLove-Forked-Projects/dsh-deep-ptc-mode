// Pure state and view logic for conversation cards.
//
// A card is a small panel the model leaves in the conversation: a title, labelled
// rows, a note and one optional action. The card lives in the session log, so it
// survives turns, and the client renders it at the end of the latest turn.

export const CARDS_KEY = 'deepPtcCards';
export const CARDS_EVENT = 'plugin:dsh-deep-ptc-mode/cards';
export const CARD_COMMAND = 'deep-ptc-card-act';
export const CARD_TOOL = 'ui_card';

export const OPEN = 'open';
export const STOPPING = 'stopping';
export const STOPPED = 'stopped';
export const FAILED = 'failed';
export const DISMISSED = 'dismissed';

const MAX_CARDS = 8;
const MAX_ID = 64;
const MAX_TITLE = 120;
const MAX_SUBTITLE = 160;
const MAX_LABEL = 40;
const MAX_VALUE = 300;
const MAX_LINES = 12;
const MAX_NOTE = 400;
const MAX_STOP_LABEL = 24;
const MAX_COMMAND = 2000;
const MAX_SCHEDULES = 8;
const MAX_SCHEDULE_ID = 120;

const objects = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

export function blankCards() {
  return { v: 1, seq: 0, cards: [] };
}

function readLines(value, issues) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LINES) {
    issues.push('lines: use at most ' + MAX_LINES + ' rows');
    return [];
  }
  const rows = [];
  value.forEach((row, index) => {
    const label = text(row?.label, MAX_LABEL);
    if (!objects(row) || label === '') {
      issues.push('lines.' + index + ': every row needs a label');
      return;
    }
    rows.push({ label, value: text(row.value, MAX_VALUE) });
  });
  return rows;
}

function readStop(value, issues) {
  if (value === undefined) return undefined;
  if (!objects(value)) {
    issues.push('stop: expected an object');
    return undefined;
  }
  const stop = {};
  const label = text(value.label, MAX_STOP_LABEL);
  if (label !== '') stop.label = label;
  const command = text(value.command, MAX_COMMAND);
  if (command !== '') stop.command = command;
  if (value.schedules !== undefined) {
    if (!Array.isArray(value.schedules) || value.schedules.length > MAX_SCHEDULES) {
      issues.push('stop.schedules: use at most ' + MAX_SCHEDULES + ' ids');
    } else {
      const ids = value.schedules.map(id => text(id, MAX_SCHEDULE_ID)).filter(id => id !== '');
      if (ids.length > 0) stop.schedules = ids;
    }
  }
  if (stop.command === undefined && stop.schedules === undefined) {
    issues.push('stop: a command or schedule ids are required');
    return undefined;
  }
  return stop;
}

/** Normalise one tool call into a card, or list what the model must fix. */
export function readCardInput(value) {
  if (!objects(value)) return { issues: ['expected an object'] };
  const issues = [];
  const card = { title: text(value.title, MAX_TITLE) };
  if (card.title === '') issues.push('title: required');
  const subtitle = text(value.subtitle, MAX_SUBTITLE);
  if (subtitle !== '') card.subtitle = subtitle;
  const lines = readLines(value.lines, issues);
  if (lines.length > 0) card.lines = lines;
  const note = text(value.note, MAX_NOTE);
  if (note !== '') card.note = note;
  if (value.tone === 'warn') card.tone = 'warn';
  else if (value.tone !== undefined && value.tone !== 'info') issues.push('tone: use info or warn');
  const stop = readStop(value.stop, issues);
  if (stop !== undefined) card.stop = stop;
  if (issues.length > 0) return { issues };
  if (card.subtitle === undefined && card.lines === undefined && card.note === undefined) {
    return { issues: ['a card needs a subtitle, lines or a note'] };
  }
  return { card };
}

function readCard(row) {
  if (!objects(row) || typeof row.id !== 'string' || row.id === '' || row.id.length > MAX_ID
    || typeof row.title !== 'string' || row.title === '' || row.title.length > MAX_TITLE
    || typeof row.phase !== 'string' || ![OPEN, STOPPING, STOPPED, FAILED, DISMISSED].includes(row.phase)) {
    throw new Error('Invalid Deep PTC card');
  }
  const card = { id: row.id, title: row.title, phase: row.phase };
  if (typeof row.subtitle === 'string' && row.subtitle !== '') card.subtitle = row.subtitle.slice(0, MAX_SUBTITLE);
  if (Array.isArray(row.lines)) card.lines = row.lines.filter(objects).slice(0, MAX_LINES)
    .map(line => ({ label: text(line.label, MAX_LABEL), value: text(line.value, MAX_VALUE) }));
  if (typeof row.note === 'string' && row.note !== '') card.note = row.note.slice(0, MAX_NOTE);
  if (row.tone === 'warn') card.tone = 'warn';
  if (objects(row.stop)) {
    const stop = {};
    if (typeof row.stop.label === 'string') stop.label = row.stop.label.slice(0, MAX_STOP_LABEL);
    if (typeof row.stop.command === 'string') stop.command = row.stop.command.slice(0, MAX_COMMAND);
    if (Array.isArray(row.stop.schedules)) stop.schedules = row.stop.schedules.filter(id => typeof id === 'string').slice(0, MAX_SCHEDULES);
    if (stop.command !== undefined || (stop.schedules ?? []).length > 0) card.stop = stop;
  }
  if (objects(row.result)) card.result = {
    ...(Array.isArray(row.result.schedules) ? { schedules: row.result.schedules.filter(id => typeof id === 'string') } : {}),
    ...(typeof row.result.command === 'string' ? { command: row.result.command } : {}),
    ...(Array.isArray(row.result.errors) ? { errors: row.result.errors.filter(item => typeof item === 'string').map(item => item.slice(0, MAX_VALUE)) } : {}),
  };
  return card;
}

/** Validate one durable card state (also the wire view the client reads). */
export function parseCardsState(value) {
  if (!objects(value) || value.v !== 1 || !Number.isSafeInteger(value.seq) || value.seq < 0
    || !Array.isArray(value.cards) || value.cards.length > MAX_CARDS) throw new Error('Invalid Deep PTC card state');
  const cards = value.cards.map(readCard);
  if (new Set(cards.map(card => card.id)).size !== cards.length) throw new Error('Duplicate Deep PTC card id');
  return { v: 1, seq: value.seq, cards };
}

/** Fold one session event into the card state. */
export function foldCardsState(state, event) {
  if (event.type !== CARDS_EVENT) return state;
  try { return parseCardsState(event.data); } catch { return state; }
}

/** Add or replace one card; a repeated id updates the same card in place. */
export function addCard(state, card, id) {
  const next = state.cards.find(row => row.id === id || (id === undefined && row.title === card.title));
  if (next !== undefined) {
    const replaced = { ...next, ...card, id: next.id, phase: OPEN, result: undefined };
    return { state: { ...state, cards: state.cards.map(row => row.id === next.id ? replaced : row) }, card: replaced };
  }
  const seq = state.seq + 1;
  const created = { ...card, id: id ?? 'card-' + seq, phase: OPEN };
  return { state: { ...state, seq, cards: [...state.cards, created].slice(-MAX_CARDS) }, card: created };
}

/** Drop one card from the conversation. */
export function removeCard(state, id) {
  return { ...state, cards: state.cards.filter(row => row.id !== id) };
}

/** Mark one card and keep the rest untouched. */
export function withCard(state, id, patch) {
  return { ...state, cards: state.cards.map(row => row.id === id ? { ...row, ...patch } : row) };
}

/** The result the client shows after an action settles. */
export function cardSummary(card) {
  const parts = [];
  const schedules = card.result?.schedules ?? [];
  if (schedules.length > 0) parts.push('schedules: ' + schedules.length);
  if (card.result?.command !== undefined) parts.push('command: ' + card.result.command);
  if ((card.result?.errors ?? []).length > 0) parts.push('errors: ' + card.result.errors.length);
  return parts.join('; ');
}
