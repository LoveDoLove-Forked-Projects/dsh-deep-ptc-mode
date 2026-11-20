export function createTaskBrief({ React, h, tf, commandError, projectionValue, useFormValue }) {
  const BRIEF_COMMAND_NAME = 'deep-ptc-brief';
  const BRIEF_SECTIONS = ['goal', 'constraint', 'acceptance', 'context', 'question'];
  const SECTION_LABEL = { goal: 'briefGoal', constraint: 'briefConstraint', acceptance: 'briefAcceptance', context: 'briefContext', question: 'briefQuestion' };
  const BASIS_LABEL = { user: 'briefBasisUser', inferred: 'briefBasisInferred', confirmed: 'briefBasisConfirmed' };
  function runBriefCommand(child, sessionId, payload) {
    const execute = child.remote?.commands?.execute;
    if (typeof execute !== 'function') return Promise.resolve({ ok: false, error: { message: 'unavailable' } });
    return execute(sessionId, `/${BRIEF_COMMAND_NAME} ` + JSON.stringify(payload), []);
  }
  const svg = children => h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, ...children);
  const stroke = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const BriefIcon = () => svg([h('rect', { key: 1, x: 3, y: 2.5, width: 10, height: 11, rx: 2, ...stroke }),
    h('path', { key: 2, d: 'M5.6 6.2l1 1 1.8-2M5.6 10h4.8M9.6 6.5h.8', ...stroke })]);

  function ItemRow({ item, act, busy, t }) {
    const [editing, setEditing] = React.useState(false);
    const [text, setText] = React.useState(item.text);
    const done = item.status === 'done';
    const save = event => { event.preventDefault(); if (!text.trim()) return; void act({ op: 'edit', id: item.id, text: text.trim() }).then(okay => { if (okay) setEditing(false); }); };
    return h('li', { className: 'dpt-tb-item', 'data-basis': item.basis, 'data-status': item.status },
      h('span', { className: 'dpt-tb-id' }, item.id),
      h('div', { className: 'dpt-tb-main' },
        editing ? h('form', { className: 'dpt-tb-edit', onSubmit: save },
          h('input', { className: 'dpt-cc-input', autoFocus: true, value: text, onChange: event => setText(event.target.value), 'aria-label': item.id }),
          h('button', { type: 'submit', className: 'dpt-cc-btn', 'data-primary': '', disabled: busy || !text.trim() }, t('briefSave')),
          h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', onClick: () => { setEditing(false); setText(item.text); } }, t('projectCancel')))
          : h('span', { className: 'dpt-tb-text' }, item.text),
        item.quote && item.quote !== item.text && !editing ? h('span', { className: 'dpt-tb-quote', title: item.from ? tf(t, 'briefFrom', { ref: item.from }) : undefined }, `«${item.quote}»`) : null),
      h('span', { className: 'dpt-tb-basis', 'data-basis': item.basis }, done ? t('briefDone') : t(BASIS_LABEL[item.basis] ?? 'briefBasisUser')),
      editing ? null : h('span', { className: 'dpt-tb-tools' },
        item.basis !== 'confirmed' && !done ? h('button', { type: 'button', className: 'dpt-pv-link', disabled: busy, onClick: () => { void act({ op: 'confirm', ids: [item.id] }); } }, t('briefConfirmOne')) : null,
        h('button', { type: 'button', className: 'dpt-pv-link', disabled: busy, onClick: () => { setText(item.text); setEditing(true); } }, t('briefEdit')),
        h('button', { type: 'button', className: 'dpt-pv-link', disabled: busy, onClick: () => { void act({ op: 'status', id: item.id, status: done ? 'open' : 'done' }); } }, t(done ? 'briefReopen' : 'briefMarkDone')),
        item.section === 'constraint' || item.section === 'goal' ? h('button', { type: 'button', className: 'dpt-pv-link', disabled: busy, title: t('briefPromoteHint'),
          onClick: () => { void act({ op: 'promote', id: item.id }, 'briefPromoted'); } }, t('briefPromote')) : null,
        h('button', { type: 'button', className: 'dpt-pv-link', 'data-danger': '', disabled: busy, onClick: () => { void act({ op: 'remove', id: item.id }); } }, t('briefRemove'))));
  }

  function AddItem({ act, busy, t }) {
    const [open, setOpen] = React.useState(false);
    const [section, setSection] = React.useState('constraint');
    const [text, setText] = React.useState('');
    if (!open) return h('button', { type: 'button', className: 'dpt-pv-link', onClick: () => setOpen(true) }, t('briefAdd'));
    return h('form', { className: 'dpt-tb-edit', onSubmit: event => { event.preventDefault(); if (!text.trim()) return;
      void act({ op: 'add', section, text: text.trim() }).then(okay => { if (okay) { setText(''); setOpen(false); } }); } },
    h('select', { className: 'dpt-cc-input dpt-tb-select', value: section, onChange: event => setSection(event.target.value), 'aria-label': t('briefSection') },
      ...BRIEF_SECTIONS.map(key => h('option', { key, value: key }, t(SECTION_LABEL[key])))),
    h('input', { className: 'dpt-cc-input', autoFocus: true, value: text, placeholder: t('briefAddPlaceholder'), onChange: event => setText(event.target.value) }),
    h('button', { type: 'submit', className: 'dpt-cc-btn', 'data-primary': '', disabled: busy || !text.trim() }, t('briefSave')),
    h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', onClick: () => setOpen(false) }, t('projectCancel')));
  }

  // Each filed message: how much of it the brief accounts for, the text it left unfiled, and whether
  // it is still in the model's context.
  function MessageRow({ message, act, busy, t }) {
    return h('li', { className: 'dpt-tb-msg', 'data-open': message.unfiled.length > 0 ? '' : undefined },
      h('div', { className: 'dpt-tb-msg-head' },
        h('span', { className: 'dpt-tb-msg-ref', title: message.preview }, tf(t, 'briefMessage', { turn: message.turn })),
        h('span', { className: 'dpt-tb-msg-cover' }, tf(t, 'briefCovered', { covered: message.covered, total: message.total })),
        message.pending === 'condense' ? h('span', { className: 'dpt-cc-pill' }, t('briefCondensing'))
          : message.pending === 'restore' ? h('span', { className: 'dpt-cc-pill' }, t('briefRestoring'))
          : message.condensed ? h('span', { className: 'dpt-cc-pill', 'data-phase': 'stopped', title: t('briefCondensedHint') }, t('briefCondensed')) : null,
        message.condensed && !message.pending ? h('button', { type: 'button', className: 'dpt-pv-link', disabled: busy,
          onClick: () => { void act({ op: 'restore', ref: message.ref }); } }, t('briefRestore')) : null),
      message.unfiled.length > 0 ? h('div', { className: 'dpt-tb-unfiled' },
        h('span', { className: 'dpt-tb-unfiled-label' }, t('briefUnfiled')),
        ...message.unfiled.map((text, index) => h('span', { key: index, className: 'dpt-tb-frag' }, `«${text}»`))) : null);
  }

  /** The brief as a card: items by section, coverage, and the two decisions (confirm, condense). */
  function BriefCard({ state, run, t, compact }) {
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const items = Array.isArray(state?.items) ? state.items : [];
    const messages = Array.isArray(state?.messages) ? state.messages : [];
    const act = async (payload, okKey) => {
      setBusy(true);
      try {
        const error = commandError(await run({ rev: state.rev, ...payload }), t);
        setMessage(error ?? (okKey ? t(okKey) : ''));
        return error === undefined;
      } catch (error) { setMessage(String(error?.message ?? error)); return false; } finally { setBusy(false); }
    };
    const inferred = items.filter(item => item.basis === 'inferred' && item.status === 'open').length;
    const unconfirmed = items.filter(item => item.basis !== 'confirmed' && item.status === 'open').length;
    const condensable = messages.filter(row => !row.condensed && !row.pending && items.some(item => item.from === row.ref)).length;
    const unfiled = messages.reduce((sum, row) => sum + row.unfiled.length, 0);
    const subtitle = [tf(t, 'briefCount', { count: items.length }), inferred ? tf(t, 'briefInferredCount', { count: inferred }) : '', unfiled ? tf(t, 'briefUnfiledCount', { count: unfiled }) : '']
      .filter(Boolean).join(' · ');
    return h('section', { className: 'dpt-cc dpt-tb', 'data-compact': compact ? '' : undefined, 'aria-label': t('briefTitle') },
      h('header', { className: 'dpt-cc-head' },
        h('span', { className: 'dpt-cc-icon' }, h(BriefIcon)),
        h('div', { className: 'dpt-cc-titles' },
          h('span', { className: 'dpt-cc-title' }, `${t('briefTitle')} · v${state.rev}`),
          h('span', { className: 'dpt-cc-sub' }, subtitle)),
        unconfirmed === 0 && items.length > 0 ? h('span', { className: 'dpt-cc-pill', 'data-phase': 'stopped' }, t('briefAllConfirmed')) : null),
      h('div', { className: 'dpt-cc-body dpt-tb-body' },
        ...BRIEF_SECTIONS.map(section => {
          const rows = items.filter(item => item.section === section && item.status !== 'dropped');
          if (rows.length === 0) return null;
          return h('div', { key: section, className: 'dpt-tb-group' },
            h('span', { className: 'dpt-tb-group-label' }, t(SECTION_LABEL[section])),
            h('ol', { className: 'dpt-tb-items' }, ...rows.map(item => h(ItemRow, { key: `${item.id}:${item.text}`, item, act, busy, t }))));
        }),
        h(AddItem, { act, busy, t }),
        messages.length > 0 ? h('ol', { className: 'dpt-tb-msgs', 'aria-label': t('briefSources') },
          ...messages.map(row => h(MessageRow, { key: row.ref, message: row, act, busy, t }))) : null),
      message ? h('p', { className: 'dpt-cc-note dpt-tb-status', role: 'status' }, message) : null,
      h('footer', { className: 'dpt-cc-foot' },
        h('p', { className: 'dpt-cc-note' }, t(condensable ? 'briefCondenseHint' : 'briefFootHint')),
        h('div', { className: 'dpt-cc-actions' },
          unconfirmed > 0 ? h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy, onClick: () => { void act({ op: 'confirm' }, 'briefConfirmedNote'); } }, t('briefConfirmAll')) : null,
          condensable > 0 ? h('button', { type: 'button', className: 'dpt-cc-btn', 'data-primary': '', disabled: busy,
            onClick: () => { void act({ op: 'condense', ref: 'all' }, 'briefCondenseNote'); } }, t('briefCondense')) : null)));
  }

  /** At the end of the turn that last changed the brief, while it is the latest turn. */
  function BriefTail({ turn, useProjection, useChat, run, form, t }) {
    const state = projectionValue(useProjection, 'deepPtcBrief');
    const enabled = useFormValue(form, 'taskBrief') !== false;
    const latest = useChat?.(view => view?.timeline?.turnOrder?.at(-1));
    const number = typeof turn === 'number' ? turn : turn?.turn;
    if (!enabled || !state || state.rev === 0 || (state.items ?? []).length === 0) return null;
    if (number !== state.updatedTurn || (latest !== undefined && number !== latest)) return null;
    return h(BriefCard, { state, run, t });
  }

  /** The panel's entry: a one-line status that opens the whole card. */
  function BriefPanelSection({ useProjection, run, form, t }) {
    const state = projectionValue(useProjection, 'deepPtcBrief');
    const enabled = useFormValue(form, 'taskBrief') !== false;
    const [open, setOpen] = React.useState(false);
    if (!enabled) return null;
    const items = Array.isArray(state?.items) ? state.items : [];
    const condensed = (state?.messages ?? []).filter(row => row.condensed).length;
    const status = items.length === 0 ? t('briefPanelNone')
      : [tf(t, 'briefCount', { count: items.length }), condensed ? tf(t, 'briefCondensedCount', { count: condensed }) : ''].filter(Boolean).join(' · ');
    return h('section', { className: 'dpt-side-section dpt-side-brief', 'aria-label': t('briefTitle'), 'data-compact': open && items.length > 0 ? undefined : '' },
      h('div', { className: 'dpt-side-label' }, h('span', null, t('briefTitle')),
        h('span', { className: 'dpt-side-tail' },
          h('span', { className: 'dpt-side-hint', title: status }, items.length === 0 ? t('sideNone') : status),
          items.length > 0 ? h('button', { type: 'button', className: 'dpt-pv-link', 'aria-expanded': open, onClick: () => setOpen(!open) }, t(open ? 'briefHide' : 'briefShow')) : null)),
      open && items.length > 0 ? h(BriefCard, { state, run, t, compact: true }) : null);
  }

  return { BRIEF_COMMAND_NAME, runBriefCommand, BriefTail, BriefPanelSection };
}
