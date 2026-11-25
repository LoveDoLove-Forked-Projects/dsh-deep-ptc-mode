// Question batches: several small question cards posted together, answered together, delivered to the
// model once.
//
// A file of its own on purpose: after a live update, modules of the previous version may still be in
// memory (scripts/check-live-update.mjs), so new names never join an existing file.
//
// The store is the runtime object lib/cards-context.mjs creates:
//   { read(session), append(session, record) }
// and the waits object it is given: { add(exec, check) }.
import { ANSWERED, OPEN, STOPPING } from './cards.mjs';
import { latestOf, records } from './card-state.mjs';
import { QUESTION_KIND } from './card-questions.mjs';

const MAX_SUMMARY = 120;
const summaryOf = text => text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY - 1)}…` : text;
const quote = value => `«${String(value ?? '').replace(/\s+/gu, ' ').trim()}»`;
const choice = (options, value) => {
  const label = options?.find(option => option.value === value)?.label;
  return label === undefined || label === value ? value : `${value} ${quote(label)}`;
};
const picked = (options, value) => {
  const list = Array.isArray(value) ? value : [value];
  const values = list.join(', ');
  const labels = list.map(item => options?.find(option => option.value === item)?.label ?? item).map(quote).join(', ');
  return Array.isArray(value) ? `[${values}] ${labels}` : choice(options, value);
};

/** One `question = answer    # prompt` line per question; free text is quoted, choices show their label. */
export function answerLines(card, answers) {
  return (card.questions ?? []).map(question => {
    const answer = answers?.[question.id];
    const shown = answer === undefined || answer === '' || (Array.isArray(answer) && answer.length === 0) ? '(skipped)'
      : answer?.custom ? quote(answer.custom) : question.type === 'text' ? quote(answer) : picked(question.options, answer);
    return `${question.id} = ${shown}    # ${question.prompt}`;
  });
}

/** The model's view of a whole batch: every card in order, its answers, and the one next step. */
export function briefingView(cards) {
  const lines = [`[Deep sleep briefing: ${cards.length} card${cards.length === 1 ? '' : 's'} answered]`];
  for (const card of cards) {
    const position = Number.isSafeInteger(card.seriesIndex) && Number.isSafeInteger(card.seriesTotal)
      ? ` (${card.seriesIndex}/${card.seriesTotal})` : '';
    lines.push('', `## ${card.title}${position}`);
    if (card.subtitle) lines.push(card.subtitle);
    lines.push(...answerLines(card, card.result?.answers));
  }
  lines.push('', 'The whole batch is answered; nothing else waits on the user. File the confirmed goal, constraints and acceptance with task_brief, then call deep_sleep action=confirm with the objective and the summary rows.');
  return { text: lines.join('\n'), summary: summaryOf(`深度睡眠简报 · ${cards.length} 张卡已作答`) };
}

/** Every current version of one batch, in card order. */
export function batchCards(state, series) {
  const latest = new Map();
  for (const version of state.versions) {
    if (version.series !== series || version.kind !== QUESTION_KIND) continue;
    const known = latest.get(version.id);
    if (!known || version.rev > known.rev) latest.set(version.id, version);
  }
  return [...latest.values()].sort((left, right) => (left.seriesIndex ?? 0) - (right.seriesIndex ?? 0));
}

/** Whether the batch still has a card the user did not answer or close. */
export function batchOpen(state, series) {
  return batchCards(state, series).some(version => version.phase === OPEN && !version.result);
}

/** Append one version and read the card back; the fold runs as the record is appended. */
async function post(store, session, id, body, group, series) {
  const before = store.read(session);
  await store.append(session, { ...records.show(before, id, body), ...(group ? { group } : {}), ...(series ? { series } : {}) });
  const version = latestOf(store.read(session), id);
  if (version === undefined || version.rev <= before.seq) throw new Error('The card could not be stored');
  return version;
}

/**
 * Post one batch of question cards. Each card keeps its five questions; the batch carries the width.
 * @param batch - `{ series?, cards: card bodies }`, already validated.
 * @returns the series id and the posted versions.
 */
export async function postQuestionBatch(store, session, batch, group) {
  const before = store.read(session);
  const series = typeof batch.series === 'string' && batch.series !== '' ? batch.series : `batch-${before.seq + 1}`;
  const versions = [];
  for (let at = 0; at < batch.cards.length; at += 1) {
    const body = { ...batch.cards[at], briefing: true, series, seriesIndex: at + 1, seriesTotal: batch.cards.length };
    versions.push(await post(store, session, `${series}-${at + 1}`, body, group, series));
  }
  return { series, cards: versions };
}

/** Post one question card (a confirmation card, or a single question) and return its stored version. */
export async function postQuestionCard(store, session, body, group, id) {
  const before = store.read(session);
  return post(store, session, id ?? `question-${before.seq + 1}`, body, group);
}

/** Wait until no card of the batch still waits for the user. */
export function waitForBatch(store, exec, series, session = exec.agent.session) {
  store.waits?.add(exec, () => batchOpen(store.read(session), series));
}

/** Wait until the one card no longer waits for the user (answered, closed, or replaced). */
export function waitForCard(store, exec, version, session = exec.agent.session) {
  store.waits?.add(exec, () => {
    const state = store.read(session);
    const current = latestOf(state, version.id);
    if (current === undefined) return false;
    const enabled = typeof store.enabled === 'function' ? store.enabled(version.review) : true;
    return enabled && (current.phase === STOPPING || (current.phase === OPEN && !current.result));
  });
}
