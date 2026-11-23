// Decisions on DSH Go (and any other client that draws the host's native question box).
//
// DSH Go draws its own Flutter interface and runs no plugin client code, so it cannot render Deep PTC's
// cards. It does draw the host's `user-questions/request`, over every kind of connection: the phone's
// own engine, SSH and the remote relay. So each decision that waits for the user is also asked as a
// native question. Whichever surface answers first wins: a native answer goes through the card's own
// host command, and a click in the chat aborts the native question.
//
// Question ids start with MIRROR_PREFIX. Deep PTC's web client recognises them and keeps the request
// to itself without drawing anything, because it already shows the card (src/client/mirror.js).

import { hostLanguage } from './decisions.mjs';
import { cardMarkdown } from './card-text.mjs';
import { importHost } from './host.mjs';
import { isSubagentSession } from './subagent-interaction.mjs';

export const MIRROR_PREFIX = 'dpt:';
const ACTION = ':action';
const MAX_LABEL = 200;
const DECLINED = new Set(['ASK_CANCELLED']);

const WORDS = {
  zh: { recommended: '推荐', current: '当前值', keep: value => `使用 ${value}`, blank: '留空', none: '不选', action: '要执行哪个操作？', close: '关闭卡片，暂不处理', danger: '不可轻易撤销',
    time: '格式 HH:MM，例如 09:30', date: '格式 YYYY-MM-DD', number: '填写数字', own: '选“自填”可以写你自己的意见' },
  en: { recommended: 'Recommended', current: 'Current value', keep: value => `Use ${value}`, blank: 'Leave blank', none: 'None', action: 'Which action?', close: 'Close the card for now', danger: 'Hard to undo',
    time: 'Format HH:MM, e.g. 09:30', date: 'Format YYYY-MM-DD', number: 'Enter a number', own: 'Write your own answer to send a correction' },
};

const list = value => value === undefined || value === '' ? [] : Array.isArray(value) ? value : [value];

// Native answers name an option by its label, so labels must differ within one question.
function uniqueLabels(options) {
  const seen = new Map();
  return options.map(option => {
    const label = String(option.label).slice(0, MAX_LABEL);
    const count = (seen.get(label) ?? 0) + 1;
    seen.set(label, count);
    return { ...option, label: count === 1 ? label : `${label} (${count})` };
  });
}

// DSH Go's card submits only when every question has an answer, so a field the user may leave alone
// gets an option that says so.
function fieldOptions(field, w) {
  if (field.type === 'single' || field.type === 'multi') {
    const suggested = new Set(list(field.recommended ?? (field.optional || field.value === undefined ? undefined : field.value)));
    const marks = field.recommended !== undefined;
    const options = field.options.map(option => ({ answer: option.value, label: option.label,
      description: [marks && suggested.has(option.value) ? w.recommended : '', option.hint ?? ''].filter(Boolean).join(' · ') }));
    for (const extra of field.extra ?? []) options.push({ answer: extra.value, label: extra.label });
    if (field.optional) options.push({ answer: undefined, label: list(field.value).length > 0 && !marks ? w.keep(labelsOf(field)) : w.none });
    return uniqueLabels(options);
  }
  if (field.value !== undefined && field.value !== '') return [{ answer: field.value, label: w.keep(field.value + (field.unit ?? '')), description: w.current }];
  return field.optional ? [{ answer: undefined, label: w.blank }] : [];
}

const labelsOf = field => list(field.value).map(value => field.options.find(option => option.value === value)?.label ?? value).join('、');
const hintOf = (field, w) => ['time', 'date', 'number'].includes(field.type) ? w[field.type] : field.placeholder ?? '';

/**
 * The native question batch of one decision, and how to read its answers back.
 * @returns `{ questions, read }`; `read(answers)` gives `{ button, values }`, `{ dismiss: true }` or `{ error }`.
 */
