// What waits for the user in one conversation, in one shape.
//
// Question cards, interactive cards, task brief items and project proposals each have their own state
// and command. The desktop notice (lib/notify.mjs) and the DSH Go mirror (lib/mobile-mirror.mjs) read
// them all through this module, and every answer goes back through the host command a click in the
// chat uses, so there is one set of rules.
//
// A decision: { key, group, since, kind, kicker, title, subtitle, blocks, note, fields, buttons, build, dismiss? }
//   key      changes whenever there is something new to decide;
//   group    stays the same while the user walks through one review, item after item;
//   since    the log sequence at which it was asked;
//   fields   [{ id, prompt, type: single|multi|text|time|date|number, options, value, optional, custom, placeholder }];
//   buttons  [{ id, label, style, needs: [field ids] }]; the primary one submits;
//   build    (button, values) → { command, payload }.

import { archivedReason, latestVersions } from './card-state.mjs';
import { CARD_COMMAND } from './cards.mjs';
import { QUESTION_KIND } from './card-questions.mjs';

// The names lib/brief-context.mjs and lib/project-context.mjs register.
const BRIEF_COMMAND = 'deep-ptc-brief';
const PROJECT_COMMAND = 'deep-ptc-project';
const PLACEHOLDERS = /\{([A-Za-z][A-Za-z0-9_]{0,23})\}/gu;

const WORDS = {
  zh: { question: '等待你的回答', card: '等待你的选择', brief: '核对任务卡', project: '核对特点卡片', submit: '确定', send: '提交',
    rest: '其余全部按此设置', yes: '按此设置', no: '不设置', approve: '批准', reject: '不采用', merge: '按最新内容重新合并',
    stale: '原卡片已更新，需要先合并再批准。', remaining: count => `确定后还剩 ${count} 条`, last: '这是最后一条',
    set: text => `按这样设置可以吗：${text}`, stop: '停止',
    goal: '目标', constraint: '约束', acceptance: '验收', context: '背景', openQuestion: '待确认' },
  en: { question: 'Waiting for your answer', card: 'Waiting for your choice', brief: 'Review the task brief', project: 'Review a project card', submit: 'Confirm', send: 'Submit',
    rest: 'Set all the rest as written', yes: 'Set as written', no: 'Leave it out', approve: 'Approve', reject: 'Do not adopt', merge: 'Merge onto the latest version',
    stale: 'The card changed since; merge before approving.', remaining: count => `${count} more after this`, last: 'This is the last item',
    set: text => `Set it like this? ${text}`, stop: 'Stop',
    goal: 'Goal', constraint: 'Constraint', acceptance: 'Acceptance', context: 'Context', openQuestion: 'Open question' },
};

