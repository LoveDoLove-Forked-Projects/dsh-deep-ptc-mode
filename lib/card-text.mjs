// A card outside the Deep PTC web client: as Markdown (native question details) and as a DSH Go view
// (the native tool card DSH Go draws from `meta["dsh-go/view"]`). Views use protocol v1 components
// only, so every DSH Go version that has tool cards can draw them.

import { objects } from './card-blocks.mjs';

export const VIEW_KEY = 'dsh-go/view';
// DSH Go's tool card budget: 8 KiB, 40 nodes, 16 children per container.
const MAX_VIEW_BYTES = 8 * 1024;
const MAX_NODES = 40;
const MAX_CHILDREN = 16;

const listOf = value => Array.isArray(value) ? value : [];
const measure = (value, suffix) => suffix ? `${value}${/^[%°]/u.test(suffix) ? '' : ' '}${suffix}` : String(value);
const cell = value => String(value ?? '').replace(/\|/gu, '\\|').replace(/\s*\n\s*/gu, ' ');
const MARK = { done: '✓', active: '▶', todo: '○', failed: '✗' };

function blockMarkdown(block) {
  const heading = block.title ? `**${block.title}**\n` : '';
  const items = listOf(block.items);
  switch (block.type) {
    case 'stats': return items.map(item => `- ${item.label}：**${item.value}**${item.delta ? ` (${item.delta})` : ''}${item.hint ? ` · ${item.hint}` : ''}`).join('\n');
    case 'rows': return items.map(item => `- ${item.label}${item.value ? `：${item.value}` : ''}`).join('\n');
    case 'progress': return items.map(item => `- ${item.label}：${item.value} / ${item.max ?? 100}`).join('\n');
    case 'bars':
    case 'donut': return heading + items.map(item => `- ${item.label}：${measure(item.value, block.unit)}`).join('\n');
    case 'line': return heading + listOf(block.points).map((point, index) =>
      block.labels?.[index] ? `${block.labels[index]} ${measure(point, block.unit)}` : measure(point, block.unit)).join(' → ');
    case 'steps': return items.map(item => `- ${MARK[item.state] ?? MARK.todo} ${item.label}${item.value ? ` · ${item.value}` : ''}`).join('\n');
    case 'table': return [`| ${listOf(block.columns).map(cell).join(' | ')} |`, `| ${listOf(block.columns).map(() => '---').join(' | ')} |`,
      ...listOf(block.rows).map(row => `| ${row.map(cell).join(' | ')} |`)].join('\n');
    case 'tags': return items.map(item => `\`${item.label}\``).join(' ');
    case 'text': return String(block.text ?? '');
    case 'callout': return `> ${String(block.text ?? '').replace(/\n/gu, '\n> ')}`;
    default: return '';
  }
}

/** Card blocks as Markdown, in order. */
export const cardMarkdown = blocks => listOf(blocks).map(blockMarkdown).filter(Boolean).join('\n\n');

// ---- DSH Go views -----------------------------------------------------------------------------

const TONE = { success: 'good', warn: 'warn', danger: 'bad', info: 'info' };
const STEP = { done: 'done', active: 'current', todo: 'todo', failed: 'failed' };
const toned = tone => TONE[tone] ? { tone: TONE[tone] } : {};
const clip = (value, max = 200) => String(value ?? '').slice(0, max);
const textNode = (value, muted) => ({ type: 'text', text: clip(value, 2000), ...muted ? { tone: 'muted' } : {} });

function blockView(block) {
  const items = listOf(block.items);
  const chart = { ...block.unit ? { unit: block.unit } : {}, ...block.title ? { caption: clip(block.title) } : {} };
  switch (block.type) {
    case 'stats': {
      const metrics = items.map(item => ({ type: 'metric', label: clip(item.label), value: clip(item.value), ...toned(item.tone),
        ...item.delta || item.hint ? { caption: clip([item.delta, item.hint].filter(Boolean).join(' · ')) } : {} }));
      return metrics.length > 1 ? [{ type: 'row', children: metrics }] : metrics;
    }
    case 'rows': return [{ type: 'keyValue', items: items.map(item => [clip(item.label), clip(item.value || '—')]) }];
    case 'progress': return items.map(item => ({ type: 'progress', label: clip(item.label), value: item.value, max: item.max ?? 100,
      caption: item.max === undefined ? `${item.value}%` : `${item.value} / ${item.max}`, ...toned(item.tone) }));
    case 'bars':
    case 'donut': return [{ type: 'chart', kind: block.type === 'bars' ? 'hbar' : 'donut', categories: items.map(item => clip(item.label)),
      series: [{ values: items.map(item => item.value) }], ...chart }];
    case 'line': return [{ type: 'chart', kind: 'line', categories: listOf(block.points).map((_, index) => clip(block.labels?.[index] ?? index + 1)),
      series: [{ values: listOf(block.points) }], ...chart }];
    case 'steps': return [{ type: 'steps', items: items.map(item => ({ label: clip(item.label), status: STEP[item.state] ?? 'todo', ...item.value ? { detail: clip(item.value) } : {} })) }];
    case 'table': return [{ type: 'table', columns: listOf(block.columns).map(value => clip(value)), rows: listOf(block.rows).map(row => row.map(value => clip(value))) }];
    case 'tags': return [textNode(items.map(item => `\`${item.label}\``).join(' '))];
    case 'text': return [textNode(block.text)];
    case 'callout': return [{ type: 'callout', text: clip(block.text, 2000), ...toned(block.tone) }];
    // Inputs are answered in the native question; the result line says what was chosen.
    default: return [];
  }
}

