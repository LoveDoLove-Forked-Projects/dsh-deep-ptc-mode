// Runtime for conversation cards.
//
// Cards are first-class plugin state: a session projection stores them, a host command applies
// their one action, a plugin-owned tool lets the model leave one, and a built-in skill teaches the
// layouts. Nothing here depends on a host card service, so cards also work where only the plugin's
// own tools reach the agent (Deep PTC's run_code).
//
//   card-blocks.mjs  block vocabulary and readers      cards.mjs        card state (pure)
//   card-runner.mjs  button command in the chosen shell card-skill.mjs   the skill text

import { gated } from './gate.mjs';
import { isDeepPtcSession } from './session-preset.mjs';
import { importHost } from './host.mjs';
import { blockSchema, fillPlaceholders, ICONS, readValues, TONES } from './card-blocks.mjs';
import { runCardCommand } from './card-runner.mjs';
import { CARD_EXAMPLES_REGISTRATION, CARD_SKILL_REGISTRATION } from './card-skill.mjs';
import { CARD_COMMAND, CARD_SIZES, CARD_TOOL, CARDS_EVENT, CARDS_KEY, MAX_ID, blankCards, addCard, cardsDigest, foldCardsState,
  parseCardsState, readCardInput, removeCard, withCard, FAILED, OPEN, STOPPED, STOPPING } from './cards.mjs';

export const name = 'deep-ptc-cards';
// Optional layer: a missing service disables the cards rather than the preset.
export const inject = [];
const REQUIRED = ['commands', 'sessionProjections', 'tools'];
const MAX_REASON = 300;

/**
 * @param options - `{ enabled, watch }`: the setting getter and change subscription.
 */
export function apply(ctx, options = {}) {
  // Each layer starts once its own services exist; the caller never holds the boot for them.
  const cards = ctx.plugin({ name: 'deep-ptc-cards-layer', inject: REQUIRED, apply: child => install(child, sessionRecords, options) }).await()
    .catch(error => ctx.logger.warn('Deep PTC: conversation cards are off (%s)', error.message));
  // The skill is guidance only: without a skill service the cards still work.
  const skill = ctx.plugin({ name: 'deep-ptc-cards-skill', inject: ['skills'], apply: child => {
    for (const registration of [CARD_SKILL_REGISTRATION, CARD_EXAMPLES_REGISTRATION]) {
      gated(child, options.enabled, options.watch, () => child.skills.register(registration), registration.name);
    }
  } }).await()
    .catch(error => ctx.logger.warn('Deep PTC: the card skill is off (%s)', error.message));
  const guidance = ctx.plugin({ name: 'deep-ptc-conversation-card-guidance', inject: ['systemPrompt'], apply: child =>
    gated(child, options.enabled, options.watch, () => child.systemPrompt.section({
      name: 'deep-ptc:conversation-cards', order: 10197,
      text: ({ agent }) => isDeepPtcSession(ctx, agent?.session)
        ? 'Proactively use ui_card during the conversation. Write progress messages as well as the final answer in the user’s language. Show measured results with a display card; each block uses the type field, e.g. {type:"bars",items:[{label:"v1",value:48}]}. When a user asks to choose among alternatives, fulfill the instruction to ask by calling ui_card first, e.g. blocks:[{type:"choice",name:"plan",label:"Plan",options:[{value:"fast",label:"Fast"},{value:"full",label:"Full"}]}] and actions:[{label:"Confirm",reply:"Use {plan}"}]. Adapt labels and options to the user. Reserve ask_user_question for a required blocking approval or an unavailable card tool. A reply button already collects the answer: return control to the user or continue independent work instead of opening a second blocking question. Update an existing card as evidence changes. For setup opened in the Project cards panel, ask and receive answers directly in that panel.'
        : '',
    }), 'Deep PTC: conversation card guidance') }).await()
    .catch(error => ctx.logger.warn('Deep PTC: conversation card guidance unavailable (%s)', error.message));
  return Promise.all([cards, skill, guidance]);
}

/** The session module's plugin-record writer; injectable so the card path runs in tests. */
export async function sessionRecords() {
  const { appendPluginRecord } = await importHost('@deepseek-ai/dsh-session');
  if (typeof appendPluginRecord !== 'function') throw new Error('the installed session module has no appendPluginRecord');
  return appendPluginRecord;
}

