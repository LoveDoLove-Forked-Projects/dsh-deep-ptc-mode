// Pure state and view logic for conversation cards.
//
// A card is a small panel the model leaves in the conversation: a header (title, subtitle, icon,
// tone), a few layout blocks (lib/card-blocks.mjs), a note and one optional action. The card lives
// in the session log, so it survives turns, and the client renders it at the end of the latest turn.
//
// One reader normalises both what the model sends and what the log replays: a stored card is
// re-read with the same rules, so the tool, the projection and the client never disagree on shape.

import { ICONS, PLACEHOLDER, TONES, cardInputs, objects, readBlocks, text } from './card-blocks.mjs';

export const CARDS_KEY = 'deepPtcCards';
export const CARDS_EVENT = 'plugin:dsh-deep-ptc-mode/cards';
export const CARD_COMMAND = 'deep-ptc-card-act';
export const CARD_TOOL = 'ui_card';

export const OPEN = 'open';
export const STOPPING = 'stopping';
export const STOPPED = 'stopped';
export const FAILED = 'failed';
export const DISMISSED = 'dismissed';
const PHASES = [OPEN, STOPPING, STOPPED, FAILED, DISMISSED];

export const MAX_CARDS = 8;
export const CARD_SIZES = ['full', 'half', 'third'];
export const MAX_ID = 64;
const MAX_TITLE = 120;
const MAX_SUBTITLE = 160;
const MAX_NOTE = 400;
const MAX_STOP_LABEL = 24;
const MAX_COMMAND = 2000;
const MAX_SCHEDULES = 8;
const MAX_SCHEDULE_ID = 120;
const MAX_REASON = 300;

export function blankCards() {
  return { v: 1, seq: 0, cards: [] };
}

export const MAX_ACTIONS = 4;
const ACTION_ID = /^[A-Za-z][A-Za-z0-9_-]{0,23}$/u;
const ACTION_STYLES = ['primary', 'danger'];
const MAX_REPLY = 600;

// What pressing a button really does on the host: delete scheduled tasks and/or run one command.
function readRun(value, path, issues) {
  if (!objects(value)) {
    issues.push(path + ': expected an object');
    return undefined;
  }
  const run = {};
  const command = text(value.command, MAX_COMMAND);
  if (command !== '') run.command = command;
  if (value.schedules !== undefined) {
    if (!Array.isArray(value.schedules) || value.schedules.length > MAX_SCHEDULES) {
      issues.push(path + '.schedules: use at most ' + MAX_SCHEDULES + ' ids');
    } else {
      const ids = value.schedules.map(id => text(id, MAX_SCHEDULE_ID)).filter(id => id !== '');
      if (ids.length > 0) run.schedules = ids;
    }
  }
  if (run.command === undefined && run.schedules === undefined) {
    issues.push(path + ': a command or schedule ids are required');
    return undefined;
  }
  return run;
}

function readAction(value, index, path, issues) {
  if (!objects(value)) {
    issues.push(path + ': expected an object');
    return undefined;
  }
  const action = { id: text(value.id, 24) || (index === 0 && path === 'stop' ? 'stop' : 'action-' + (index + 1)) };
  if (!ACTION_ID.test(action.id)) issues.push(path + '.id: use a letter then letters, digits, _ or -');
  const label = text(value.label, MAX_STOP_LABEL);
  if (label !== '') action.label = label;
  else if (path !== 'stop') issues.push(path + '.label: required');
  if (ACTION_STYLES.includes(value.style)) action.style = value.style;
  else if (value.style !== undefined && value.style !== 'default') issues.push(path + '.style: use primary, danger or default');
  // The legacy stop button is the card's whole run: command and schedules sit on the button itself.
  const run = path === 'stop' ? readRun({ command: value.command, schedules: value.schedules }, path, issues)
    : value.run === undefined ? undefined : readRun(value.run, path + '.run', issues);
  if (run !== undefined) action.run = run;
  if (value.reply === true) action.reply = true;
  else if (typeof value.reply === 'string' && value.reply.trim() !== '') action.reply = text(value.reply, MAX_REPLY);
  else if (value.reply !== undefined && value.reply !== false) issues.push(path + '.reply: use true or a message template');
  if (value.keep === true) action.keep = true;
  if (action.run === undefined && action.reply === undefined && path !== 'stop') issues.push(path + ': needs run, reply or both');
  return action;
}

/** Buttons: `actions` (up to four), with the legacy `stop` read as a leading primary action. */
function readActions(value, issues) {
  const actions = [];
  if (value.stop !== undefined) {
    const stop = readAction(value.stop, 0, 'stop', issues);
    if (stop !== undefined) actions.push({ ...stop, style: stop.style ?? 'primary' });
  }
  if (value.actions !== undefined) {
    if (!Array.isArray(value.actions)) issues.push('actions: expected a list');
    else value.actions.forEach((entry, index) => {
      const action = readAction(entry, index, 'actions.' + index, issues);
      if (action !== undefined) actions.push(action);
    });
  }
  if (actions.length > MAX_ACTIONS) issues.push('actions: use at most ' + MAX_ACTIONS + ' buttons');
  if (new Set(actions.map(action => action.id)).size !== actions.length) issues.push('actions: ids must be unique');
  return actions;
}