export function mirrorRequest(decision, language = hostLanguage()) {
  const w = WORDS[language] ?? WORDS.en;
  const idOf = name => `${MIRROR_PREFIX}${decision.key}:${name}`.slice(0, 160);
  const rows = decision.fields.map((field, index) => ({ id: idOf(`${index}:${field.id}`), field, options: fieldOptions(field, w) }));
  const chooseAction = decision.kind === 'card';
  const actions = chooseAction ? uniqueLabels([
    ...decision.buttons.map(button => ({ button: button.id, label: button.label, description: button.style === 'danger' ? w.danger : '' })),
    { label: w.close }]) : [];
  const intro = [decision.subtitle, cardMarkdown(decision.blocks), decision.note].filter(Boolean).join('\n\n');
  const native = options => options.map(option => ({ label: option.label, ...option.description ? { description: option.description } : {} }));
  const questions = rows.map(({ id, field, options }) => ({ id, question: field.prompt || decision.title, options: native(options),
    ...field.type === 'multi' ? { multiSelect: true } : {}, ...hintOf(field, w) ? { detail: hintOf(field, w) } : {} }));
  if (chooseAction) questions.push({ id: idOf(ACTION), question: w.action, options: native(actions) });
  // The card's own words lead the batch: its title as the small heading, its content as the detail.
  const first = questions[0];
  if (first !== undefined) {
    first.header = decision.title === first.question ? decision.kicker : `${decision.kicker} · ${decision.title}`;
    const detail = [intro, first.detail].filter(Boolean).join('\n\n');
    if (detail) first.detail = detail;
  }
  function read(result) {
    const answers = new Map((result?.answers ?? []).map(answer => [answer.id, answer]));
    const values = {};
    for (const { id, field, options } of rows) {
      const answer = answers.get(id);
      const written = typeof answer?.custom === 'string' ? answer.custom.trim() : '';
      const picked = (answer?.selected ?? []).map(label => options.find(option => option.label === label)).filter(option => option?.answer !== undefined);
      const choice = field.type === 'single' || field.type === 'multi';
      if (written) {
        if (!choice) values[field.id] = written;
        else if (!field.custom && field.type !== 'multi') return { error: `${field.prompt || decision.title}: not one of the options / 请从选项中选择` };
        else values[field.id] = { custom: [...picked.map(option => option.label), written].join('、') };
      } else if (picked.length > 0) {
        values[field.id] = field.type === 'multi' ? picked.map(option => option.answer) : picked[0].answer;
      }
    }
    if (!chooseAction) return { button: decision.buttons.find(button => button.style === 'primary').id, values };
    const answer = answers.get(idOf(ACTION));
    const action = actions.find(option => answer?.selected?.includes(option.label));
    if (action?.button === undefined) return { dismiss: true, ...answer?.custom?.trim() ? { said: answer.custom.trim() } : {} };
    return { button: action.button, values };
  }
  return { questions, read };
}

// The host's question service speaks for root agents only. A subagent the user talks to directly uses the
// same forwarded event without it.
function asker(ctx, agent) {
  if (!isSubagentSession(agent.session)) {
    const service = ctx.get('userQuestions');
    return typeof service?.ask === 'function' ? request => service.ask(request) : undefined;
  }
  return async request => {
    const { scopeTarget } = await importHost('@deepseek-ai/dsh-scope');
    return ctx.waterfall(scopeTarget(agent, agent), 'user-questions/request', request,
      () => Promise.reject(Object.assign(new Error('no client can answer'), { code: 'NO_PROVIDER' })));
  };
}

/**
 * Keep one native question open for every decision that waits in a live conversation.
 * @param attention - lib/attention.mjs: `onOpen`, `onClose`, `submit`, `dismiss`.
 */
export function installMobileMirror(ctx, attention, options = {}) {
  const open = new Map();
  const language = options.language ?? hostLanguage();
  const enabled = () => { try { return options.enabled?.() !== false; } catch { return true; } };
  const stop = id => { const controller = open.get(id); open.delete(id); controller?.abort(); };

  async function ask({ id, agent, decision }) {
    if (agent === undefined || open.has(id)) return;
    const put = asker(ctx, agent);
    if (put === undefined) return;
    const controller = new AbortController();
    open.set(id, controller);
    let declined = false;
    try {
      // An answer the command refuses (a malformed time, say) is asked again with the reason on top.
      for (let error = ''; !controller.signal.aborted;) {
        const request = mirrorRequest(error ? { ...decision, note: [`**${error}**`, decision.note].filter(Boolean).join('\n\n') } : decision, language);
        const result = request.read(await put({ questions: request.questions, agent, signal: controller.signal }));
        if (controller.signal.aborted) return;
        const outcome = result.error ? result : result.dismiss ? await attention.dismiss(id, result.said, 'mobile') : await attention.submit(id, result.button, result.values, 'mobile');
        if (!outcome?.error) return;
        error = outcome.error;
      }
    } catch (error) {
      // Declined on the phone is the card's own close. Anything else (the card settled, the agent was
      // released, no client can answer) leaves the card as it is.
      declined = !controller.signal.aborted && error?.name === 'UserQuestionError' && DECLINED.has(error.code);
    } finally {
      if (open.get(id) === controller) open.delete(id);
    }
    if (declined) await attention.dismiss(id, undefined, 'mobile');
  }

  const offOpen = attention.onOpen(entry => { if (enabled()) void ask(entry); });
  const offClose = attention.onClose(entry => stop(entry.id));
  const sync = () => {
    if (!enabled()) { for (const id of [...open.keys()]) stop(id); return; }
    for (const entry of attention.list()) void ask(entry);
  };
  const unwatch = options.watch?.(sync);
  ctx.effect(() => () => { offOpen(); offClose(); unwatch?.(); for (const id of [...open.keys()]) stop(id); }, 'Deep PTC: native questions for cards');
}