// The ui_card tool definition. Its description is short on purpose: the layouts live in the skill.
function toolDefinition(store) {
  return {
    name: CARD_TOOL,
    // Deep PTC's own tool: its full schema stays in the run_code SDK instead of the compact catalog.
    resident: true,
    description: 'Leave or update a card in the conversation: a header, up to 6 blocks (display: stats, rows, progress, bars, line, donut, steps, table, tags, text, callout; interactive: choice, field), a note and up to 4 buttons that run on the host and/or send the user\'s choice back to you. Compose any card from these parts; load the deep-ptc-cards skill for rules and sample layouts. Reuse an id to update a card; action "remove" deletes one.',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['show', 'remove'], description: 'show adds or updates a card; remove deletes one by id.' },
      id: { type: 'string', description: 'Stable id; reuse it to update the same card.' },
      title: { type: 'string', description: 'Card title.' },
      subtitle: { type: 'string', description: 'One line under the title.' },
      icon: { type: 'string', enum: ICONS },
      size: { type: 'string', enum: CARD_SIZES, description: 'Width in the card grid: full (default), half or third. Pair related compact cards side by side.' },
      tone: { type: 'string', enum: TONES, description: 'Overall state of the card.' },
      blocks: { type: 'array', items: blockSchema(), description: 'Card body, top to bottom.' },
      lines: { type: 'array', description: 'Shorthand for a leading rows block.', items: { type: 'object', additionalProperties: false,
        properties: { label: { type: 'string' }, value: { type: 'string' } }, required: ['label', 'value'] } },
      note: { type: 'string', description: 'Footnote, up to 400 characters.' },
      actions: { type: 'array', description: 'Up to 4 buttons. Each needs run, reply or both.', items: {
        type: 'object', additionalProperties: false, required: ['label'], properties: {
          id: { type: 'string', description: 'Stable button id.' },
          label: { type: 'string', description: 'Verb label, e.g. 推迟 10 分钟.' },
          style: { type: 'string', enum: ['primary', 'default', 'danger'] },
          run: { type: 'object', additionalProperties: false, description: 'Runs on the host when pressed.', properties: {
            command: { type: 'string', description: 'Run through the conversation’s active Harness shell tool and permissions. The foreground wait is at most 30 s. {name} is replaced by that choice/field value.' },
            schedules: { type: 'array', items: { type: 'string' }, description: 'Scheduled task ids to delete.' },
          } },
          reply: { type: ['boolean', 'string'], description: 'Send the choice back to you as the user\'s next message: true for a default summary, or a template with {name} placeholders.' },
          keep: { type: 'boolean', description: 'Keep the card open after the button, so it can be used again.' },
        } } },
      stop: { type: 'object', additionalProperties: false, description: 'Legacy single button; prefer actions.',
        properties: { label: { type: 'string' }, command: { type: 'string' }, schedules: { type: 'array', items: { type: 'string' } } } },
    } },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const session = exec.agent?.session;
      if (!session) throw new Error('No active conversation');
      const state = store.read(session);
      if (args.action === 'remove') {
        const id = typeof args.id === 'string' ? args.id : '';
        if (!state.cards.some(row => row.id === id)) throw new Error('Unknown card id');
        await store.save(session, removeCard(state, id));
        return { removed: id, cards: cardsDigest(removeCard(state, id)) };
      }
      const parsed = readCardInput(args);
      if (parsed.issues !== undefined) throw new Error(parsed.issues.join('; '));
      const id = typeof args.id === 'string' && args.id.trim() !== '' ? args.id.trim().slice(0, MAX_ID) : undefined;
      const added = addCard(state, parsed.card, id);
      await store.save(session, added.state);
      return { id: added.card.id, revision: added.card.revision, phase: added.card.phase, cards: cardsDigest(added.state) };
    },
  };
}

export async function install(ctx, records = sessionRecords, options = {}) {
  const appendPluginRecord = await records();
  const schema = { parse: parseCardsState };
  const projection = await ctx.sessionProjections.register({ key: CARDS_KEY, stateVersion: 1,
    stateSchema: schema, init: blankCards, apply: foldCardsState,
    wire: { viewSchema: schema, view: state => state, summary: false } });
  ctx.effect(() => () => projection.dispose());
  const store = {
    read: session => projection.stateOf(session) ?? blankCards(),
    save: (session, state) => appendPluginRecord(session, CARDS_EVENT, state),
  };
  const enabled = () => options.enabled?.() !== false;

  ctx.commands.register({ name: CARD_COMMAND, recordInput: false,
    description: '处理对话卡片上的一个操作 / Apply one action to a conversation card',
    handler: request => act(ctx, request, store, enabled) });

  // The settings switch removes the tool, so the model never sees a card tool it may not use.
  gated(ctx, enabled, options.watch, () => ctx.tools.register(toolDefinition(store)), 'Deep PTC: card tool');
}

