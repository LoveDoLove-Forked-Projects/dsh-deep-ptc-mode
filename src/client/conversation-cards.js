export function createConversationCards({ React, h, tf, commandText, commandCode, useFormValue }) {
  const CARD_PHASES = { stopping: 'cardStopping', stopped: 'cardStopped', failed: 'cardFailed', dismissed: 'cardDismissed' };
  // Built-in card layout. The model chooses blocks (lib/card-blocks.mjs); each block has one renderer
  // here, so every card shares one typography, spacing and colour system. Charts carry one series in
  // the validated categorical slots; every value is also printed, so colour never carries meaning alone.
  const svg = (size, children) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, ...children);
  const stroke = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const CARD_ICONS = {
    info: [h('circle', { key: 1, cx: 8, cy: 8, r: 6, ...stroke }), h('path', { key: 2, d: 'M8 7.2v3.6M8 5.2v.1', ...stroke })],
    chart: [h('path', { key: 1, d: 'M2.5 13.5h11M4.5 11V8M8 11V4.5M11.5 11V6.5', ...stroke })],
    clock: [h('circle', { key: 1, cx: 8, cy: 8, r: 6, ...stroke }), h('path', { key: 2, d: 'M8 4.8V8l2.2 1.4', ...stroke })],
    check: [h('circle', { key: 1, cx: 8, cy: 8, r: 6, ...stroke }), h('path', { key: 2, d: 'm5.4 8.2 1.8 1.8 3.5-3.8', ...stroke })],
    alert: [h('path', { key: 1, d: 'M8 2.5 14 13H2L8 2.5Z', ...stroke }), h('path', { key: 2, d: 'M8 6.5v3M8 11.3v.1', ...stroke })],
    task: [h('rect', { key: 1, x: 3, y: 2.5, width: 10, height: 11, rx: 2, ...stroke }), h('path', { key: 2, d: 'M5.8 6h4.4M5.8 8.5h4.4M5.8 11h2.4', ...stroke })],
    server: [h('rect', { key: 1, x: 2.5, y: 3, width: 11, height: 4, rx: 1.3, ...stroke }), h('rect', { key: 2, x: 2.5, y: 9, width: 11, height: 4, rx: 1.3, ...stroke }), h('path', { key: 3, d: 'M5 5h.1M5 11h.1', ...stroke })],
    spark: [h('path', { key: 1, d: 'M8 2.5 9.3 6.7 13.5 8l-4.2 1.3L8 13.5 6.7 9.3 2.5 8l4.2-1.3L8 2.5Z', ...stroke })],
    list: [h('path', { key: 1, d: 'M6 4.5h7.5M6 8h7.5M6 11.5h7.5M2.8 4.5h.1M2.8 8h.1M2.8 11.5h.1', ...stroke })],
    flow: [h('circle', { key: 1, cx: 4, cy: 4, r: 1.6, ...stroke }), h('circle', { key: 2, cx: 12, cy: 12, r: 1.6, ...stroke }), h('path', { key: 3, d: 'M4 5.6v2.9c0 1.1.9 2 2 2h4.4', ...stroke })],
  };
  const TONE_ICON = { info: 'info', success: 'check', warn: 'alert', danger: 'alert' };
  const CardIcon = ({ name, size = 16 }) => svg(size, CARD_ICONS[name] ?? CARD_ICONS.info);
  const SERIES = ['var(--cc-s1)', 'var(--cc-s2)', 'var(--cc-s3)', 'var(--cc-s4)', 'var(--cc-s5)'];
  const toneOf = value => ['success', 'warn', 'danger', 'neutral'].includes(value) ? value : undefined;

  function formatNumber(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '');
    const digits = Math.abs(value) >= 100 ? 0 : Math.abs(value) >= 10 ? 1 : 2;
    try { return value.toLocaleString(undefined, { maximumFractionDigits: digits }); } catch { return String(value); }
  }
  const withUnit = (value, unit) => unit ? `${formatNumber(value)} ${unit}`.replace(/ (%)$/u, '$1') : formatNumber(value);
  const caption = (title, side) => title || side ? h('p', { className: 'dpt-cc-cap' }, h('span', null, title ?? ''), side ? h('span', null, side) : null) : null;

  function StatsBlock({ block }) {
    const arrow = { up: '↑', down: '↓', flat: '→' };
    return h('div', { className: 'dpt-cc-stats' }, ...block.items.map((item, index) => h('div', { key: index, className: 'dpt-cc-stat', 'data-tone': toneOf(item.tone) },
      h('span', { className: 'dpt-cc-stat-label', title: item.label }, item.label),
      h('span', { className: 'dpt-cc-stat-value' }, item.value),
      item.delta || item.hint ? h('span', { className: 'dpt-cc-stat-foot' },
        item.delta ? h('span', { className: 'dpt-cc-delta', 'data-tone': toneOf(item.tone) }, `${arrow[item.trend] ?? ''}${item.trend ? ' ' : ''}${item.delta}`) : null,
        item.hint ? h('span', null, item.hint) : null) : null)));
  }

  function RowsBlock({ block }) {
    return h('dl', { className: 'dpt-cc-rows' }, ...block.items.flatMap((row, index) => [
      h('dt', { key: `k${index}` }, row.label), h('dd', { key: `v${index}` }, row.value ?? '')]));
  }

  function ProgressBlock({ block }) {
    return h('div', null, ...block.items.map((item, index) => {
      const max = item.max ?? 100;
      const ratio = Math.max(0, Math.min(1, item.value / max));
      const shown = item.max === undefined ? `${formatNumber(item.value)}%` : `${formatNumber(item.value)} / ${formatNumber(max)}`;
      return h('div', { key: index, className: 'dpt-cc-meter' },
        h('div', { className: 'dpt-cc-meter-head' }, h('span', null, item.label), h('span', null, shown)),
        h('div', { className: 'dpt-cc-track', role: 'progressbar', 'aria-label': item.label, 'aria-valuemin': 0, 'aria-valuemax': max, 'aria-valuenow': item.value, 'data-tone': toneOf(item.tone) },
          h('span', { className: 'dpt-cc-fill', style: { width: `${ratio * 100}%` } })));
    }));
  }

  function BarsBlock({ block }) {
    const peak = Math.max(...block.items.map(item => item.value), 0) || 1;
    return h('figure', { style: { margin: 0 } }, caption(block.title, block.unit),
      h('ul', { className: 'dpt-cc-bars' }, ...block.items.map((item, index) => h('li', { key: index, title: `${item.label}: ${withUnit(item.value, block.unit)}` },
        h('span', { className: 'dpt-cc-bar-label' }, item.label),
        h('span', { className: 'dpt-cc-bar-track' }, h('span', { className: 'dpt-cc-bar', 'data-tone': toneOf(item.tone), style: { width: `${(item.value / peak) * 100}%` } })),
        h('span', { className: 'dpt-cc-bar-value' }, withUnit(item.value, block.unit))))));
  }

  // One series over ordered points, with a crosshair and a tooltip for the nearest point.
  function LineBlock({ block }) {
    const [hover, setHover] = React.useState();
    const points = block.points;
    const lo = Math.min(...points);
    const hi = Math.max(...points);
    const span = hi - lo || 1;
    const W = 300;
    const H = 96;
    const pad = 6;
    const x = index => points.length === 1 ? W / 2 : (index / (points.length - 1)) * W;
    const y = value => pad + (1 - (value - lo) / span) * (H - pad * 2);
    const path = points.map((value, index) => `${index ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(' ');
    const area = `${path} L${W} ${H} L0 ${H} Z`;
    const label = index => block.labels?.[index] ?? `#${index + 1}`;
    const last = points[points.length - 1];
    const move = event => {
      const box = event.currentTarget.getBoundingClientRect?.();
      if (!box || box.width === 0) return;
      const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
      setHover(Math.round(ratio * (points.length - 1)));
    };
    const summary = points.map((value, index) => `${label(index)} ${withUnit(value, block.unit)}`).join(', ');
    return h('figure', { style: { margin: 0 } },
      caption(block.title, `${withUnit(last, block.unit)}`),
      h('div', { className: 'dpt-cc-chart', onPointerMove: move, onPointerLeave: () => setHover(undefined) },
        h('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `${block.title ?? ''} ${summary}`.trim() },
          h('line', { className: 'dpt-cc-grid', x1: 0, x2: W, y1: y(hi), y2: y(hi) }),
          h('line', { className: 'dpt-cc-grid', x1: 0, x2: W, y1: y(lo), y2: y(lo) }),
          h('path', { className: 'dpt-cc-area', d: area }),
          h('path', { className: 'dpt-cc-line', d: path }),
          hover !== undefined ? h('line', { className: 'dpt-cc-cross', x1: x(hover), x2: x(hover), y1: 0, y2: H }) : null),
        h('span', { className: 'dpt-cc-dot', style: { left: `${(x(hover ?? points.length - 1) / W) * 100}%`, top: `${(y(points[hover ?? points.length - 1]) / H) * 100}%` } }),
        hover !== undefined ? h('span', { className: 'dpt-cc-tip', role: 'status', style: { left: `${(x(hover) / W) * 100}%`, top: `${(y(points[hover]) / H) * 100}%` } },
          `${label(hover)} · ${withUnit(points[hover], block.unit)}`) : null),
      h('div', { className: 'dpt-cc-axis' },
        h('span', null, block.labels?.[0] ?? `min ${withUnit(lo, block.unit)}`),
        h('span', null, block.labels ? block.labels[points.length - 1] : `max ${withUnit(hi, block.unit)}`)));
  }

  // Share of a whole: segments with a 2px gap, the total in the middle and a labelled legend.
  function DonutBlock({ block, t }) {
    const [hover, setHover] = React.useState();
    const total = block.items.reduce((sum, item) => sum + item.value, 0) || 1;
    const R = 40;
    const C = 2 * Math.PI * R;
    const gap = block.items.filter(item => item.value > 0).length > 1 ? 2 : 0;
    let offset = 0;
    const segments = block.items.map((item, index) => {
      const length = (item.value / total) * C;
      const segment = { index, dash: Math.max(0, length - gap), offset };
      offset += length;
      return segment;
    });
    const pct = value => `${Math.round((value / total) * 1000) / 10}%`;
    return h('figure', { style: { margin: 0 } }, caption(block.title),
      h('div', { className: 'dpt-cc-donut', 'data-hover': hover === undefined ? undefined : '' },
        h('svg', { viewBox: '0 0 100 100', role: 'img', 'aria-label': block.items.map(item => `${item.label} ${withUnit(item.value, block.unit)} (${pct(item.value)})`).join(', ') },
          h('g', { transform: 'rotate(-90 50 50)' }, ...segments.map(segment => h('circle', { key: segment.index, className: 'dpt-cc-seg', cx: 50, cy: 50, r: R,
            stroke: SERIES[segment.index], strokeDasharray: `${segment.dash} ${C}`, strokeDashoffset: -segment.offset,
            'data-on': hover === segment.index ? '' : undefined,
            onPointerEnter: () => setHover(segment.index), onPointerLeave: () => setHover(undefined) }))),
          h('text', { className: 'dpt-cc-total', x: 50, y: 52, textAnchor: 'middle' }, hover === undefined ? withUnit(total, block.unit) : pct(block.items[hover].value)),
          h('text', { className: 'dpt-cc-total-sub', x: 50, y: 64, textAnchor: 'middle' }, hover === undefined ? t('cardTotal') : block.items[hover].label)),
        h('ul', { className: 'dpt-cc-legend' }, ...block.items.map((item, index) => h('li', { key: index, 'data-on': hover === index ? '' : undefined,
          onPointerEnter: () => setHover(index), onPointerLeave: () => setHover(undefined) },
          h('span', { className: 'dpt-cc-swatch', style: { background: SERIES[index] } }),
          h('span', null, item.label),
          h('span', { className: 'dpt-cc-num' }, withUnit(item.value, block.unit)),
          h('span', { className: 'dpt-cc-pct' }, pct(item.value)))))));
  }

  function StepsBlock({ block, t }) {
    const mark = state => state === 'done' ? svg(10, [h('path', { key: 1, d: 'm3.5 8.3 3 3 6-6.3', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' })])
      : state === 'failed' ? svg(10, [h('path', { key: 1, d: 'm4.5 4.5 7 7m0-7-7 7', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' })]) : null;
    return h('ol', { className: 'dpt-cc-steps' }, ...block.items.map((item, index) => h('li', { key: index, className: 'dpt-cc-step', 'data-state': item.state },
      h('span', { className: 'dpt-cc-mark' }, mark(item.state)),
      h('span', { className: 'dpt-cc-step-text' },
        h('span', { className: 'dpt-cc-sr' }, `${t(`cardStep_${item.state}`)}: `),
        h('span', { className: 'dpt-cc-step-label' }, item.label),
        item.value ? h('span', { className: 'dpt-cc-step-value' }, item.value) : null))));
  }

  function TableBlock({ block }) {
    return h('div', { className: 'dpt-cc-table-wrap' }, h('table', { className: 'dpt-cc-table' },
      h('thead', null, h('tr', null, ...block.columns.map((column, index) => h('th', { key: index, scope: 'col' }, column)))),
      h('tbody', null, ...block.rows.map((row, index) => h('tr', { key: index }, ...row.map((cell, column) => h('td', { key: column }, cell)))))));
  }

  const TagsBlock = ({ block }) => h('div', { className: 'dpt-cc-tags' }, ...block.items.map((item, index) =>
    h('span', { key: index, className: 'dpt-cc-tag', 'data-tone': toneOf(item.tone) }, item.label)));
  const TextBlock = ({ block }) => h('p', { className: 'dpt-cc-text' }, block.text);
  const CalloutBlock = ({ block }) => {
    const tone = block.tone && block.tone !== 'info' ? block.tone : undefined;
    return h('div', { className: 'dpt-cc-callout', 'data-tone': tone, role: tone === 'danger' ? 'alert' : undefined },
      h(CardIcon, { name: TONE_ICON[block.tone] ?? 'info' }), h('span', null, block.text));
  };

  // Interactive blocks. Their values live in the card view until a button sends them; the server
  // validates them again before anything runs.
  function ChoiceBlock({ block, value, setValue, disabled, allowCustom, t }) {
    const [writing, setWriting] = React.useState(false);
    const picked = Array.isArray(value) ? value : value === undefined ? [] : [value];
    // A written answer is any value outside the listed options; picking one replaces it.
    const written = allowCustom === true && typeof value === 'string' && value !== ''
      && !block.options.some(option => option.value === value);
    const open = written || (allowCustom === true && writing && value === '');
    const toggle = option => {
      if (!block.multiple) { setWriting(false); return setValue(option); }
      setValue(picked.includes(option) ? picked.filter(item => item !== option) : [...picked, option]);
    };
    return h('div', { className: 'dpt-cc-choice', role: block.multiple ? 'group' : 'radiogroup', 'aria-label': block.label ?? block.name },
      block.label ? h('p', { className: 'dpt-cc-cap' }, h('span', null, block.label)) : null,
      h('div', { className: 'dpt-cc-options' }, ...block.options.map(option => {
        const on = picked.includes(option.value);
        return h('button', { key: typeof option.value === 'symbol' ? ':custom answer' : option.value, type: 'button', className: 'dpt-cc-option', disabled,
          role: block.multiple ? 'checkbox' : 'radio', 'aria-checked': on, 'data-multiple': block.multiple ? '' : undefined,
          onClick: () => toggle(option.value) },
          h('span', { className: 'dpt-cc-option-mark', 'aria-hidden': 'true' }),
          h('span', { className: 'dpt-cc-option-text' },
            h('span', { className: 'dpt-cc-option-label' }, option.label),
            option.hint ? h('span', { className: 'dpt-cc-option-hint' }, option.hint) : null));
      }), allowCustom === true ? h('button', { key: ':written answer', type: 'button', className: 'dpt-cc-option', disabled,
        role: 'radio', 'aria-checked': open, onClick: () => { setWriting(true); setValue(''); } },
        h('span', { className: 'dpt-cc-option-mark', 'aria-hidden': 'true' }),
        h('span', { className: 'dpt-cc-option-text' }, h('span', { className: 'dpt-cc-option-label' }, t('reviewOther')))) : null),
      open ? h('textarea', { className: 'dpt-cq-text', rows: 2, value: written ? value : '', maxLength: 300, disabled,
        placeholder: t('cardOtherHint'), 'aria-label': block.label ?? block.name,
        onChange: event => setValue(event.target.value) }) : null);
  }

  function FieldBlock({ block, value, setValue, disabled }) {
    const id = React.useId ? React.useId() : `dpt-field-${block.name}`;
    return h('div', { className: 'dpt-cc-field' },
      h('label', { htmlFor: id }, block.label),
      h('span', { className: 'dpt-cc-input-wrap' },
        h('input', { id, className: 'dpt-cc-input', type: block.kind, value: value ?? '', disabled,
          ...block.kind === 'number' ? { min: block.min, max: block.max, step: block.step ?? 'any', inputMode: 'decimal' } : {},
          onChange: event => setValue(event.target.value) }),
        block.unit ? h('span', { className: 'dpt-cc-input-unit' }, block.unit) : null));
  }

  const BLOCK_VIEWS = { stats: StatsBlock, rows: RowsBlock, progress: ProgressBlock, bars: BarsBlock, line: LineBlock,
    donut: DonutBlock, steps: StepsBlock, table: TableBlock, tags: TagsBlock, text: TextBlock, callout: CalloutBlock,
    choice: ChoiceBlock, field: FieldBlock };
  const INTERACTIVE = new Set(['choice', 'field']);

  // A block the client does not know (a newer server) is skipped rather than breaking the card.
  function CardBlock({ block, t, values, setValue, disabled, actions }) {
    const View = BLOCK_VIEWS[block?.type];
    if (!View) return null;
    const input = INTERACTIVE.has(block.type) ? { value: values[block.name], setValue: next => setValue(block.name, next), disabled } : {};
    // A choice the card's commands never substitute keeps the user's 「其他」 answer.
    const custom = block.type === 'choice' && !block.multiple && !commandBound(actions, block.name);
    return h(Boundary, null, h(View, { block, t, ...input, ...(custom ? { allowCustom: true } : {}) }));
  }

  // Initial input values: what the user last sent, else what the card preselects.
  function initialValues(card) {
    const values = {};
    for (const block of Array.isArray(card.blocks) ? card.blocks : []) {
      if (!INTERACTIVE.has(block?.type) || !block.name) continue;
      const sent = card.result?.values?.[block.name];
      values[block.name] = sent !== undefined ? (block.multiple ? sent.split(' ').filter(Boolean) : sent) : block.value;
    }
    return values;
  }

  const PLACEHOLDERS = /\{([A-Za-z][A-Za-z0-9_]{0,23})\}/gu;
  // A value a button command substitutes: a written answer must never reach it.
  const commandBound = (actions, name) => (actions ?? []).some(action =>
    typeof action.run?.command === 'string' && action.run.command.includes('{' + name + '}'));
  const present = value => value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);
  const flat = value => Array.isArray(value) ? value.join(' ') : String(value);

  // Names a button needs before it can be pressed: every {name} its command or reply uses.
  function missingFor(action, values) {
    const templates = [action.run?.command, typeof action.reply === 'string' ? action.reply : undefined].filter(Boolean);
    return [...new Set(templates.flatMap(template => [...template.matchAll(PLACEHOLDERS)].map(match => match[1])))]
      .filter(name => !present(values[name]));
  }

  // The message a reply button sends: the card's template, or a readable summary of the choice.
  function replyText(card, action, values) {
    if (typeof action.reply === 'string') return action.reply.replace(PLACEHOLDERS, (whole, name) => present(values[name]) ? flat(values[name]) : whole);
    const parts = [];
    for (const block of card.blocks ?? []) {
      if (!INTERACTIVE.has(block?.type) || !present(values[block.name])) continue;
      const shown = block.type === 'choice'
        ? (Array.isArray(values[block.name]) ? values[block.name] : [values[block.name]])
          .map(value => block.options.find(option => option.value === value)?.label ?? value).join('、')
        : flat(values[block.name]);
      parts.push(`${block.label ?? block.name}：${shown}`);
    }
    return `【${card.title}】${action.label ?? ''}${parts.length > 0 ? `（${parts.join('；')}）` : ''}`;
  }

  // The server delivers the model's view of an answer or reply itself (lib/model-view.mjs) and says
  // so with the original 2.1.0 receipt or a coded receipt; otherwise the client sends its text reply.
  const legacyReceipts = new Set([
    'Answer sent to the model. / 已把回答发给模型。',
    'Choice sent to the model. / 已把选择发给模型。',
    'Card action completed and reported to the model. / 卡片操作已完成并告知模型。',
  ]);
  function deliveredByServer(result) {
    const outcome = result?.value?.result ?? result?.value;
    return outcome?.kind === 'success' && (legacyReceipts.has(outcome.text) || commandCode(outcome.text)?.startsWith('delivered:') === true);
  }

  // The host command's outcome, reduced to an error text or nothing.
  function commandError(result, t) {
    if (result?.ok === false) return result.error?.message ?? 'failed';
    const outcome = result?.value?.result ?? result?.value;
    return outcome?.kind === 'error' ? commandText(outcome.text, t) : undefined;
  }

  const needsDecision = card => card.phase === 'open' && !card.result &&
    (card.kind === 'question' || !!card.actions?.length);

  // Why a version cannot take clicks, mirroring archivedReason() in lib/card-state.mjs.
  function archivedReason(state, version, latest) {
    if (latest.get(version.id)?.rev !== version.rev) return 'superseded';
    if (version.phase === 'dismissed') return 'dismissed';
    if (version.turn !== state.turn && !needsDecision(version)) return 'earlier-turn';
    if (version.phase !== 'open') return 'settled';
    return undefined;
  }
  const ARCHIVE_LABEL = { superseded: 'cardSuperseded', 'earlier-turn': 'cardArchived' };
  const closeButton = (t, disabled, onClick) => h('button', { type: 'button', className: 'dpt-cc-close', disabled, 'aria-label': t('cardDismiss'), title: t('cardDismiss'), onClick },
    svg(14, [h('path', { key: 1, d: 'm4.5 4.5 7 7m0-7-7 7', ...stroke })]));

  function CardHead({ card, t, badge, onClose, pending }) {
    return h('header', { className: 'dpt-cc-head' },
      h('span', { className: 'dpt-cc-icon' }, h(CardIcon, { name: card.icon ?? TONE_ICON[card.tone] ?? 'info' })),
      h('div', { className: 'dpt-cc-titles' },
        h('span', { className: 'dpt-cc-title' }, card.title),
        card.subtitle ? h('span', { className: 'dpt-cc-sub' }, card.subtitle) : null),
      badge ? h('span', { className: 'dpt-cc-pill', 'data-phase': badge.phase, role: 'status' }, badge.text) : null,
      onClose ? closeButton(t, pending, onClose) : null);
  }

  // A closed card collapses to one line in the history and can be read again.
  function ClosedStub({ card, t }) {
    const [open, setOpen] = React.useState(false);
    if (open) return h('div', { className: 'dpt-cc-stub-open' },
      h('button', { type: 'button', className: 'dpt-cc-stub', 'aria-expanded': true, onClick: () => setOpen(false) }, tf(t, 'cardClosedStub', { title: card.title })),
      h(CardView, { card, archived: 'dismissed', t }));
    return h('button', { type: 'button', className: 'dpt-cc-stub', 'aria-expanded': false, onClick: () => setOpen(true) }, tf(t, 'cardClosedStub', { title: card.title }));
  }

  function CardView({ card, size = card.size, archived, run, reply, pending, t }) {
    const blocks = Array.isArray(card.blocks) ? card.blocks
      : Array.isArray(card.lines) && card.lines.length > 0 ? [{ type: 'rows', items: card.lines }] : [];
    const actions = Array.isArray(card.actions) ? card.actions : [];
    const [values, setValues] = React.useState(() => initialValues(card));
    const [message, setMessage] = React.useState();
    const live = archived === undefined;
    const errors = Array.isArray(card.result?.errors) ? card.result.errors : [];
    const setValue = (name, value) => { setValues(current => ({ ...current, [name]: value })); setMessage(undefined); };
    async function press(action) {
      setMessage(undefined);
      const result = await run('act', { key: action.id, values });
      const error = commandError(result, t);
      if (error !== undefined) { setMessage(error); return; }
      if (action.reply && !deliveredByServer(result)) {
        const sent = await reply(replyText(card, action, values));
        if (sent === false) setMessage(t('cardReplyFailed'));
      }
    }
    // Settled or archived: say what happened, quietly, in the corner.
    const badge = card.phase === 'stopping' ? { phase: 'stopping', text: t('cardStopping') }
      : card.phase === 'failed' ? { phase: 'failed', text: t('cardFailed') }
      : card.result?.label && card.phase !== 'open' ? { phase: 'stopped', text: tf(t, 'cardChose', { action: card.result.label }) }
      : ARCHIVE_LABEL[archived] ? { phase: 'archived', text: t(ARCHIVE_LABEL[archived]) } : undefined;
    return h('section', { className: 'dpt-cc', 'data-tone': card.tone && card.tone !== 'info' ? card.tone : undefined,
      'data-size': size === 'half' || size === 'third' ? size : undefined, 'data-archived': live ? undefined : archived, 'aria-label': card.title },
      h(CardHead, { card, t, badge, pending, onClose: live ? () => { void run('dismiss'); } : undefined }),
      blocks.length > 0 ? h('div', { className: 'dpt-cc-body' }, ...blocks.map((block, index) =>
        h(CardBlock, { key: index, block, t, values, setValue, disabled: pending || !live, actions }))) : null,
      errors.length > 0 ? h('ul', { className: 'dpt-cc-errors' }, ...errors.map((error, index) => h('li', { key: index }, error))) : null,
      card.result?.jobId ? h('p', { className: 'dpt-cc-note', role: 'status' }, `${t('jobs')} · ${card.result.jobId}`) : null,
      message ? h('p', { className: 'dpt-cc-errors', role: 'alert' }, message) : null,
      card.note || (live && actions.length > 0) ? h('footer', { className: 'dpt-cc-foot' },
        card.note ? h('p', { className: 'dpt-cc-note' }, card.note) : null,
        live && actions.length > 0 ? h('div', { className: 'dpt-cc-actions' }, ...actions.map(action => {
          const missing = missingFor(action, values);
          return h('button', { key: action.id, type: 'button', className: 'dpt-cc-btn',
            'data-primary': action.style === 'primary' ? '' : undefined, 'data-danger': action.style === 'danger' ? '' : undefined,
            disabled: pending || missing.length > 0, 'aria-busy': pending,
            title: missing.length > 0 ? tf(t, 'cardNeeds', { names: missing.join(', ') }) : undefined,
            onClick: () => { void press(action); } }, action.label ?? t('cardStopDefault'));
        })) : null) : null);
  }

  // ---- Question cards ---------------------------------------------------------------------------
  const QuestionIcon = () => svg(16, [h('circle', { key: 1, cx: 8, cy: 8, r: 6, ...stroke }),
    h('path', { key: 2, d: 'M6.3 6.4a1.8 1.8 0 1 1 2.5 1.7c-.5.2-.8.6-.8 1.1v.4M8 11.3v.1', ...stroke })]);

  function initialAnswers(card) {
    if (card.result?.answers) return card.result.answers;
    const answers = {};
    if (card.review) return answers;
    for (const question of card.questions ?? []) if (question.recommended !== undefined) answers[question.id] = question.recommended;
    return answers;
  }

  // The message an answer sends: every question with the answer, the same shape answerMessage() builds.
  function answerText(card, answers, t) {
    const lines = (card.questions ?? []).map((question, index) => {
      const answer = answers[question.id];
      const shown = answer === undefined || answer === '' || (Array.isArray(answer) && answer.length === 0) ? t('questionSkipped')
        : answer?.custom ?? (question.type === 'text' ? answer
          : (Array.isArray(answer) ? answer : [answer]).map(value => question.options.find(option => option.value === value)?.label ?? value).join('、'));
      return `${index + 1}. ${question.prompt}\n   → ${shown}`;
    });
    return `${tf(t, 'questionReplyHead', { title: card.title })}\n${lines.join('\n')}`;
  }

  const CUSTOM = Symbol('custom answer');
  function QuestionField({ question, value, setValue, disabled, answered, review, t }) {
    if (question.type === 'text') {
      if (answered) return h('p', { className: 'dpt-cq-answer' }, value || '—');
      return h('textarea', { className: 'dpt-cq-text', rows: 2, value: value ?? '', placeholder: question.placeholder, disabled,
        'aria-label': question.prompt, onChange: event => setValue(event.target.value) });
    }
    const block = { name: question.id, options: question.options, multiple: question.type === 'multi' };
    if (answered) {
      if (value?.custom !== undefined) return h('p', { className: 'dpt-cq-answer' }, value.custom);
      // An answered question shows only what was chosen.
      const picked = new Set(Array.isArray(value) ? value : value === undefined ? [] : [value]);
      return h('div', { className: 'dpt-cc-tags' }, ...question.options.filter(option => picked.has(option.value))
        .map(option => h('span', { key: option.value, className: 'dpt-cc-tag', 'data-tone': 'success' }, option.label)));
    }
    // Every option question ends with 「其他」: the options may not cover what the user means, and a
    // written answer reaches the model exactly like a chosen one.
    const custom = value?.custom !== undefined;
    const options = [...block.options, { value: CUSTOM, label: t('reviewOther') }];
    return h(React.Fragment, null,
      h(ChoiceBlock, { block: { ...block, options }, value: custom ? CUSTOM : value, disabled,
        setValue: next => {
          if (next === CUSTOM || (Array.isArray(next) && next.includes(CUSTOM) && !custom)) setValue({ custom: value?.custom ?? '' });
          else setValue(Array.isArray(next) ? next.filter(v => v !== CUSTOM) : next);
        } }),
      custom ? h('textarea', { className: 'dpt-cq-text', autoFocus: true, rows: 2, value: value.custom, maxLength: 1000, disabled,
        placeholder: t(review ? 'reviewRewriteHint' : 'questionOtherHint'), 'aria-label': question.prompt,
        onChange: e => setValue({ custom: e.target.value }) }) : null);
  }

  function QuestionCard({ card, archived, run, reply, pending, t, onAnswer, kicker, children }) {
    const [draft, setAnswers] = React.useState(() => initialAnswers(card));
    const answers = card.result?.answers ?? draft;
    const [message, setMessage] = React.useState();
    const live = archived === undefined;
    const answered = card.phase === 'answered';
    const questions = live && card.review ? card.questions.slice(0, 1) : card.questions ?? [];
    const missing = questions.filter(question => question.optional !== true && !present(answers[question.id]?.custom?.trim() ?? answers[question.id]));
    async function submit(event) {
      event?.preventDefault?.();
      setMessage(undefined);
      if (!live || pending || missing.length) return;
      if (onAnswer) {
        try { setMessage(await onAnswer(answers.decision)); } catch (error) { setMessage(String(error?.message ?? error)); }
        return;
      }
      const result = await run('answer', { answers });
      const error = commandError(result, t);
      if (error !== undefined) { setMessage(error); return; }
      if (deliveredByServer(result)) return;
      const sent = await reply(answerText(card, answers, t));
      if (sent === false) setMessage(t('cardReplyFailed'));
    }
    // A briefing card's answer is recorded at once but reaches the model only when the whole batch is
    // answered, so it says "recorded" rather than "sent".
    const status = answered ? { phase: 'stopped', text: t(card.briefing ? 'questionRecorded' : 'questionAnswered') }
      : live ? { phase: 'question', text: t('questionWaiting') } : { phase: 'archived', text: t('questionUnanswered') };
    // A briefing card names the batch and its place in it, so the user knows how many are still open.
    const heading = card.briefing && Number.isSafeInteger(card.seriesIndex) && Number.isSafeInteger(card.seriesTotal)
      ? tf(t, 'questionBatch', { index: card.seriesIndex, total: card.seriesTotal })
      : t(kicker ?? (card.review === 'brief' ? 'briefClarify' : card.review === 'project' ? 'projectClarify' : 'questionKicker'));
    // The confirmation card of an unattended run shows the settings it will follow as a short table.
    const summary = Array.isArray(card.summary) && card.summary.length > 0
      ? h('dl', { className: 'dpt-cc-rows dpt-cq-summary' }, ...card.summary.flatMap((row, index) => [
        h('dt', { key: `k${index}` }, row.label), h('dd', { key: `v${index}` }, row.value ?? '')]))
      : null;
    return h('form', { className: 'dpt-cc dpt-cq', 'data-answered': answered ? '' : undefined, 'data-archived': live ? undefined : archived,
      'data-family': card.review === 'project' ? 'project' : card.review === 'brief' ? 'task' : undefined,
      'aria-label': card.title, onSubmit: event => { void submit(event); } },
      h('header', { className: 'dpt-cc-head' },
        h('span', { className: 'dpt-cc-icon dpt-cq-icon' }, h(QuestionIcon)),
        h('div', { className: 'dpt-cc-titles' },
          h('span', { className: 'dpt-cq-kicker' }, heading),
          h('span', { className: 'dpt-cc-title' }, card.title),
          card.subtitle ? h('span', { className: 'dpt-cc-sub' }, card.subtitle) : null),
        h('span', { className: 'dpt-cc-pill', 'data-phase': status.phase, role: 'status' }, status.text)),
      summary,
      h('ol', { className: 'dpt-cq-list' }, ...questions.map((question, index) => h('li', { key: question.id, className: 'dpt-cq-item' },
        card.title === question.prompt && onAnswer ? null : h('p', { className: 'dpt-cq-prompt' }, h('span', { className: 'dpt-cq-num' }, index + 1), question.prompt,
          question.optional ? h('span', { className: 'dpt-cq-optional' }, t('questionOptional')) : null),
        children,
        h(QuestionField, { question, value: answers[question.id], answered, disabled: pending || !live, review: card.review, t,
          setValue: value => { setAnswers({ ...answers, [question.id]: value }); setMessage(undefined); } })))),
      message ? h('p', { className: 'dpt-cc-errors', role: 'alert' }, message) : null,
      live ? h('footer', { className: 'dpt-cc-foot' },
        h('p', { className: 'dpt-cc-note' }, missing.length > 0 ? tf(t, 'questionRemaining', { count: missing.length }) : t('questionReady')),
        h('div', { className: 'dpt-cc-actions' },
          h('button', { type: 'submit', className: 'dpt-cc-btn', 'data-primary': '', disabled: pending || missing.length > 0, 'aria-busy': pending }, t('questionSubmit')))) : null);
  }

  function DecisionCard({ kind, title, text, review, selected, children, onDecide, outcome, feedback, allowYes = true, t }) {
    const [busy, setBusy] = React.useState(false);
    const variants = review?.options;
    const candidates = variants?.map(option => ({ value: option.value, label: option.label,
      hint: [option.text !== option.label ? option.text : '', option.hint].filter(Boolean).join(' · ') })) ??
      [{ value: 'yes', label: text }];
    const question = { id: 'decision', type: 'single', prompt: review?.question ?? title,
      options: [...(allowYes ? candidates : []), { value: 'no', label: t('reviewSkip') }] };
    const value = outcome === 'returned' ? { custom: feedback } : outcome === 'declined' ? 'no' : selected ?? 'yes';
    const card = { title: question.prompt, review: kind, questions: [question], phase: outcome ? 'answered' : 'open',
      ...(outcome ? { result: { answers: { decision: value } } } : {}) };
    async function submit(answer) {
      setBusy(true);
      try { return await onDecide(answer); } finally { setBusy(false); }
    }
    return h(QuestionCard, { card, archived: outcome, kicker: kind === 'brief' ? 'briefTitle' : 'projectTab',
      onAnswer: submit, pending: busy, t }, children);
  }

  // Inputs restart from the card's own values whenever the model posts a new version.
  const versionKey = version => `${version.id}:${version.rev}`;

  // ---- Layout -----------------------------------------------------------------------------------
  // How much room a card's content needs: 'wide' content keeps the full width, 'compact' content
  // can share a row with one neighbour, 'tiny' content with two.
  function cardFootprint(card) {
    if (card.kind === 'question') return 'wide';
    const blocks = Array.isArray(card.blocks) ? card.blocks : [];
    const count = block => Array.isArray(block.items) ? block.items.length : 0;
    const wide = blocks.some(block => block.type === 'table' || (block.type === 'line' && (block.points?.length ?? 0) > 12)
      || (block.type === 'choice' && (block.options?.length ?? 0) > 4) || (block.type === 'bars' && count(block) > 6)
      || (block.type === 'steps' && count(block) > 6) || (block.type === 'stats' && count(block) > 4) || (block.type === 'rows' && count(block) > 6)
      || (block.type === 'donut' && count(block) > 6) || ((block.type === 'text' || block.type === 'callout') && (block.text?.length ?? 0) > 280));
    if (wide || blocks.length > 3 || (card.actions?.length ?? 0) > 3) return 'wide';
    const tiny = blocks.length <= 1 && (card.actions?.length ?? 0) <= 1
      && blocks.every(block => (block.type === 'stats' && count(block) <= 2) || (block.type === 'progress' && count(block) <= 1)
        || (block.type === 'rows' && count(block) <= 2) || block.type === 'tags');
    return tiny ? 'tiny' : 'compact';
  }

  /**
   * Widths for the cards of one turn, in order. Consecutive narrow cards share rows (two halves, or
   * three thirds when all three are tiny); a narrow card with no partner takes the full width rather
   * than leaving a gap. An explicit size is kept unless it would stand alone.
   */
  function layoutSizes(cards) {
    const sizes = new Map();
    let run = [];
    const flush = () => {
      if (run.length === 1) sizes.set(run[0], 'full');
      else if (run.length === 3 && run.every(card => (card.size ?? (cardFootprint(card) === 'tiny' ? 'third' : 'half')) === 'third')) {
        for (const card of run) sizes.set(card, 'third');
      } else {
        run.forEach((card, index) => sizes.set(card, index === run.length - 1 && run.length % 2 === 1 ? 'full' : 'half'));
      }
      run = [];
    };
    for (const card of cards) {
      const narrow = card.size === 'half' || card.size === 'third' || (card.size === undefined && cardFootprint(card) !== 'wide');
      if (!narrow) { flush(); sizes.set(card, 'full'); continue; }
      run.push(card);
      if (run.length === 3) flush();
    }
    flush();
    return sizes;
  }

  // Each turn draws the card versions posted in it; only the newest version in the latest turn is live.
  // Every pending card shows where it was posted, at once: no card waits hidden behind another, so a
  // decision left open further up (or by an interrupted turn) never holds the next one back.
  function ConversationCards({ anchor, useProjection, run, reply, form, t }) {
    const state = useProjection('deepPtcCards');
    const cardsOn = useFormValue(form, 'conversationCards') !== false;
    const briefOn = useFormValue(form, 'taskBrief') !== false;
    const projectOn = useFormValue(form, 'projectCards') !== false;
    const [busy, setBusy] = React.useState();
    const versions = state?.versions ?? [];
    const latest = new Map(versions.map(version => [version.id, version]));
    const here = versions.filter(version => String(version.anchor ?? version.rev) === anchor &&
      (version.review === 'brief' ? briefOn : version.review === 'project' ? projectOn : cardsOn));
    // A card shown again in the same group keeps its place in the grid with its newest state.
    const newest = new Map(here.map(version => [version.id, version]));
    const mine = here.filter(version => newest.get(version.id) === version);
    if (!mine.length) return null;
    const guarded = version => async (action, extra) => {
      setBusy(versionKey(version));
      try { return await run(version.id, action, { rev: version.rev, ...extra }); } catch (error) { return { ok: false, error }; } finally { setBusy(undefined); }
    };
    const send = async text => typeof reply === 'function' ? reply(text) : false;
    const sizes = layoutSizes(mine.filter(version => version.phase !== 'dismissed'));
    return h('section', { className: 'dpt-cards', 'aria-label': t('cardLabel') },
      ...mine.map(version => {
        const archived = state.delegated && !(version.posted >= (state.own ?? Infinity)) ? 'subagent' : archivedReason(state, version, latest);
        if (version.phase === 'dismissed') return h(ClosedStub, { key: versionKey(version), card: version, t });
        const props = { key: versionKey(version), card: version, size: sizes.get(version), archived, pending: busy === versionKey(version), t, run: guarded(version), reply: send };
        return h(version.kind === 'question' ? QuestionCard : CardView, props);
      }));
  }
  return { ConversationCards, DecisionCard, commandError, layoutSizes };
}
