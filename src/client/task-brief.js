export function createTaskBrief({ React, h, tf, useCurrentReview, DecisionCard, commandError, projectionValue, useFormValue }) {
  const BRIEF_COMMAND_NAME = 'deep-ptc-brief';
  const BRIEF_SECTIONS = ['goal', 'constraint', 'acceptance', 'context', 'question'];
  const SECTION_LABEL = { goal: 'briefGoal', constraint: 'briefConstraint', acceptance: 'briefAcceptance', context: 'briefContext', question: 'briefQuestion' };
  const BASIS_LABEL = { user: 'briefBasisUser', inferred: 'briefBasisInferred', confirmed: 'briefBasisConfirmed' };
  function runBriefCommand(child, sessionId, payload) {
    const execute = child.remote?.commands?.execute;
    if (typeof execute !== 'function') return Promise.resolve({ ok: false, error: { message: 'unavailable' } });
    return execute(sessionId, '/' + BRIEF_COMMAND_NAME + ' ' + JSON.stringify(payload), []);
  }
  // Only open, unconfirmed items need a decision.
  const unconfirmedOf = state => (Array.isArray(state?.items) ? state.items : []).filter(item => item.status === 'open' && item.basis !== 'confirmed').length;
  const svg = children => h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' }, ...children);
  const stroke = { stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const BriefIcon = () => svg([h('rect', { key: 1, x: 3, y: 2.5, width: 10, height: 11, rx: 2, ...stroke }),
    h('path', { key: 2, d: 'M5.6 6.2l1 1 1.8-2M5.6 10h4.8M9.6 6.5h.8', ...stroke })]);

  function ItemRow({ item, act, busy, t, readOnly }) {
    const [editing, setEditing] = React.useState(false);
    const [text, setText] = React.useState(item.text);
    const done = item.status === 'done';
    const locked = busy || readOnly;
    const save = event => { event.preventDefault(); if (!text.trim()) return; void act({ op: 'edit', id: item.id, text: text.trim() }).then(okay => { if (okay) setEditing(false); }); };
    return h('li', { className: 'dpt-tb-item', 'data-basis': item.basis, 'data-status': item.status },
      h('span', { className: 'dpt-tb-id' }, item.id),
      h('div', { className: 'dpt-tb-main' },
        editing && !readOnly ? h('form', { className: 'dpt-tb-edit', onSubmit: save },
          h('input', { className: 'dpt-cc-input', autoFocus: true, value: text, onChange: event => setText(event.target.value), 'aria-label': item.id }),
          h('button', { type: 'submit', className: 'dpt-cc-btn', 'data-primary': '', disabled: locked || !text.trim() }, t('briefSave')),
          h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', onClick: () => { setEditing(false); setText(item.text); } }, t('projectCancel')))
          : h('span', { className: 'dpt-tb-text' }, item.text),
        item.quote && item.quote !== item.text && (!editing || readOnly) ? h('span', { className: 'dpt-tb-quote', title: item.from ? tf(t, 'briefFrom', { ref: item.from }) : undefined }, '«' + item.quote + '»') : null),
      h('span', { className: 'dpt-tb-basis', 'data-basis': item.basis }, done ? t('briefDone') : t(BASIS_LABEL[item.basis] ?? 'briefBasisUser')),
      editing || readOnly ? null : h('span', { className: 'dpt-tb-tools' },
        item.basis !== 'confirmed' && !done ? h('button', { type: 'button', className: 'dpt-pv-link', disabled: locked, onClick: () => { void act({ op: 'confirm', ids: [item.id] }); } }, t('briefConfirmOne')) : null,
        h('button', { type: 'button', className: 'dpt-pv-link', disabled: locked, onClick: () => { setText(item.text); setEditing(true); } }, t('briefEdit')),
        h('button', { type: 'button', className: 'dpt-pv-link', disabled: locked, onClick: () => { void act({ op: 'status', id: item.id, status: done ? 'open' : 'done' }); } }, t(done ? 'briefReopen' : 'briefMarkDone')),
        item.section === 'constraint' || item.section === 'goal' ? h('button', { type: 'button', className: 'dpt-pv-link', disabled: locked, title: t('briefPromoteHint'),
          onClick: () => { void act({ op: 'promote', id: item.id }, 'briefPromoted'); } }, t('briefPromote')) : null,
        h('button', { type: 'button', className: 'dpt-pv-link', 'data-danger': '', disabled: locked, onClick: () => { void act({ op: 'remove', id: item.id }); } }, t('briefRemove'))));
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

  /** The brief as a card: items by section, coverage, and the two decisions (confirm, condense).
   *  Archived cards are the read-only record left after an approval: no action, same content. */
  function BriefCard({ state, run, t, compact, archived = false, archivedNote }) {
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [rethink, setRethink] = React.useState(false);
    const [feedback, setFeedback] = React.useState('');
    const items = Array.isArray(state?.items) ? state.items : [];
    const messages = Array.isArray(state?.messages) ? state.messages : [];
    const readOnly = archived === true;
    const act = async (payload, okKey) => {
      setBusy(true);
      try {
        const error = commandError(await run({ rev: state.rev, ...payload }), t);
        setMessage(error ?? (okKey ? t(okKey) : ''));
        return error === undefined;
      } catch (error) { setMessage(String(error?.message ?? error)); return false; } finally { setBusy(false); }
    };
    const inferred = items.filter(item => item.basis === 'inferred' && item.status === 'open').length;
    const unconfirmed = unconfirmedOf(state);
    const condensable = messages.filter(row => !row.condensed && !row.pending && items.some(item => item.from === row.ref)).length;
    const unfiled = messages.reduce((sum, row) => sum + row.unfiled.length, 0);
    const subtitle = [tf(t, 'briefCount', { count: items.length }), inferred ? tf(t, 'briefInferredCount', { count: inferred }) : '', unfiled ? tf(t, 'briefUnfiledCount', { count: unfiled }) : '']
      .filter(Boolean).join(' · ');
    return h('section', { className: 'dpt-cc dpt-tb', 'data-compact': compact ? '' : undefined, 'data-readonly': readOnly ? '' : undefined, 'aria-label': t('briefTitle') },
      h('header', { className: 'dpt-cc-head' },
        h('span', { className: 'dpt-cc-icon' }, h(BriefIcon)),
        h('div', { className: 'dpt-cc-titles' },
          h('span', { className: 'dpt-cc-title' }, t('briefTitle') + ' · v' + state.rev),
          h('span', { className: 'dpt-cc-sub' }, subtitle)),
        readOnly ? h('span', { className: 'dpt-cc-pill', 'data-phase': 'archived' }, t(archivedNote ?? 'briefArchived'))
          : unconfirmed === 0 && items.length > 0 ? h('span', { className: 'dpt-cc-pill', 'data-phase': 'stopped' }, t('briefAllConfirmed')) : null),
      h('div', { className: 'dpt-cc-body dpt-tb-body' },
        ...BRIEF_SECTIONS.map(section => {
          const rows = items.filter(item => item.section === section && item.status !== 'dropped');
          if (rows.length === 0) return null;
          return h('div', { key: section, className: 'dpt-tb-group' },
            h('span', { className: 'dpt-tb-group-label' }, t(SECTION_LABEL[section])),
            h('ol', { className: 'dpt-tb-items' }, ...rows.map(item => h(ItemRow, { key: item.id + ':' + item.text, item, act, busy, readOnly, t }))));
        }),
        readOnly ? null : h(AddItem, { act, busy, t }),
        messages.length > 0 ? h('ol', { className: 'dpt-tb-msgs', 'aria-label': t('briefSources') },
          ...messages.map(row => h(MessageRow, { key: row.ref, message: row, act, busy, readOnly, t }))) : null),
      state.feedback ? h('p', { className: 'dpt-cc-note' }, state.feedback) : null,
      rethink && !readOnly ? h('form', { className: 'dpt-tb-edit', onSubmit: event => {
        event.preventDefault(); void act({ op: 'rethink', feedback });
      } }, h('textarea', { className: 'dpt-cq-text', autoFocus: true, value: feedback, maxLength: 1000,
        placeholder: t('briefFeedback'), 'aria-label': t('briefFeedback'), onChange: event => setFeedback(event.target.value) }),
        h('button', { type: 'submit', className: 'dpt-cc-btn', disabled: busy }, t('briefAskOptions'))) : null,
      message ? h('p', { className: 'dpt-cc-note dpt-tb-status', role: 'status' }, message) : null,
      readOnly ? null : h('footer', { className: 'dpt-cc-foot' },
        h('p', { className: 'dpt-cc-note' }, t(condensable ? 'briefCondenseHint' : 'briefFootHint')),
        h('div', { className: 'dpt-cc-actions' },
          unconfirmed > 0 ? h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy,
            'aria-expanded': rethink, onClick: () => setRethink(!rethink) }, t('briefRethink')) : null,
          unconfirmed > 0 ? h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy, onClick: () => { void act({ op: 'confirm' }, 'briefConfirmedNote'); } }, t('briefConfirmAll')) : null,
          condensable > 0 ? h('button', { type: 'button', className: 'dpt-cc-btn', 'data-primary': '', disabled: busy,
            onClick: () => { void act({ op: 'condense', ref: 'all' }, 'briefCondenseNote'); } }, t('briefCondense')) : null)));
  }

  function BriefInline({ anchor, sessionId, useProjection, run, form, t }) {
    const state = projectionValue(useProjection, 'deepPtcBrief');
    const enabled = useFormValue(form, 'taskBrief') !== false;
    const [manage, setManage] = React.useState(false);
    const selected = useCurrentReview(useProjection, form, sessionId);
    const row = state?.versions?.find(version => String(version.anchor ?? version.rev) === anchor);
    if (!enabled || !row) return null;
    const current = row === state.versions.at(-1);
    const head = current && !state.revising && state.items.find(item => item.status === 'open' && item.basis !== 'confirmed');
    if (head && selected !== 'brief') return null;
    const item = head || (row.outcome && row.items[0]);
    const decide = async answer => {
      const op = answer?.custom ? { op: 'rethink', id: item.id, feedback: answer.custom } :
        answer === 'no' ? { op: 'remove', id: item.id } : { op: 'confirm', ids: [item.id], ...(item.review?.options ? { choice: answer } : {}) };
      return commandError(await run({ ...op, rev: state.rev }), t);
    };
    return h(React.Fragment, null,
      item ? h(DecisionCard, { key: JSON.stringify([row.anchor, item.id, item.text, item.review]), kind: 'brief', title: /[?？]$/u.test(item.text) ? item.text : tf(t, 'briefContentQuestion', { text: item.text }), text: item.text, review: item.review, selected: item.selected,
        outcome: head ? undefined : row.outcome, feedback: row.feedback, onDecide: decide, t },
        h('p', { className: 'dpt-cc-note' }, item.id + ' · ' + t(SECTION_LABEL[item.section]) + ' · ' + t(BASIS_LABEL[item.basis])),
        !head && item.selected ? h('p', { className: 'dpt-cq-answer' }, item.text) : null,
        item.quote && item.quote !== item.text ? h('blockquote', { className: 'dpt-tb-quote' }, item.quote) : null)
        : h(BriefCard, { state: row, t, archived: true, archivedNote: row.feedback ? 'briefReturned' : unconfirmedOf(row) ? 'briefArchived' : 'briefAllConfirmed' }),
      current && !head && !state.revising ? h('details', { className: 'dpt-tb-manage', onToggle: event => setManage(event.currentTarget.open) },
        h('summary', null, t('briefManage')), manage ? h(BriefCard, { state, run, t }) : null) : null);
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
      open && items.length > 0 ? h(BriefCard, { state, t, compact: true, archived: true, archivedNote: unconfirmedOf(state) ? 'briefPending' : 'briefAllConfirmed' }) : null);
  }

  return { BRIEF_COMMAND_NAME, runBriefCommand, BriefInline, BriefPanelSection };
}
