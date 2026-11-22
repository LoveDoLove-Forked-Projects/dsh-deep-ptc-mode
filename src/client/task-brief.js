export function createTaskBrief({ React, h, tf, commandError, projectionValue, useFormValue, openTab = () => false }) {
  const BRIEF_COMMAND_NAME = 'deep-ptc-brief';
  const BRIEF_SECTIONS = ['goal', 'constraint', 'acceptance', 'context', 'question'];
  const SECTION_LABEL = { goal: 'briefGoal', constraint: 'briefConstraint', acceptance: 'briefAcceptance', context: 'briefContext', question: 'briefQuestion' };
  const BASIS_LABEL = { user: 'briefBasisUser', inferred: 'briefBasisInferred', confirmed: 'briefBasisConfirmed' };
  function runBriefCommand(child, sessionId, payload) {
    const execute = child.remote?.commands?.execute;
    if (typeof execute !== 'function') return Promise.resolve({ ok: false, error: { message: 'unavailable' } });
    return execute(sessionId, '/' + BRIEF_COMMAND_NAME + ' ' + JSON.stringify(payload), []);
  }
  const isPending = item => item.status === 'open' && item.basis !== 'confirmed';
  const itemsOf = state => Array.isArray(state?.items) ? state.items : [];
  const unconfirmedOf = state => itemsOf(state).filter(isPending).length;
  const titleOf = state => state?.title || (itemsOf(state).find(item => item.section === 'goal') ?? itemsOf(state)[0])?.text || '';
  const acceptanceOf = state => {
    const rows = itemsOf(state).filter(item => item.section === 'acceptance' && item.status !== 'dropped');
    return { total: rows.length, done: rows.filter(item => item.status === 'done').length };
  };
  const shortDate = value => typeof value === 'string' && value.length >= 10 ? value.slice(5, 10).replace('-', '/') : '';

  const svg = (size, children) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, ...children);
  const stroke = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const ICONS = {
    brief: () => svg(16, [h('rect', { key: 1, x: 3, y: 2.5, width: 10, height: 11, rx: 2, ...stroke }), h('path', { key: 2, d: 'M5.6 6.2l1 1 1.8-2M5.6 10h4.8M9.6 6.5h.8', ...stroke })]),
    done: () => svg(16, [h('circle', { key: 1, cx: 8, cy: 8, r: 6, ...stroke }), h('path', { key: 2, d: 'm5.4 8.2 1.8 1.8 3.5-3.8', ...stroke })]),
    archive: () => svg(16, [h('rect', { key: 1, x: 2.5, y: 3, width: 11, height: 3, rx: 1, ...stroke }), h('path', { key: 2, d: 'M3.5 6v6.5h9V6M6.5 8.8h3', ...stroke })]),
    info: () => svg(16, [h('circle', { key: 1, cx: 8, cy: 8, r: 6, ...stroke }), h('path', { key: 2, d: 'M8 7.2v3.6M8 5.2v.1', ...stroke })]),
  };
  const Tick = () => svg(10, [h('path', { key: 1, d: 'm3.5 8.3 3 3 6-6.3', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' })]);
  const closeIcon = () => svg(14, [h('path', { key: 1, d: 'm4.5 4.5 7 7m0-7-7 7', ...stroke })]);

  // Whether a card is folded, remembered per browser so a closed receipt stays closed after a reload.
  const FOLD_KEY = 'dsh-deep-ptc-mode:folded-cards';
  const folds = (() => { try { return JSON.parse(globalThis.localStorage?.getItem(FOLD_KEY) ?? '{}') ?? {}; } catch { return {}; } })();
  function useFold(key, initial) {
    const [value, setValue] = React.useState(() => typeof folds[key] === 'boolean' ? folds[key] : initial);
    const set = next => {
      setValue(next);
      folds[key] = next;
      try {
        const keys = Object.keys(folds);
        for (const old of keys.slice(0, Math.max(0, keys.length - 400))) delete folds[old];
        globalThis.localStorage?.setItem(FOLD_KEY, JSON.stringify(folds));
      } catch { /* folding still works for this view */ }
    };
    return [value, set];
  }

  /** The shared card head: icon tile, family kicker, title, subtitle, status pill and close. */
  function Head({ icon, kicker, title, sub, pill, onPill, onClose, t }) {
    return h('header', { className: 'dpt-cc-head' },
      h('span', { className: 'dpt-cc-icon' }, h(ICONS[icon] ?? ICONS.brief)),
      h('div', { className: 'dpt-cc-titles' },
        kicker ? h('span', { className: 'dpt-cc-kicker' }, kicker) : null,
        h('span', { className: 'dpt-cc-title' }, title),
        sub ? h('span', { className: 'dpt-cc-sub' }, sub) : null),
      pill ? (onPill ? h('button', { type: 'button', className: 'dpt-cc-pill', 'data-phase': pill.phase, 'aria-expanded': pill.expanded, onClick: onPill }, pill.text)
        : h('span', { className: 'dpt-cc-pill', 'data-phase': pill.phase, role: 'status' }, pill.text)) : null,
      onClose ? h('button', { type: 'button', className: 'dpt-cc-close', 'aria-label': t('cardDismiss'), title: t('cardDismiss'), onClick: onClose }, closeIcon()) : null);
  }

  // ---- The brief as a working card ---------------------------------------------------------------

  function ItemRow({ item, act, busy, t, readOnly }) {
    const [editing, setEditing] = React.useState(false);
    const [menu, setMenu] = React.useState(false);
    const [text, setText] = React.useState(item.text);
    const done = item.status === 'done';
    const checkable = item.section === 'acceptance' || item.section === 'goal';
    const locked = busy || readOnly;
    const save = event => { event.preventDefault(); if (!text.trim()) return; void act({ op: 'edit', id: item.id, text: text.trim() }).then(okay => { if (okay) { setEditing(false); setMenu(false); } }); };
    const chip = done ? { kind: 'done', text: t('briefDone') } : isPending(item) ? { kind: 'pending', text: t('briefPending') }
      : item.basis === 'inferred' ? { kind: 'inferred', text: t('briefBasisInferred') } : undefined;
    return h('li', { className: 'dpt-tb-item', 'data-basis': item.basis, 'data-status': item.status, 'data-check': checkable ? '' : undefined },
      checkable ? h('button', { type: 'button', role: 'checkbox', className: 'dpt-tb-check', 'aria-checked': done, disabled: locked, 'aria-label': t(done ? 'briefReopen' : 'briefMarkDone'),
        onClick: () => { void act({ op: 'status', id: item.id, status: done ? 'open' : 'done' }); } }, done ? h(Tick) : null) : null,
      h('span', { className: 'dpt-tb-id' }, item.id),
      h('div', { className: 'dpt-tb-main' },
        editing && !readOnly ? h('form', { className: 'dpt-tb-edit', onSubmit: save },
          h('input', { className: 'dpt-cc-input', autoFocus: true, value: text, onChange: event => setText(event.target.value), 'aria-label': item.id }),
          h('button', { type: 'submit', className: 'dpt-cc-btn', 'data-primary': '', disabled: locked || !text.trim() }, t('briefSave')),
          h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', onClick: () => { setEditing(false); setText(item.text); } }, t('projectCancel')))
          : h('span', { className: 'dpt-tb-text' }, item.text),
        item.quote && item.quote !== item.text && !editing ? h('span', { className: 'dpt-tb-quote', title: item.from ? tf(t, 'briefFrom', { ref: item.from }) : undefined }, '«' + item.quote + '»') : null,
        menu && !editing && !readOnly ? h('span', { className: 'dpt-tb-tools' },
          isPending(item) ? h('button', { type: 'button', className: 'dpt-pv-link', disabled: locked, onClick: () => { void act({ op: 'confirm', ids: [item.id] }); } }, t('briefConfirmOne')) : null,
          h('button', { type: 'button', className: 'dpt-pv-link', disabled: locked, onClick: () => { setText(item.text); setEditing(true); } }, t('briefEdit')),
          h('button', { type: 'button', className: 'dpt-pv-link', 'data-danger': '', disabled: locked, onClick: () => { void act({ op: 'remove', id: item.id }); } }, t('briefRemove'))) : null),
      h('span', { className: 'dpt-tb-tail' },
        chip ? h('span', { className: 'dpt-tb-basis', 'data-chip': chip.kind }, chip.text) : null,
        readOnly || editing ? null : h('button', { type: 'button', className: 'dpt-tb-more', 'aria-expanded': menu, 'aria-label': t('briefMore'), title: t('briefMore'),
          onClick: () => setMenu(!menu) }, '⋯')));
  }

  function AddItem({ act, busy, t, onDone }) {
    const [section, setSection] = React.useState('constraint');
    const [text, setText] = React.useState('');
    return h('form', { className: 'dpt-tb-edit', onSubmit: event => { event.preventDefault(); if (!text.trim()) return;
      void act({ op: 'add', section, text: text.trim() }).then(okay => { if (okay) { setText(''); onDone(); } }); } },
    h('select', { className: 'dpt-cc-input dpt-tb-select', value: section, onChange: event => setSection(event.target.value), 'aria-label': t('briefSection') },
      ...BRIEF_SECTIONS.map(key => h('option', { key, value: key }, t(SECTION_LABEL[key])))),
    h('input', { className: 'dpt-cc-input', autoFocus: true, value: text, placeholder: t('briefAddPlaceholder'), onChange: event => setText(event.target.value) }),
    h('button', { type: 'submit', className: 'dpt-cc-btn', 'data-primary': '', disabled: busy || !text.trim() }, t('briefSave')),
    h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', onClick: onDone }, t('projectCancel')));
  }

  // Each filed message: how much of it the brief accounts for, the text it left unfiled, and whether
  // it is still in the model's context.
  function MessageRow({ message, act, busy, t, readOnly }) {
    return h('li', { className: 'dpt-tb-msg', 'data-open': message.unfiled.length > 0 ? '' : undefined },
      h('div', { className: 'dpt-tb-msg-head' },
        h('span', { className: 'dpt-tb-msg-ref', title: message.preview }, tf(t, 'briefMessage', { turn: message.turn })),
        h('span', { className: 'dpt-tb-msg-cover' }, tf(t, 'briefCovered', { covered: message.covered, total: message.total })),
        message.pending === 'condense' ? h('span', { className: 'dpt-cc-pill' }, t('briefCondensing'))
          : message.pending === 'restore' ? h('span', { className: 'dpt-cc-pill' }, t('briefRestoring'))
          : message.condensed ? h('span', { className: 'dpt-cc-pill', 'data-phase': 'stopped', title: t('briefCondensedHint') }, t('briefCondensed')) : null,
        message.condensed && !message.pending && !readOnly ? h('button', { type: 'button', className: 'dpt-pv-link', disabled: busy,
          onClick: () => { void act({ op: 'restore', ref: message.ref }); } }, t('briefRestore')) : null),
      message.unfiled.length > 0 ? h('div', { className: 'dpt-tb-unfiled' },
        h('span', { className: 'dpt-tb-unfiled-label' }, t('briefUnfiled')),
        ...message.unfiled.map((text, index) => h('span', { key: index, className: 'dpt-tb-frag' }, '«' + text + '»'))) : null);
  }

  /** The current task as a card: items by section, acceptance checkboxes, and finishing the task.
   *  Without `run` it is read-only (an old snapshot). */
  function BriefCard({ state, run, t, compact, bare }) {
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [adding, setAdding] = React.useState(false);
    const [dropping, setDropping] = React.useState(false);
    const items = itemsOf(state);
    const messages = Array.isArray(state?.messages) ? state.messages : [];
    const readOnly = typeof run !== 'function';
    const act = async (payload, okKey) => {
      setBusy(true);
      try {
        const error = commandError(await run({ rev: state.rev, ...payload }), t);
        setMessage(error ?? (okKey ? t(okKey) : ''));
        return error === undefined;
      } catch (error) { setMessage(String(error?.message ?? error)); return false; } finally { setBusy(false); }
    };
    const pending = unconfirmedOf(state);
    const acceptance = acceptanceOf(state);
    const inferred = items.filter(item => item.basis === 'inferred' && item.status === 'open').length;
    const condensable = messages.filter(row => !row.condensed && !row.pending && items.some(item => item.from === row.ref)).length;
    const condensed = messages.filter(row => row.condensed).length;
    const unfiled = messages.reduce((sum, row) => sum + row.unfiled.length, 0);
    const sub = [tf(t, 'briefCount', { count: items.length }), inferred ? tf(t, 'briefInferredCount', { count: inferred }) : '',
      unfiled ? tf(t, 'briefUnfiledCount', { count: unfiled }) : '', condensed ? tf(t, 'briefCondensedCount', { count: condensed }) : ''].filter(Boolean).join(' · ');
    const pill = pending ? { phase: 'question', text: tf(t, 'briefPendingCount', { count: pending }) }
      : acceptance.total ? { phase: acceptance.done === acceptance.total ? 'stopped' : 'task', text: tf(t, 'briefAcceptanceProgress', acceptance) } : undefined;
    const allDone = acceptance.total > 0 && acceptance.done === acceptance.total;
    return h('section', { className: 'dpt-cc dpt-tb', 'data-family': 'task', 'data-compact': compact ? '' : undefined, 'data-bare': bare ? '' : undefined, 'data-readonly': readOnly ? '' : undefined, 'aria-label': t('briefTitle') },
      h(Head, { icon: 'brief', kicker: t('briefTitle') + ' · ' + t(readOnly ? 'briefArchived' : 'briefInProgress'), title: titleOf(state) || t('briefTitle'), sub, pill, t }),
      acceptance.total ? h('div', { className: 'dpt-tb-meter', role: 'progressbar', 'aria-label': t('briefAcceptance'), 'aria-valuemin': 0, 'aria-valuemax': acceptance.total, 'aria-valuenow': acceptance.done },
        h('span', { style: { width: `${(acceptance.done / acceptance.total) * 100}%` } })) : null,
      h('div', { className: 'dpt-cc-body dpt-tb-body' },
        ...BRIEF_SECTIONS.map(section => {
          const rows = items.filter(item => item.section === section && item.status !== 'dropped');
          if (rows.length === 0) return null;
          return h('div', { key: section, className: 'dpt-tb-group' },
            h('span', { className: 'dpt-tb-group-label' }, t(SECTION_LABEL[section])),
            h('ol', { className: 'dpt-tb-items' }, ...rows.map(item => h(ItemRow, { key: item.id + ':' + item.text + ':' + item.status, item, act, busy, readOnly, t }))));
        }),
        adding && !readOnly ? h(AddItem, { act, busy, t, onDone: () => setAdding(false) }) : null,
        messages.length > 0 ? h('details', { className: 'dpt-tb-sources' },
          h('summary', null, tf(t, 'briefSourcesSummary', { count: messages.length })),
          h('ol', { className: 'dpt-tb-msgs', 'aria-label': t('briefSources') },
            ...messages.map(row => h(MessageRow, { key: row.ref, message: row, act, busy, readOnly, t })))) : null),
      message ? h('p', { className: 'dpt-cc-note dpt-tb-status', role: 'status' }, message) : null,
      readOnly ? null : h('footer', { className: 'dpt-cc-foot' },
        h('p', { className: 'dpt-cc-note' }, t(allDone ? 'briefReadyToArchive' : condensable ? 'briefCondenseHint' : 'briefFootHint')),
        h('div', { className: 'dpt-cc-actions' },
          dropping ? h('button', { type: 'button', className: 'dpt-cc-btn', 'data-danger': '', disabled: busy, onClick: () => { void act({ op: 'complete', status: 'dropped' }); } }, t('briefDropConfirm'))
            : h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', disabled: busy, onClick: () => setDropping(true) }, t('briefDrop')),
          !adding ? h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy, onClick: () => setAdding(true) }, t('briefAdd')) : null,
          condensable > 0 ? h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy,
            onClick: () => { void act({ op: 'condense', ref: 'all' }, 'briefCondenseNote'); } }, t('briefCondense')) : null,
          h('button', { type: 'button', className: 'dpt-cc-btn', 'data-primary': '', disabled: busy || items.length === 0,
            onClick: () => { void act({ op: 'complete' }); } }, t('briefComplete')))));
  }

  // ---- One review round: the items of one filing, decided one by one in the same card -------------

  const OUTCOME_CHIP = { confirmed: { kind: 'done', key: 'briefDecidedConfirmed' }, declined: { kind: 'declined', key: 'briefDecidedDeclined' }, returned: { kind: 'pending', key: 'briefDecidedReturned' } };
  const CUSTOM = 'custom';

  function DecisionRow({ entry, waiting, t }) {
    const chip = OUTCOME_CHIP[entry.outcome] ?? OUTCOME_CHIP.confirmed;
    return h('li', { className: 'dpt-tb-item', 'data-outcome': entry.outcome },
      h('span', { className: 'dpt-tb-id' }, entry.item.id),
      h('div', { className: 'dpt-tb-main' },
        h('span', { className: 'dpt-tb-text' }, entry.item.text),
        entry.feedback ? h('span', { className: 'dpt-tb-quote' }, tf(t, 'briefYourNote', { text: entry.feedback })) : null),
      h('span', { className: 'dpt-tb-tail' }, h('span', { className: 'dpt-tb-basis', 'data-chip': chip.kind }, t(waiting ? 'briefRedraftingChip' : chip.key))));
  }

  function FocusItem({ item, note, busy, t, onSubmit, onRest, restable, remaining }) {
    // A model-written question names the decision; the item text says what will be set.
    const options = item.review?.options ?? [{ value: 'yes', label: t('briefSetThis'), ...(item.review?.question ? { hint: item.text } : {}) }];
    const [value, setValue] = React.useState(() => item.selected ?? options[0].value);
    const [custom, setCustom] = React.useState('');
    const prompt = item.review?.question ?? (/[?？]$/u.test(item.text) ? item.text : tf(t, 'briefContentQuestion', { text: item.text }));
    const choices = [...options.map(option => ({ value: option.value, label: option.label,
      hint: [option.text && option.text !== option.label ? option.text : '', option.hint].filter(Boolean).join(' · ') })),
    { value: 'no', label: t('briefSkipThis') }, { value: CUSTOM, label: t('reviewOther') }];
    const ready = value !== CUSTOM || custom.trim() !== '';
    const submit = event => {
      event.preventDefault();
      if (!ready || busy) return;
      onSubmit(value === CUSTOM ? { custom: custom.trim() } : value);
    };
    return h('form', { className: 'dpt-tb-focus', onSubmit: submit },
      h('span', { className: 'dpt-tb-focus-meta' }, [item.id, t(SECTION_LABEL[item.section]), t(BASIS_LABEL[item.basis] ?? 'briefBasisUser')].join(' · ')),
      h('p', { className: 'dpt-cq-prompt' }, prompt),
      item.quote && item.quote !== item.text ? h('blockquote', { className: 'dpt-tb-quote-block' }, '«' + item.quote + '»') : null,
      note ? h('span', { className: 'dpt-tb-quote' }, tf(t, 'briefRedraftedFrom', { text: note })) : null,
      h('div', { className: 'dpt-cc-options', role: 'radiogroup', 'aria-label': prompt }, ...choices.map(choice =>
        h('button', { key: choice.value, type: 'button', role: 'radio', className: 'dpt-cc-option', 'aria-checked': value === choice.value, disabled: busy,
          onClick: () => setValue(choice.value) },
        h('span', { className: 'dpt-cc-option-mark', 'aria-hidden': 'true' }),
        h('span', { className: 'dpt-cc-option-text' }, h('span', { className: 'dpt-cc-option-label' }, choice.label),
          choice.hint ? h('span', { className: 'dpt-cc-option-hint' }, choice.hint) : null)))),
      value === CUSTOM ? h('textarea', { className: 'dpt-cq-text', autoFocus: true, rows: 2, value: custom, maxLength: 1000, disabled: busy,
        placeholder: t('reviewRewriteHint'), 'aria-label': prompt, onChange: event => setCustom(event.target.value) }) : null,
      h('footer', { className: 'dpt-tb-focus-foot' },
        h('p', { className: 'dpt-cc-note' }, remaining > 0 ? tf(t, 'briefRemaining', { count: remaining }) : t('briefLastItem')),
        h('div', { className: 'dpt-cc-actions' },
          restable > 1 ? h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', disabled: busy, onClick: onRest }, t('briefConfirmRest')) : null,
          h('button', { type: 'submit', className: 'dpt-cc-btn', 'data-primary': '', disabled: busy || !ready, 'aria-busy': busy }, t('questionSubmit')))));
  }

  function ReviewRound({ row, state, run, t }) {
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [folded, setFolded] = useFold('brief-round:' + row.anchor, true);
    const decided = Array.isArray(row.decided) ? row.decided : [];
    const queue = Array.isArray(row.queue) ? row.queue : [];
    const head = !row.settled ? row.items?.[0] : undefined;
    const order = [...new Set([...decided.map(entry => entry.item.id), ...queue])];
    // Progress segment of one item: decided, returned, being asked, or still to come.
    const segment = id => {
      if (head?.id === id) return 'now';
      const entry = decided.find(candidate => candidate.item.id === id);
      if (!entry) return 'todo';
      if (entry.outcome === 'returned') return queue.includes(id) || row.waiting === id ? 'back' : 'ok';
      return entry.outcome === 'declined' ? 'no' : 'ok';
    };
    const settledCount = order.filter(id => ['ok', 'no'].includes(segment(id))).length;
    const counts = { confirmed: decided.filter(entry => entry.outcome !== 'declined').length, declined: decided.filter(entry => entry.outcome === 'declined').length };
    const restable = itemsOf(state).filter(item => isPending(item) && !item.review?.options).length;
    const call = async payload => {
      setBusy(true); setMessage('');
      try { const error = commandError(await run({ ...payload, rev: state.rev }), t); if (error) setMessage(error); }
      catch (error) { setMessage(String(error?.message ?? error)); } finally { setBusy(false); }
    };
    const decide = answer => call(answer?.custom ? { op: 'rethink', id: head.id, feedback: answer.custom }
      : answer === 'no' ? { op: 'remove', id: head.id } : { op: 'confirm', ids: [head.id], ...(head.review?.options ? { choice: answer } : {}) });
    const live = !row.settled;
    // The item being asked again after a redraft shows in the focus, not twice.
    const shown = decided.filter(entry => entry.item.id !== head?.id);
    const summary = tf(t, 'briefRoundSummary', counts);
    const title = tf(t, 'briefRoundTitle', { count: order.length });
    if (!live && folded) {
      return h('section', { className: 'dpt-cc dpt-tb', 'data-family': 'task', 'data-archived': 'settled', 'aria-label': t('briefTitle') },
        h(Head, { icon: 'brief', kicker: t('briefTitle'), title, sub: summary,
          pill: { phase: 'archived', text: t('briefExpand'), expanded: false }, onPill: () => setFolded(false), t }),
        decided.length ? h('div', { className: 'dpt-cc-body dpt-tb-chips' }, ...decided.map(entry => h('span', { key: entry.item.id, className: 'dpt-cc-tag',
          'data-tone': entry.outcome === 'declined' ? 'neutral' : 'success', title: entry.item.text }, entry.item.id + ' ' + entry.item.text))) : null);
    }
    return h('section', { className: 'dpt-cc dpt-tb', 'data-family': 'task', 'data-archived': live ? undefined : 'settled', 'aria-label': t('briefTitle') },
      h(Head, { icon: 'brief', kicker: t('briefTitle'), title,
        sub: live ? t('briefRoundSub') : summary,
        pill: live ? { phase: 'question', text: tf(t, 'briefReviewProgress', { at: Math.min(order.length, settledCount + 1), total: order.length }) }
          : { phase: 'archived', text: t('briefCollapse'), expanded: true },
        onPill: live ? undefined : () => setFolded(true), t }),
      h('div', { className: 'dpt-cc-body dpt-tb-body' },
        order.length > 1 ? h('div', { className: 'dpt-tb-prog', 'aria-hidden': 'true' }, ...order.map(id => h('i', { key: id, 'data-s': segment(id) }))) : null,
        shown.length ? h('ol', { className: 'dpt-tb-items' }, ...shown.map(entry => h(DecisionRow, { key: entry.item.id, entry, waiting: row.waiting === entry.item.id, t }))) : null,
        live && row.waiting ? h('div', { className: 'dpt-cc-callout', role: 'status' }, h(ICONS.info), h('span', null, tf(t, 'briefRedrafting', { id: row.waiting }))) : null,
        head ? h(FocusItem, { key: head.id + ':' + head.text + ':' + JSON.stringify(head.review ?? null), item: head, note: decided.find(entry => entry.item.id === head.id)?.feedback, busy, t, onSubmit: answer => { void decide(answer); },
          onRest: () => { void call({ op: 'confirm-rest' }); }, restable, remaining: Math.max(0, queue.length - 1) }) : null),
      message ? h('p', { className: 'dpt-cc-errors', role: 'alert' }, message) : null);
  }

  // ---- Receipts ---------------------------------------------------------------------------------

  function CompletedReceipt({ row, sessionId, t }) {
    const done = row.completed ?? {};
    const dropped = done.status === 'dropped';
    const [closed, setClosed] = useFold('brief-done:' + row.anchor, false);
    const date = shortDate(done.at);
    const stateText = t(dropped ? 'briefStateDropped' : 'briefStateDone');
    if (closed) return h('button', { type: 'button', className: 'dpt-cc-stub', 'aria-expanded': false, onClick: () => setClosed(false) },
      tf(t, 'briefReceiptStub', { title: done.title ?? '', state: stateText }));
    const counts = done.counts ?? {};
    const project = () => { void openTab(sessionId, tab => tab.textContent.trim() === t('projectTab')); };
    return h('section', { className: 'dpt-cc dpt-tb', 'data-family': 'task', 'data-tone': dropped ? 'neutral' : 'success', 'aria-label': t('briefTitle') },
      h(Head, { icon: dropped ? 'archive' : 'done', kicker: t('briefTitle') + ' · ' + stateText, title: done.title ?? '',
        sub: done.record ? tf(t, dropped ? 'briefRecordedDropped' : 'briefRecordedAs', { id: done.record, date }) : tf(t, 'briefArchivedHere', { date }),
        onClose: () => setClosed(true), t }),
      h('div', { className: 'dpt-cc-body' },
        !dropped ? h('div', { className: 'dpt-cc-stats' },
          counts.goal ? h('div', { className: 'dpt-cc-stat' }, h('span', { className: 'dpt-cc-stat-label' }, t('briefGoal')), h('span', { className: 'dpt-cc-stat-value' }, `${counts.goalDone ?? 0}/${counts.goal}`)) : null,
          counts.acceptance ? h('div', { className: 'dpt-cc-stat' }, h('span', { className: 'dpt-cc-stat-label' }, t('briefAcceptance')), h('span', { className: 'dpt-cc-stat-value' }, `${counts.acceptanceDone ?? 0}/${counts.acceptance}`)) : null,
          counts.constraint ? h('div', { className: 'dpt-cc-stat' }, h('span', { className: 'dpt-cc-stat-label' }, t('briefConstraint')), h('span', { className: 'dpt-cc-stat-value' }, tf(t, 'briefCount', { count: counts.constraint }))) : null) : null,
        done.summary ? h('p', { className: 'dpt-cc-text' }, done.summary) : null,
        Array.isArray(done.items) && done.items.length ? h('details', { className: 'dpt-tb-sources' }, h('summary', null, tf(t, 'briefArchivedItems', { count: done.items.length })),
          h('ol', { className: 'dpt-tb-items' }, ...done.items.map(item => h('li', { key: item.id, className: 'dpt-tb-item', 'data-status': item.status },
            h('span', { className: 'dpt-tb-id' }, item.id), h('div', { className: 'dpt-tb-main' }, h('span', { className: 'dpt-tb-text' }, item.text)),
            h('span', { className: 'dpt-tb-tail' }, item.status === 'done' ? h('span', { className: 'dpt-tb-basis', 'data-chip': 'done' }, t('briefDone')) : null))))) : null),
      h('footer', { className: 'dpt-cc-foot' },
        h('p', { className: 'dpt-cc-note' }, t('briefClearedNote')),
        done.record ? h('div', { className: 'dpt-cc-actions' }, h('button', { type: 'button', className: 'dpt-cc-btn', onClick: project }, t('briefOpenProject'))) : null));
  }

  // An older brief version without a round (from before rounds existed): a folded read-only card.
  function SnapshotRow({ row, t }) {
    const [folded, setFolded] = useFold('brief-snap:' + row.anchor, true);
    if (folded) return h('button', { type: 'button', className: 'dpt-cc-stub', onClick: () => setFolded(false) }, tf(t, 'briefSnapshotStub', { rev: row.rev, count: itemsOf(row).length }));
    return h('div', { className: 'dpt-cc-stub-open' },
      h('button', { type: 'button', className: 'dpt-cc-stub', 'aria-expanded': true, onClick: () => setFolded(true) }, tf(t, 'briefSnapshotStub', { rev: row.rev, count: itemsOf(row).length })),
      h(BriefCard, { state: row, t }));
  }

  function BriefInline({ anchor, sessionId, useProjection, run, form, t }) {
    const state = projectionValue(useProjection, 'deepPtcBrief');
    const enabled = useFormValue(form, 'taskBrief') !== false;
    const [manage, setManage] = React.useState(false);
    const row = state?.versions?.find(version => String(version.anchor ?? version.rev) === anchor);
    if (!enabled || !row || state.delegated) return null;
    if (row.completed) return h(CompletedReceipt, { row, sessionId, t });
    if (!row.round) return h(SnapshotRow, { row, t });
    const latest = row === state.versions.at(-1);
    return h(React.Fragment, null,
      h(ReviewRound, { key: row.anchor, row, state, run, t }),
      latest && row.settled && itemsOf(state).length > 0 && !state.revising ? h('details', { className: 'dpt-tb-manage', onToggle: event => setManage(event.currentTarget.open) },
        h('summary', null, t('briefManage')), manage ? h(BriefCard, { state, run, t }) : null) : null);
  }

  /**
   * The confirmed task above the composer, where the host shows its plan: one line with the task and
   * its acceptance progress, opening the working plan. While items still wait for review, the review
   * card in the chat is the place to act, so the dock stays out of the way.
   */
  function TaskDock({ useProjection, run, form, t }) {
    const state = projectionValue(useProjection, 'deepPtcBrief');
    const enabled = useFormValue(form, 'taskBrief') !== false;
    const [open, setOpen] = React.useState(false);
    const items = itemsOf(state);
    if (!enabled || state?.delegated || items.length === 0 || unconfirmedOf(state) > 0 || state?.revising) return null;
    const acceptance = acceptanceOf(state);
    const progress = acceptance.total ? tf(t, 'briefAcceptanceProgress', acceptance) : tf(t, 'briefCount', { count: items.length });
    return h('section', { className: 'dpt-taskdock', 'data-open': open ? '' : undefined, 'aria-label': t('briefTitle') },
      h('button', { type: 'button', className: 'dpt-taskdock-head', 'aria-expanded': open, onClick: () => setOpen(!open) },
        h('span', { className: 'dpt-taskdock-lead', 'aria-hidden': 'true' }, h(ICONS.brief)),
        h('span', { className: 'dpt-taskdock-label' }, t('briefTitle')),
        h('span', { className: 'dpt-taskdock-text', title: titleOf(state) }, titleOf(state)),
        h('span', { className: 'dpt-taskdock-progress', 'data-done': acceptance.total > 0 && acceptance.done === acceptance.total ? '' : undefined }, progress),
        h('span', { className: 'dpt-taskdock-chevron', 'aria-hidden': 'true' }, svg(14, [h('path', { key: 1, d: open ? 'm4 6 4 4 4-4' : 'm4 10 4-4 4 4', ...stroke })]))),
      open ? h('div', { className: 'dpt-taskdock-body' }, h(BriefCard, { state, run, t, compact: true, bare: true })) : null);
  }

  /** The 特点卡片 view's first group: this conversation's task, live. */
  function BriefProjectSection({ useProjection, run, t }) {
    const state = projectionValue(useProjection, 'deepPtcBrief');
    if (!state) return null;
    const items = itemsOf(state);
    return h('section', { className: 'dpt-pv-group', 'aria-label': t('briefTitle') },
      h('h3', { className: 'dpt-pv-group-title' }, t('briefTitle'), h('span', { className: 'dpt-pv-tally' }, t('briefThisConversation'))),
      items.length > 0 ? h(BriefCard, { state, run, t })
        : h('p', { className: 'dpt-pv-empty-line' }, t('briefNoTask')));
  }

  return { BRIEF_COMMAND_NAME, runBriefCommand, BriefInline, BriefProjectSection, TaskDock };
}
