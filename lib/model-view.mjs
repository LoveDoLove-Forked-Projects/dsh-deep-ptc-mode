// The model's view of a card.
//
// A card has two faces. The user's face is the rendered card. The model's face is this module:
// what a card contributes to the model's context, written for precise reading rather than looks.
//   - every element is addressable: card id, question id, option value, item id;
//   - a value travels with the words the user saw: `plan = vps «VPS 自建»`;
//   - presentation (icons, tones, sizes, layout) never reaches the model;
//   - each block says in one line what the model should do with it.
// Scaffolding is English; content stays in the user's language.
//
// Answers and button replies reach the model as one structured message with a short notice summary
// for the chat, delivered by the server, so the chat bubble does not repeat what the card shows.

import { randomUUID } from 'node:crypto';
import { importHost } from './host.mjs';

export const CARD_SOURCE = 'deep-ptc-card';
const MAX_SUMMARY = 120;

/** Quote user-facing text so its edges are unambiguous. */
export const quote = value => `«${String(value ?? '').replace(/\s+/gu, ' ').trim()}»`;

const summaryOf = text => text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1)}…` : text;

function choice(options, value) {
  const label = options?.find(option => option.value === value)?.label;
  return label === undefined || label === value ? value : `${value} ${quote(label)}`;
}

function picked(options, value) {
  const list = Array.isArray(value) ? value : [value];
  const values = list.join(', ');
  const labels = list.map(item => options?.find(option => option.value === item)?.label ?? item).map(quote).join(', ');
  return Array.isArray(value) ? `[${values}] ${labels}` : choice(options, value);
}

/**
 * The model's view of a question card's answers.
 * @returns `{ text, summary }`: the message text and the one-line chat summary.
 */
export function answerView(card, answers) {
  const lines = [`[Card answer: ${card.id} ${quote(card.title)}]`];
  for (const question of card.questions ?? []) {
    const answer = answers?.[question.id];
    const shown = answer === undefined || answer === '' || (Array.isArray(answer) && answer.length === 0) ? '(skipped)'
      : question.type === 'text' ? quote(answer) : picked(question.options, answer);
    lines.push(`${question.id} = ${shown}    # ${question.prompt}`);
  }
  lines.push('These answers settle the card. Continue the work that waited on them; do not ask them again.');
  return { text: lines.join('\n'), summary: summaryOf(`回答 · ${card.title}`) };
}

/**
 * The model's view of a pressed button that replies to the model.
 * A string template is the model's own wording: it is filled and passed through under the header.
 */
export function replyView(card, action, values = {}) {
  const head = `[Card button: ${card.id} rev ${card.rev} ${quote(card.title)} → ${action.id} ${quote(action.label ?? action.id)}]`;
  const lines = [head];
  if (typeof action.reply === 'string') {
    lines.push(action.reply.replace(/\{([A-Za-z][A-Za-z0-9_]{0,23})\}/gu, (whole, name) => {
      const value = values[name];
      return value === undefined || value === '' ? whole : Array.isArray(value) ? value.join(', ') : String(value);
    }));
  }
  for (const block of card.blocks ?? []) {
    if ((block?.type !== 'choice' && block?.type !== 'field') || values[block.name] === undefined || values[block.name] === '') continue;
    const value = values[block.name];
    const label = block.label ? `    # ${block.label}` : '';
    lines.push(`${block.name} = ${block.type === 'choice' ? picked(block.options, value) : quote(value)}${label}`);
  }
  return { text: lines.join('\n'), summary: summaryOf(`${card.title} · ${action.label ?? action.id}`) };
}

let createMessage;
async function messageFactory() {
  createMessage ??= importHost('@deepseek-ai/dsh-llm').then(module => module.createUserMessage)
    .catch(() => undefined);
  return createMessage;
}

/**
 * Deliver a model-view message to the agent: it enters the nearest step, or opens a turn when the
 * agent is idle. The chat shows it as a one-line notice.
 * @returns whether the message was handed to the agent; on false the caller falls back.
 */
export async function deliver(agent, { text, summary }, source = CARD_SOURCE) {
  if (typeof agent?.steer !== 'function') return false;
  const content = [{ type: 'text', text }];
  const origin = { kind: source, form: 'notice', summary };
  const create = await messageFactory();
  const message = typeof create === 'function' ? create({ content, source: origin })
    : { id: randomUUID(), role: 'user', content, source: origin };
  agent.steer(message);
  return true;
}