/** The language of text the host itself writes for the user. */
export function hostLanguage() {
  try { return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'; } catch { return 'en'; }
}
const wordsOf = language => WORDS[language] ?? WORDS.en;

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const customOf = value => isRecord(value) && typeof value.custom === 'string' ? value.custom.trim() : '';
const filled = value => customOf(value) !== '' || (typeof value === 'string' && value.trim() !== '') || (Array.isArray(value) && value.length > 0);

// ---- Cards ------------------------------------------------------------------------------------

function questionDecision(version, w) {
  // A review clarification asks one question at a time, as its card does.
  const questions = version.review ? version.questions.slice(0, 1) : version.questions ?? [];
  const target = { id: version.id, rev: version.rev };
  return {
    key: `card:${version.id}:${version.rev}`, group: `card:${version.series ?? version.id}`, since: version.askedSeq ?? version.posted, kind: 'question',
    kicker: w.question, title: version.title, subtitle: version.subtitle ?? '', blocks: [], note: '',
    fields: questions.map(question => ({ id: question.id, prompt: question.prompt, type: question.type, options: question.options ?? [],
      value: version.review ? undefined : question.recommended, recommended: question.recommended, optional: question.optional === true,
      custom: question.type !== 'text', placeholder: question.placeholder ?? '' })),
    buttons: [{ id: 'answer', label: w.send, style: 'primary', needs: questions.filter(question => question.optional !== true).map(question => question.id) }],
    build: (_button, values) => ({ command: CARD_COMMAND, payload: { ...target, action: 'answer', codedReceipt: true, answers: values } }),
    dismiss: { command: CARD_COMMAND, payload: { ...target, action: 'dismiss' } },
  };
}

// Names a button substitutes: it cannot be pressed without them.
const needsOf = action => [...new Set([action.run?.command, typeof action.reply === 'string' ? action.reply : undefined]
  .filter(Boolean).flatMap(template => [...template.matchAll(PLACEHOLDERS)].map(match => match[1])))];

function cardDecision(version, w) {
  const actions = version.actions ?? [];
  const isInput = block => block.type === 'choice' || block.type === 'field';
  // A written answer must never reach a command, so it is offered only where no command reads it.
  const bound = name => actions.some(action => action.run?.command?.includes('{' + name + '}'));
  const required = new Set(actions.flatMap(needsOf));
  const target = { id: version.id, rev: version.rev };
  return {
    key: `card:${version.id}:${version.rev}`, group: `card:${version.id}`, since: version.posted, kind: 'card',
    kicker: w.card, title: version.title, subtitle: version.subtitle ?? '', ...version.tone ? { tone: version.tone } : {},
    blocks: (version.blocks ?? []).filter(block => !isInput(block)), note: version.note ?? '',
    fields: (version.blocks ?? []).filter(isInput).map(block => ({ id: block.name, prompt: block.label ?? block.name,
      type: block.type === 'choice' ? (block.multiple ? 'multi' : 'single') : block.kind, options: block.options ?? [], value: block.value,
      optional: !required.has(block.name), ...block.unit ? { unit: block.unit } : {},
      custom: block.type === 'choice' && !block.multiple && !bound(block.name), placeholder: '' })),
    buttons: actions.map(action => ({ id: action.id, label: action.label ?? w.stop, style: action.style ?? 'default', needs: needsOf(action) })),
    build: (button, values) => ({ command: CARD_COMMAND, payload: { ...target, action: 'act', key: button, codedReceipt: true,
      values: Object.fromEntries(Object.entries(values).map(([name, value]) => [name, customOf(value) || value])) } }),
    dismiss: { command: CARD_COMMAND, payload: { ...target, action: 'dismiss' } },
  };
}

/** The cards of a conversation that wait for the user, oldest first. */
export function cardDecisions(state, language = hostLanguage()) {
  if (!Array.isArray(state?.versions)) return [];
  const w = wordsOf(language);
  return [...latestVersions(state).values()]
    .filter(version => archivedReason(state, version) === undefined && !version.result && (!state.delegated || version.posted >= (state.own ?? 0)) && (version.kind === QUESTION_KIND || version.actions?.length > 0))
    .sort((left, right) => left.rev - right.rev)
    .map(version => version.kind === QUESTION_KIND ? questionDecision(version, w) : cardDecision(version, w));
}

// ---- Task brief -------------------------------------------------------------------------------

/** The task brief item being asked, as a list of zero or one. */
export function briefDecisions(state, language = hostLanguage()) {
  if (!Array.isArray(state?.items) || state.revising) return [];
  const queue = state.items.filter(item => item.status === 'open' && item.basis !== 'confirmed');
  const item = queue[0];
  if (item === undefined) return [];
  const w = wordsOf(language);
  const round = state.versions?.at(-1);
  const options = item.review?.options;
  const section = item.section === 'question' ? w.openQuestion : w[item.section] ?? item.section;
  const choices = options
    ? options.map(option => ({ value: option.value, label: option.label,
      hint: [option.text && option.text !== option.label ? option.text : '', option.hint].filter(Boolean).join(' · ') }))
    : [{ value: 'yes', label: w.yes, ...item.review?.question ? { hint: item.text } : {} }];
  const rest = queue.filter(row => !row.review?.options).length > 1;
  return [{
    key: `brief:${item.id}:${round?.askedSeq ?? state.rev}:${item.text}`, group: `brief:${round?.anchor ?? ''}`, since: round?.askedSeq, kind: 'brief',
    kicker: `${w.brief} · ${section}`, title: item.review?.question ?? (/[?？]$/u.test(item.text) ? item.text : w.set(item.text)),
    subtitle: item.quote && item.quote !== item.text ? `«${item.quote}»` : '', blocks: [],
    note: queue.length > 1 ? w.remaining(queue.length - 1) : w.last,
    fields: [{ id: 'decision', prompt: '', type: 'single', value: choices[0].value, optional: false, custom: true, placeholder: '',
      options: [...choices, { value: 'no', label: w.no }], ...rest ? { extra: [{ value: ':rest', label: w.rest }] } : {} }],
    buttons: [...rest ? [{ id: 'rest', label: w.rest, style: 'default', needs: [] }] : [], { id: 'submit', label: w.submit, style: 'primary', needs: ['decision'] }],
    build: (button, values) => {
      const answer = values.decision;
      const payload = button === 'rest' || answer === ':rest' ? { op: 'confirm-rest' }
        : customOf(answer) ? { op: 'rethink', id: item.id, feedback: customOf(answer) }
        : answer === 'no' ? { op: 'remove', id: item.id }
        : { op: 'confirm', ids: [item.id], ...options ? { choice: answer } : {} };
      return { command: BRIEF_COMMAND, payload: { ...payload, rev: state.rev } };
    },
  }];
}

// ---- Project cards ----------------------------------------------------------------------------

// What a proposal changes, one line per entry; a new card lists all its entries.
function changeLines(before = [], after = []) {
  const old = new Map(before.map(item => [item.id, item.text]));
  const kept = new Set(after.map(item => item.id));
  return [...after.filter(item => old.get(item.id) !== item.text).map(item => `${old.has(item.id) ? '~' : '+'} ${item.text}`),
    ...before.filter(item => !kept.has(item.id)).map(item => `- ${item.text}`)];
}

/** Proposals for project cards that belong to this conversation. */
export function projectDecisions(state, sessionId, language = hostLanguage()) {
  if (!Array.isArray(state?.proposals)) return [];
  const w = wordsOf(language);
  return state.proposals.filter(row => (row.chat ?? row.session) === sessionId).map(proposal => {
    const versions = proposal.review?.options;
    const current = state.cards?.find(card => card.id === proposal.card);
    const title = proposal.title ?? current?.title ?? proposal.card ?? '';
    const lines = draft => changeLines(current?.items, draft.preview ?? draft.items);
    const mergeable = proposal.stale && proposal.delta;
    const options = proposal.stale ? (mergeable ? [{ value: ':merge', label: w.merge }] : []) : versions
      ? versions.map(option => ({ value: option.value, label: option.label, hint: [option.hint, lines(option).join('\n').slice(0, 400)].filter(Boolean).join('\n') }))
      : [{ value: 'yes', label: w.approve }];
    const choices = [...options, { value: 'no', label: w.reject }];
    const text = versions ? '' : lines(proposal).join('\n').slice(0, 600);
    return {
      key: `project:${proposal.id}:${proposal.stale ? 'stale' : ''}`, group: `project:${proposal.originalId ?? proposal.id}`, since: proposal.anchor, kind: 'project',
      kicker: `${w.project} · ${title}`, title: proposal.review?.question ?? title, subtitle: proposal.reason ?? '',
      blocks: text ? [{ type: 'text', text }] : [], note: proposal.stale ? w.stale : '',
      fields: [{ id: 'decision', prompt: '', type: 'single', value: choices[0].value, optional: false, custom: !proposal.stale, placeholder: '', options: choices }],
      buttons: [{ id: 'submit', label: w.submit, style: 'primary', needs: ['decision'] }],
      build: (_button, values) => {
        const answer = values.decision;
        const payload = customOf(answer) ? { op: 'rethink', feedback: customOf(answer) }
          : answer === 'no' ? { op: 'reject' } : answer === ':merge' ? { op: 'rebase' }
          : { op: 'approve', ...versions ? { choice: answer } : {} };
        return { command: PROJECT_COMMAND, payload: { ...payload, proposal: proposal.id, serverNotice: true } };
      },
    };
  });
}

// ---- Answers ----------------------------------------------------------------------------------

/**
 * The host command line for one answer. Only the decision's own fields and buttons are passed on; the
 * command checks the values again.
 * @param raw - field id → option value, list of values, text, or `{ custom: text }`.
 * @returns `{ line }` or `{ error }`.
 */
export function commandFor(decision, buttonId, raw) {
  const button = decision.buttons.find(row => row.id === buttonId);
  if (button === undefined) return { error: 'Unknown button / 未知的按钮' };
  const values = {};
  for (const field of decision.fields) {
    const value = raw?.[field.id];
    if (!filled(value)) continue;
    const written = customOf(value);
    if (written && !field.custom && field.type !== 'text') return { error: `${field.prompt}: not one of the options / 请从选项中选择` };
    values[field.id] = written ? (field.type === 'text' ? written : { custom: written }) : value;
  }
  const missing = button.needs.filter(id => !filled(values[id]));
  if (missing.length > 0) return { error: `Not filled in / 还没有填写：${missing.map(id => decision.fields.find(field => field.id === id)?.prompt || id).join('、')}` };
  const { command, payload } = decision.build(buttonId, values);
  return { line: `/${command} ${JSON.stringify(payload)}` };
}

/** The host command line that closes the decision without choosing, when it can be closed. */
export const dismissLine = decision => decision.dismiss && `/${decision.dismiss.command} ${JSON.stringify(decision.dismiss.payload)}`;
