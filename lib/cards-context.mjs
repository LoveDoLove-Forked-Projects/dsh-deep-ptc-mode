// Runtime for conversation cards.
//
// Cards are first-class plugin state: a session projection stores them, a host
// command applies their one action, and a plugin-owned tool lets the model leave
// one. Nothing here depends on a host card service, so it also works where only
// the plugin's own tools reach the agent.

import { exec } from 'node:child_process';
import { importHost } from './host.mjs';
import { CARD_COMMAND, CARD_TOOL, CARDS_EVENT, CARDS_KEY, blankCards, addCard, foldCardsState, parseCardsState,
  readCardInput, removeCard, withCard, FAILED, OPEN, STOPPED, STOPPING } from './cards.mjs';

export const name = 'deep-ptc-cards';
// Optional layer: a missing service disables the cards rather than the preset.
export const inject = [];
const REQUIRED = ['commands', 'sessionProjections', 'tools'];
const STOP_TIMEOUT_MS = 30_000;
const MAX_REASON = 300;

export function apply(ctx) {
  // Starts once the host services exist; the caller never holds the boot for it.
  return ctx.plugin({ name: 'deep-ptc-cards-layer', inject: REQUIRED, apply: install }).await()
    .catch(error => ctx.logger.warn('Deep PTC: conversation cards are off (%s)', error.message));
}

/** The session module's plugin-record writer; injectable so the card path runs in tests. */
export async function sessionRecords() {
  const { appendPluginRecord } = await importHost('@deepseek-ai/dsh-session');
  if (typeof appendPluginRecord !== 'function') throw new Error('the installed session module has no appendPluginRecord');
  return appendPluginRecord;
}

export async function install(ctx, records = sessionRecords) {
  const appendPluginRecord = await records();
  const schema = { parse: parseCardsState };
  const projection = await ctx.sessionProjections.register({ key: CARDS_KEY, stateVersion: 1,
    stateSchema: schema, init: blankCards, apply: foldCardsState,
    wire: { viewSchema: schema, view: state => state, summary: false } });
  ctx.effect(() => () => projection.dispose());
  const save = (session, state) => appendPluginRecord(session, CARDS_EVENT, state);
  const read = session => projection.stateOf(session) ?? blankCards();

  ctx.commands.register({ name: CARD_COMMAND, recordInput: false,
    description: '处理对话卡片上的一个操作 / Apply one action to a conversation card',
    handler: ({ agent, rawInput }) => act(ctx, agent, rawInput, read, save) });

  ctx.effect(() => ctx.tools.register({
    name: CARD_TOOL,
    description: 'Leave one small card in the conversation: a title, labelled rows, an optional note and one optional action button. Use it when the user wants a card or control panel kept in the conversation. Cards stay until the user stops or dismisses them. Call again with the same id to update a card, or with action "remove" to delete one.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      action: { type: 'string', enum: ['show', 'remove'], description: 'show adds or updates a card; remove deletes one by id.' },
      id: { type: 'string', description: 'Optional stable id; reuse it to update the same card.' },
      title: { type: 'string', description: 'Card title.' },
      subtitle: { type: 'string', description: 'One small line under the title.' },
      lines: { type: 'array', items: { type: 'object', additionalProperties: false,
        properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] },
        description: 'Up to 12 labelled rows.' },
      note: { type: 'string', description: 'Footnote, up to 400 characters.' },
      tone: { type: 'string', enum: ['info', 'warn'], description: 'Card tone.' },
      stop: { type: 'object', additionalProperties: false, description: 'The card button: what pressing it really does.',
        properties: {
          label: { type: 'string', description: 'Button text, defaults to 停止.' },
          command: { type: 'string', description: 'Command to run on the host, 30 second timeout.' },
          schedules: { type: 'array', items: { type: 'string' }, description: 'Scheduled task ids to delete.' },
        } },
    }, required: ['action'] },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const session = exec.agent?.session;
      if (!session) throw new Error('No active conversation');
      const state = read(session);
      if (args.action === 'remove') {
        const id = typeof args.id === 'string' ? args.id : '';
        if (!state.cards.some(row => row.id === id)) throw new Error('Unknown card id');
        save(session, { ...state, cards: state.cards.filter(row => row.id !== id) });
        return { removed: id };
      }
      const parsed = readCardInput(args);
      if (parsed.issues !== undefined) throw new Error(parsed.issues.join('; '));
      const id = typeof args.id === 'string' && args.id !== '' ? args.id : undefined;
      const added = addCard(state, parsed.card, id);
      save(session, added.state);
      return { id: added.card.id, phase: added.card.phase,
        cards: added.state.cards.map(row => ({ id: row.id, title: row.title, phase: row.phase })) };
    },
  }), 'Deep PTC: card tool');
}