const WORDS = {
  zh: { waiting: '等待你的回答', closed: '已关闭', skipped: '未回答', chose: '已选择', running: '进行中', brief: '本次任务', project: '特点卡片提案',
    confirmed: '已确认', pending: '待确认', done: '已完成', more: count => `另有 ${count} 张卡片，请在电脑端查看。` },
  en: { waiting: 'Waiting for your answer', closed: 'Closed', skipped: 'Not answered', chose: 'Chosen', running: 'Running', brief: 'Task brief', project: 'Project card proposal',
    confirmed: 'Confirmed', pending: 'To review', done: 'Done', more: count => `${count} more card(s); see them on the desktop.` },
};
const wordsOf = language => WORDS[language] ?? WORDS.en;

function answerText(question, answer, w) {
  if (answer === undefined || answer === '' || (Array.isArray(answer) && answer.length === 0)) return w.skipped;
  if (objects(answer)) return String(answer.custom ?? '');
  if (question.type === 'text') return String(answer);
  return (Array.isArray(answer) ? answer : [answer]).map(value => question.options?.find(option => option.value === value)?.label ?? value).join('、');
}

/** One card version as a section: what it shows, and what the user decided. */
export function cardView(version, language) {
  const w = wordsOf(language);
  const children = version.subtitle ? [textNode(version.subtitle, true)] : [];
  if (version.kind === 'question') {
    const questions = listOf(version.questions);
    const answers = version.result?.answers;
    children.push(answers
      ? { type: 'keyValue', items: questions.map(question => [clip(question.prompt), clip(answerText(question, answers[question.id], w))]) }
      : { type: 'list', items: questions.map(question => ({ title: clip(question.prompt), icon: 'question',
        ...question.options?.length ? { subtitle: clip(question.options.map(option => option.label).join(' / ')) } : {} })) });
  } else {
    for (const block of listOf(version.blocks)) children.push(...blockView(block));
  }
  if (version.note) children.push(textNode(version.note, true));
  const errors = listOf(version.result?.errors);
  if (errors.length > 0) children.push({ type: 'callout', tone: 'bad', text: clip(errors.join('\n'), 2000) });
  else if (version.phase === 'dismissed') children.push(textNode(w.closed, true));
  else if (version.phase === 'stopping') children.push(textNode(w.running, true));
  else if (version.result?.label) children.push({ type: 'callout', tone: 'good', text: `${w.chose}：${version.result.label}` });
  else if (version.phase === 'open' && (version.kind === 'question' || version.actions?.length)) children.push({ type: 'callout', tone: 'info', text: w.waiting });
  return { title: clip(version.title, 80), children };
}

/** The task brief as a section. */
export function briefView(state, language) {
  const w = wordsOf(language);
  const rows = listOf(state?.items).filter(item => item.status !== 'dropped').slice(0, 24).map(item => {
    const done = item.status === 'done';
    const confirmed = item.basis === 'confirmed';
    return { title: clip(`${item.id}  ${item.text}`), icon: done ? 'done' : confirmed ? 'todo' : 'question', ...done ? { tone: 'good' } : {},
      trailing: done ? w.done : confirmed ? w.confirmed : w.pending };
  });
  return { title: `${w.brief} · v${state?.rev ?? 0}`, children: rows.length > 0 ? [{ type: 'list', items: rows }] : [] };
}

/** A project card proposal as a section. */
export function proposalView(proposal, language) {
  const w = wordsOf(language);
  const options = proposal.review?.options;
  const items = options ? options.map(option => ({ title: clip(option.label), ...option.hint ? { subtitle: clip(option.hint) } : {} }))
    : listOf(proposal.preview ?? proposal.items).map(item => ({ title: clip([item.id, item.text].filter(Boolean).join('  ')) }));
  return { title: clip(`${w.project} · ${proposal.title ?? ''}`, 80),
    children: [...proposal.reason ? [textNode(proposal.reason, true)] : [], ...items.length > 0 ? [{ type: 'list', items: items.slice(0, 16) }] : []] };
}

const countNodes = node => 1 + listOf(node.children).reduce((sum, child) => sum + countNodes(child), 0);

/**
 * Several sections as one tool card within DSH Go's budget. What does not fit is left out and counted,
 * so the card always parses.
 * @param sections - `[{ title, children }]` in the order they were posted.
 * @returns a view, or undefined when there is nothing to show.
 */
export function toolCardView(sections, language) {
  const w = wordsOf(language);
  const used = sections.filter(section => section.children.length > 0);
  if (used.length === 0) return undefined;
  const single = used.length === 1;
  const view = { type: 'stack', title: clip(used.map(section => section.title).join(' · '), 80), children: [] };
  const fits = () => countNodes(view) <= MAX_NODES - 1 && Buffer.byteLength(JSON.stringify(view), 'utf8') <= MAX_VIEW_BYTES - 256;
  let left = 0;
  for (const section of used) {
    // The app shows the root title on the card, so a single section needs no heading of its own.
    const nodes = [...single ? [] : [textNode(`**${section.title}**`)], ...section.children].slice(0, MAX_CHILDREN - 1);
    const node = { type: 'stack', children: nodes };
    if (view.children.length >= MAX_CHILDREN - 1) { left++; continue; }
    view.children.push(node);
    while (!fits() && nodes.length > 1) nodes.pop();
    if (!fits()) { view.children.pop(); left++; }
  }
  if (single && view.children.length === 1) view.children = view.children[0].children;
  if (left > 0) view.children.push(textNode(w.more(left), true));
  // Lossless JSON: the host rejects a result whose meta holds undefined.
  return JSON.parse(JSON.stringify(view));
}