/** Apply one card action; the card shows its result while the work finishes. */
function act(ctx, { agent, commandId, rawInput, signal }, store, enabled) {
  if (!enabled()) return { kind: 'error', text: 'Conversation cards are turned off. / 对话卡片已关闭。' };
  const session = agent?.session;
  if (!session) return { kind: 'error', text: 'No active conversation. / 当前没有活动对话。' };
  const request = parseCommand(rawInput);
  if (request === undefined) return { kind: 'error', text: 'Invalid card action. / 无效的卡片操作。' };
  const state = store.read(session);
  const card = state.cards.find(row => row.id === request.id);
  if (card === undefined) return { kind: 'error', text: 'Unknown card. / 未知的卡片。' };
  if (card.revision !== request.revision) return { kind: 'error', text: 'This card changed. Use the current card. / 卡片已更新，请使用当前卡片。' };
  if (request.action === 'dismiss') {
    store.save(session, removeCard(state, card.id));
    return { kind: 'success', text: 'Card closed. / 卡片已关闭。' };
  }
  if (card.phase === STOPPING) return { kind: 'error', text: 'The action is still running. / 卡片操作仍在进行。' };
  if (card.phase !== OPEN) return { kind: 'error', text: 'Card already handled. / 卡片已处理。' };
  const action = (card.actions ?? []).find(row => row.id === request.key);
  if (action === undefined) return { kind: 'error', text: 'Unknown card button. / 未知的卡片按钮。' };
  const checked = readValues(card, request.values);
  if (checked.error !== undefined) return { kind: 'error', text: checked.error };
  const command = action.run?.command === undefined ? undefined : fillPlaceholders(action.run.command, checked.values);
  if (command?.missing !== undefined) return { kind: 'error', text: 'Missing: ' + command.missing.join(', ') + ' / 请先填写：' + command.missing.join('、') };
  const values = Object.keys(checked.values).length > 0 ? { values: checked.values } : {};
  const settled = { action: action.id, ...action.label ? { label: action.label } : {}, ...values, at: Date.now() };
  // A reply-only button records the choice; the client sends it to the model.
  if (action.run === undefined) {
    store.save(session, withCard(state, card.id, { phase: action.keep ? OPEN : STOPPED, result: settled }));
    return { kind: 'success', text: 'Choice recorded. / 已记录选择。' };
  }
  store.save(session, withCard(state, card.id, { phase: STOPPING, result: settled }));
  return runAction(ctx, { agent, commandId, signal }, card, action, command?.text, settled, store);
}

function parseCommand(rawInput) {
  let request;
  try { request = JSON.parse(String(rawInput ?? '')); } catch { return undefined; }
  if (request === null || typeof request !== 'object' || Array.isArray(request)) return undefined;
  const id = typeof request.id === 'string' ? request.id : '';
  if (id === '' || id.length > MAX_ID) return undefined;
  const revision = Number.isSafeInteger(request.revision) ? request.revision : undefined;
  if (request.action === 'dismiss') return { id, revision, action: 'dismiss' };
  // 1.9.7/1.9.8 clients send { action: 'stop' } for the card's one button.
  if (request.action === 'stop') return { id, revision, action: 'act', key: 'stop', values: request.values };
  if (request.action !== 'act' || typeof request.key !== 'string' || request.key === '') return undefined;
  return { id, revision, action: 'act', key: request.key.slice(0, 24), values: request.values };
}

/** Run the command under host policy before applying any accompanying schedule changes. */
async function runAction(ctx, invocation, card, action, command, settled, store) {
  const session = invocation.agent.session;
  const result = { ...settled, schedules: [] };
  const errors = [];
  if (command !== undefined) {
    try {
      Object.assign(result, await runCardCommand(ctx, { ...invocation, command, description: action.label ?? card.title }));
    } catch (error) {
      result.command = 'failed';
      errors.push('command: ' + reason(error));
      ctx.logger.warn('Deep PTC: card command failed (%s)', error.message);
    }
  }
  const schedule = action.run.schedules === undefined ? undefined : ctx.get('schedule');
  for (const id of errors.length === 0 ? action.run.schedules ?? [] : []) {
    if (invocation.signal?.aborted) { errors.push('Action cancelled / 操作已取消'); break; }
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
  if (errors.length > 0) result.errors = errors;
  const phase = action.keep ? OPEN : errors.length > 0 ? FAILED : STOPPED;
  const state = store.read(session);
  const current = state.cards.find(row => row.id === card.id);
  if (current?.phase === STOPPING && current.revision === card.revision) {
    await store.save(session, withCard(state, card.id, { phase, result }));
  }
  return errors.length > 0 ? { kind: 'error', text: errors.join(' · ') }
    : { kind: 'success', text: result.jobId ? `Background job / 后台任务: ${result.jobId}` : 'Card action completed. / 卡片操作已完成。' };
}

function reason(error) {
  return String(error?.message ?? error).trim().slice(0, MAX_REASON);
}