/** Apply one card action; the card shows its result while the work finishes. */
function act(ctx, agent, rawInput, read, save) {
  const session = agent?.session;
  if (!session) return { kind: 'error', text: 'No active conversation. / 当前没有活动对话。' };
  const request = parseCommand(rawInput);
  if (request === undefined) return { kind: 'error', text: 'Invalid card action. / 无效的卡片操作。' };
  const state = read(session);
  const card = state.cards.find(row => row.id === request.id);
  if (card === undefined) return { kind: 'error', text: 'Unknown card. / 未知的卡片。' };
  if (card.phase !== OPEN) return { kind: 'success', text: 'Card already closed. / 卡片已处理。' };
  if (request.action === 'dismiss') {
    save(session, removeCard(state, card.id));
    return { kind: 'success', text: 'Card closed. / 卡片已关闭。' };
  }
  save(session, withCard(state, card.id, { phase: STOPPING }));
  void runAction(ctx, session, card, read, save);
  return { kind: 'success', text: 'Card action started. / 卡片操作已开始。' };
}

function parseCommand(rawInput) {
  let request;
  try { request = JSON.parse(String(rawInput ?? '')); } catch { return undefined; }
  if (request === null || typeof request !== 'object' || Array.isArray(request)) return undefined;
  const id = typeof request.id === 'string' ? request.id : '';
  if (id === '' || id.length > 64) return undefined;
  if (request.action !== 'stop' && request.action !== 'dismiss') return undefined;
  return { id, action: request.action };
}

/** Run the card's action: delete its scheduled tasks, then its command. */
async function runAction(ctx, session, card, read, save) {
  const result = { schedules: [] };
  const errors = [];
  const stop = card.stop;
  if (stop === undefined) errors.push('no action');
  const schedule = stop?.schedules === undefined ? undefined : ctx.get('schedule');
  for (const id of stop?.schedules ?? []) {
    if (schedule === undefined) {
      errors.push('schedule service unavailable');
      break;
    }
    try {
      await schedule.edit({ id, action: 'delete' }, session.id);
      result.schedules.push(id);
    } catch (error) {
      errors.push('schedule ' + id + ': ' + reason(error));
      ctx.logger.warn('Deep PTC: could not delete schedule %s (%s)', id, error.message);
    }
  }
  if (stop?.command !== undefined) {
    try {
      await run(stop.command);
      result.command = 'ok';
    } catch (error) {
      result.command = 'failed';
      errors.push('command: ' + reason(error));
      ctx.logger.warn('Deep PTC: card command failed (%s)', error.message);
    }
  }
  if (errors.length > 0) result.errors = errors;
  const next = withCard(read(session), card.id, { phase: errors.length === 0 ? STOPPED : FAILED, result });
  save(session, next);
}

function reason(error) {
  return String(error?.message ?? error).trim().slice(0, MAX_REASON);
}

function run(command) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: STOP_TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20 }, (error, _stdout, stderr) => {
      if (error === null) resolve();
      else reject(new Error(String(stderr ?? '').trim().split('\n')[0].slice(0, MAX_REASON) || error.message));
    });
  });
}