// Every {name} in a command or reply must be one of the card's inputs.
function checkPlaceholders(card, issues) {
  const names = cardInputs(card);
  for (const action of card.actions ?? []) {
    for (const template of [action.run?.command, typeof action.reply === 'string' ? action.reply : undefined]) {
      for (const [, name] of (template ?? '').matchAll(PLACEHOLDER)) {
        if (!names.has(name)) issues.push('actions.' + action.id + ': {' + name + '} is not a choice or field name');
      }
    }
  }
}

/** Normalise one card body (tool input or stored card), or list what must be fixed. */
export function readCardInput(value) {
  if (!objects(value)) return { issues: ['expected an object'] };
  const issues = [];
  const card = { title: text(value.title, MAX_TITLE) };
  if (card.title === '') issues.push('title: required');
  const subtitle = text(value.subtitle, MAX_SUBTITLE);
  if (subtitle !== '') card.subtitle = subtitle;
  if (value.icon !== undefined) {
    if (ICONS.includes(value.icon)) card.icon = value.icon;
    else issues.push('icon: use one of ' + ICONS.join(', '));
  }
  // Width in the card grid: full (default, not stored), half or third. Narrow windows stack them.
  if (CARD_SIZES.includes(value.size)) { if (value.size !== 'full') card.size = value.size; }
  else if (value.size !== undefined) issues.push('size: use full, half or third');
  // `info` is the default tone and is not stored, so a re-read card is unchanged.
  if (TONES.includes(value.tone)) { if (value.tone !== 'info') card.tone = value.tone; }
  else if (value.tone !== undefined) issues.push('tone: use ' + TONES.join(', '));
  const blocks = readBlocks(value, issues);
  if (blocks.length > 0) card.blocks = blocks;
  const note = text(value.note, MAX_NOTE);
  if (note !== '') card.note = note;
  const actions = readActions(value, issues);
  if (actions.length > 0) card.actions = actions;
  checkPlaceholders(card, issues);
  if (issues.length > 0) return { issues };
  if (card.subtitle === undefined && card.blocks === undefined && card.note === undefined) {
    return { issues: ['a card needs a subtitle, blocks or a note'] };
  }
  return { card };
}

function readResult(value) {
  if (!objects(value)) return undefined;
  const strings = list => Array.isArray(list) ? list.filter(item => typeof item === 'string') : undefined;
  const result = {};
  const schedules = strings(value.schedules);
  if (schedules !== undefined) result.schedules = schedules;
  if (typeof value.command === 'string') result.command = value.command;
  if (typeof value.jobId === 'string') result.jobId = value.jobId;
  if (typeof value.action === 'string') result.action = value.action.slice(0, 24);
  if (typeof value.label === 'string') result.label = value.label.slice(0, MAX_STOP_LABEL);
  if (objects(value.values)) result.values = Object.fromEntries(Object.entries(value.values)
    .filter(([key, item]) => typeof key === 'string' && typeof item === 'string').map(([key, item]) => [key.slice(0, 24), item.slice(0, 120)]));
  if (typeof value.at === 'number' && Number.isFinite(value.at)) result.at = value.at;
  const errors = strings(value.errors);
  if (errors !== undefined) result.errors = errors.map(item => item.slice(0, MAX_REASON));
  return result;
}

// A stored card: id and phase, the card body re-read with the input rules, and the action result.
function readCard(row) {
  if (!objects(row) || typeof row.id !== 'string' || row.id === '' || row.id.length > MAX_ID
    || !PHASES.includes(row.phase)) throw new Error('Invalid Deep PTC card');
  const { card, issues } = readCardInput(row);
  if (issues !== undefined) throw new Error('Invalid Deep PTC card: ' + issues[0]);
  const result = readResult(row.result);
  const revision = Number.isSafeInteger(row.revision) && row.revision > 0 ? { revision: row.revision } : {};
  return { id: row.id, ...revision, ...card, phase: row.phase, ...result === undefined ? {} : { result } };
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

/**
 * Add or replace one card. A repeated id (or, without an id, a repeated title) updates that card in
 * place: the new body replaces the old one entirely and the card reopens without its old result.
 */
export function addCard(state, card, id) {
  const previous = state.cards.find(row => row.id === id || (id === undefined && row.title === card.title));
  let seq = state.seq + 1;
  if (previous !== undefined) {
    const replaced = { id: previous.id, revision: seq, ...card, phase: OPEN };
    return { state: { ...state, seq, cards: state.cards.map(row => row.id === previous.id ? replaced : row) }, card: replaced };
  }
  if (id === undefined) while (state.cards.some(row => row.id === 'card-' + seq)) seq += 1;
  const created = { id: id ?? 'card-' + seq, revision: seq, ...card, phase: OPEN };
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

/** What the tool returns to the model: enough to update or remove a card later. */
export function cardsDigest(state) {
  return state.cards.map(row => ({ id: row.id, title: row.title, phase: row.phase }));
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
