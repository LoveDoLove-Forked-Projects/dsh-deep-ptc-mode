export function createProjectCards({ React, h, tf, commandError, projectionValue }) {
  const PROJECT_COMMAND_NAME = 'deep-ptc-project';
  async function runProjectCommand(child, sessionId, payload) {
    const execute = child.remote?.commands?.execute;
    if (typeof execute !== 'function') return { ok: false, error: { message: 'unavailable' } };
    return execute(sessionId, `/${PROJECT_COMMAND_NAME} ` + JSON.stringify(payload), []);
  }
  // The command's success text, or an error text.
  function projectOutcome(result, t) {
    const error = commandError(result, t);
    if (error !== undefined) return { error };
    const outcome = result?.value?.result ?? result?.value;
    return { text: typeof outcome?.text === 'string' ? outcome.text : '' };
  }
  // "v4 · stack · +R7 ~R2" → "v4：+R7 ~R2"
  const changeNote = text => {
    const match = /^v(\d+) · [^ ]+ · (.*)$/u.exec(text ?? '');
    return match ? `v${match[1]}${match[2] === '=' ? '' : `：${match[2]}`}` : '';
  };
  const KIND_LABEL = { setting: 'projectKindSetting', features: 'projectKindFeatures', requirements: 'projectKindRequirements' };
  const STATUS_LABEL = { active: 'projectStatusActive', done: 'projectStatusDone', superseded: 'projectStatusSuperseded' };
  const shortDate = value => typeof value === 'string' && value.length >= 10 ? value.slice(5, 10).replace('-', '/') : '';
  const PROJECT_CATEGORIES = ['stack', 'conventions', 'constraints', 'workflow', 'product', 'other'];
  const draftOf = card => ({ title: card?.title ?? '', category: card?.category ?? 'other', items: (card?.items ?? []).map(item => ({ id: item.id, text: item.text })) });

  function ItemRows({ card, t, onQuestion }) {
    const [asking, setAsking] = React.useState();
    const [text, setText] = React.useState('');
    if (card.items.length === 0) return h('p', { className: 'dpt-pv-empty-line' }, t('projectNoItems'));
    return h('ol', { className: 'dpt-pv-items' }, ...card.items.map(item => h('li', { key: item.id, className: 'dpt-pv-item', 'data-status': item.status },
      h('span', { className: 'dpt-pv-id' }, item.id),
      h('div', { className: 'dpt-pv-item-main' },
        h('span', { className: 'dpt-pv-item-text' }, item.text),
        item.status && item.status !== 'active' ? h('span', { className: 'dpt-pv-status' }, tf(t, STATUS_LABEL[item.status], { by: item.by ?? '' })) : null,
        asking === item.id ? h('form', { className: 'dpt-pv-ask', onSubmit: event => { event.preventDefault(); if (!text.trim()) return; onQuestion(item, text.trim()); setAsking(undefined); setText(''); } },
          h('input', { className: 'dpt-cc-input', autoFocus: true, value: text, placeholder: t('projectQuestionPlaceholder'), onChange: event => setText(event.target.value) }),
          h('button', { type: 'submit', className: 'dpt-cc-btn', 'data-primary': '', disabled: !text.trim() }, t('projectSend')),
          h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', onClick: () => setAsking(undefined) }, t('projectCancel'))) : null),
      onQuestion ? h('button', { type: 'button', className: 'dpt-pv-link', onClick: () => { setAsking(item.id); setText(''); } }, t('projectQuestion')) : null)));
  }

  function CardEditor({ initial, latest, file, busy, t, onSubmit, onCancel, onDelete }) {
    const [base, setBase] = React.useState(initial);
    const card = base.card;
    const [draft, setDraft] = React.useState(() => card ? draftOf(card) : { ...draftOf(card), items: [{ text: '' }] });
    const [polish, setPolish] = React.useState(false);
    const setItem = (index, text) => setDraft(current => ({ ...current, items: current.items.map((item, at) => at === index ? { ...item, text } : item) }));
    const changed = file.baseVersion !== base.baseVersion || file.path !== base.path;
    const usable = !changed && draft.title.trim() !== '' && draft.items.some(item => item.text.trim() !== '');
    function rebase() {
      if (card && latest) {
        const old = new Map(card.items.map(item => [item.id, item.text]));
        const fresh = new Map(latest.items.map(item => [item.id, item.text]));
        setDraft(value => ({
          title: value.title === card.title ? latest.title : value.title,
          category: value.category === card.category ? latest.category : value.category,
          items: [
            ...value.items.flatMap(item => {
              if (item.id === undefined) return [item];
              if (!fresh.has(item.id)) return item.text === old.get(item.id) ? [] : [{ text: item.text }];
              return [{ ...item, text: item.text === old.get(item.id) ? fresh.get(item.id) : item.text }];
            }),
            ...latest.items.filter(item => !old.has(item.id)),
          ],
        }));
      }
      setBase({ ...file, card: latest });
    }
    return h('form', { className: 'dpt-pv-editor', onSubmit: event => { event.preventDefault(); if (usable && !busy) onSubmit(base, draft, polish); } },
      changed ? h('div', { className: 'dpt-pv-warn', role: 'status' },
        h('p', null, t('projectDraftConflict')),
        latest ? h('details', { open: true }, h('summary', null, t('projectLatestVersion')), h(ItemRows, { card: latest, t })) : null,
        h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy, onClick: rebase },
          t(card && !latest ? 'projectDraftMakeNew' : 'projectDraftRebase'))) : null,
      h('input', { className: 'dpt-cc-input dpt-pv-title-input', value: draft.title, placeholder: t('projectTitlePlaceholder'), 'aria-label': t('projectTitlePlaceholder'),
        onChange: event => setDraft(current => ({ ...current, title: event.target.value })) }),
      h('div', { className: 'dpt-pv-cats', role: 'radiogroup', 'aria-label': t('projectCategory') }, ...PROJECT_CATEGORIES.map(category =>
        h('button', { key: category, type: 'button', role: 'radio', className: 'dpt-pv-cat', 'aria-checked': draft.category === category,
          onClick: () => setDraft(current => ({ ...current, category })) }, t(`projectCat_${category}`)))),
      h('ol', { className: 'dpt-pv-items' }, ...draft.items.map((item, index) => h('li', { key: item.id ?? `new-${index}`, className: 'dpt-pv-item' },
        h('span', { className: 'dpt-pv-id', 'data-new': item.id ? undefined : '' }, item.id ?? t('projectNew')),
        h('textarea', { className: 'dpt-pv-textarea', rows: Math.min(4, Math.max(1, Math.ceil(item.text.length / 48))), value: item.text,
          placeholder: t('projectItemPlaceholder'), onChange: event => setItem(index, event.target.value) }),
        h('button', { type: 'button', className: 'dpt-pv-link', 'aria-label': t('projectRemoveItem'), title: t('projectRemoveItem'),
          onClick: () => setDraft(current => ({ ...current, items: current.items.filter((_, at) => at !== index) })) }, '×')))),
      h('button', { type: 'button', className: 'dpt-pv-add', onClick: () => setDraft(current => ({ ...current, items: [...current.items, { text: '' }] })) }, t('projectAddItem')),
      h('div', { className: 'dpt-pv-editor-foot' },
        h('label', { className: 'dpt-pv-check' }, h('input', { type: 'checkbox', checked: polish, onChange: event => setPolish(event.target.checked) }), t('projectPolish')),
        h('div', { className: 'dpt-cc-actions' },
          card ? h('button', { type: 'button', className: 'dpt-cc-btn', 'data-danger': '', disabled: busy || changed, onClick: () => onDelete(base) }, t('projectDelete')) : null,
          h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', disabled: busy, onClick: onCancel }, t('projectCancel')),
          h('button', { type: 'submit', className: 'dpt-cc-btn', 'data-primary': '', disabled: busy || !usable }, t(polish ? 'projectSendPolish' : 'projectSubmit')))));
  }

  function HistoryPanel({ card, versions, busy, t, onRollback, onClose }) {
    const [open, setOpen] = React.useState(versions[0]?.rev);
    const shown = versions.find(version => version.rev === open);
    return h('div', { className: 'dpt-pv-history' },
      h('div', { className: 'dpt-pv-versions', role: 'tablist' }, ...versions.map(version => h('button', { key: version.rev, type: 'button', role: 'tab',
        className: 'dpt-pv-version', 'aria-selected': version.rev === open, onClick: () => setOpen(version.rev) }, `v${version.rev}`, h('span', null, shortDate(version.updated))))),
      shown ? h(ItemRows, { card: { ...card, items: shown.items }, t }) : h('p', { className: 'dpt-pv-empty-line' }, t('projectNoHistory')),
      h('div', { className: 'dpt-cc-actions' },
        h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', onClick: onClose }, t('projectClose')),
        shown && card.kind === 'setting' ? h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy, onClick: () => onRollback(shown) }, tf(t, 'projectRollback', { rev: shown.rev })) : null));
  }

  function ProjectCard({ card, versions, busy, act, t, onEdit, file }) {
    const [history, setHistory] = React.useState();
    const userOwned = card.kind === 'setting';
    return h('section', { className: 'dpt-pv-card', 'data-kind': card.kind, 'aria-label': card.title },
      h('header', { className: 'dpt-pv-card-head' },
        h('div', { className: 'dpt-pv-card-titles' },
          h('span', { className: 'dpt-pv-card-title' }, card.title),
          h('span', { className: 'dpt-pv-meta' }, t(KIND_LABEL[card.kind]), ` · v${card.rev}`, card.updated && card.updated !== '-' ? ` · ${shortDate(card.updated)}` : '')),
        history === undefined ? h('div', { className: 'dpt-pv-card-actions' },
          versions.length > 0 ? h('button', { type: 'button', className: 'dpt-pv-link', onClick: () => setHistory({ ...file, baseRev: card.rev }) }, t('projectHistory')) : null,
          userOwned ? h('button', { type: 'button', className: 'dpt-pv-link', disabled: busy, onClick: () => onEdit(card) }, t('projectEdit')) : null) : null),
      history !== undefined ? h(HistoryPanel, { card, versions, busy, t, onClose: () => setHistory(undefined),
          onRollback: version => { void act({ ...history, op: 'rollback', card: card.id, rev: version.rev }, 'projectMsgRollback', { title: card.title, rev: version.rev }).then(done => { if (done) setHistory(undefined); }); } })
        : h(ItemRows, { card, t, onQuestion: userOwned ? undefined : (item, question) => act.say('projectMsgQuestion', { title: card.title, id: item.id, text: item.text, question }) }));
  }

  function ProposalRow({ proposal, card, busy, act, t }) {
    const preview = Array.isArray(proposal.preview) ? proposal.preview : [];
    const removed = (card?.items ?? []).filter(item => !preview.some(row => row.id === item.id));
    const before = new Map((card?.items ?? []).map(item => [item.id, item.text]));
    const title = proposal.title ?? card?.title ?? '';
    return h('article', { className: 'dpt-pv-proposal' },
      h('header', { className: 'dpt-pv-card-head' },
        h('div', { className: 'dpt-pv-card-titles' },
          h('span', { className: 'dpt-pv-card-title' }, card ? tf(t, 'projectProposalChange', { title }) : tf(t, 'projectProposalNew', { title })),
          proposal.reason ? h('span', { className: 'dpt-pv-meta' }, proposal.reason) : null),
        h('span', { className: 'dpt-pv-meta' }, [proposal.id, proposal.source === 'guide' ? t('projectGuide') : t('projectChatSource'), proposal.session].filter(Boolean).join(' · '))),
      proposal.stale ? h('p', { role: 'status' }, t('projectProposalStale')) : null,
      h('ol', { className: 'dpt-pv-items' },
        ...preview.map(item => {
          const old = before.get(item.id);
          const state = old === undefined ? 'added' : old !== item.text ? 'changed' : 'same';
          return h('li', { key: item.id, className: 'dpt-pv-item', 'data-diff': state },
            h('span', { className: 'dpt-pv-id' }, item.id),
            h('div', { className: 'dpt-pv-item-main' },
              state === 'changed' ? h('del', { className: 'dpt-pv-old' }, old) : null,
              h('span', { className: 'dpt-pv-item-text' }, item.text)));
        }),
        ...removed.map(item => h('li', { key: item.id, className: 'dpt-pv-item', 'data-diff': 'removed' },
          h('span', { className: 'dpt-pv-id' }, item.id), h('del', { className: 'dpt-pv-item-text' }, item.text)))),
      h('div', { className: 'dpt-cc-actions' },
        h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', disabled: busy,
          onClick: () => { void act({ op: 'reject', proposal: proposal.id }, 'projectMsgReject', { id: proposal.id, title }); } }, t('projectReject')),
        proposal.stale ? h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy || !card || !proposal.delta,
          onClick: () => { void act({ op: 'rebase', proposal: proposal.id }); } }, t('projectReviewMerge')) :
        h('button', { type: 'button', className: 'dpt-cc-btn', 'data-primary': '', disabled: busy,
          onClick: () => { void act({ op: 'approve', proposal: proposal.id }, 'projectMsgApprove', { id: proposal.id, title }); } }, t('projectApprove'))));
  }

  function ProjectChatProposals({ sessionId, useProjection, useChat, turn, run, reply, form, t }) {
    const state = projectionValue(useProjection, 'deepPtcProject');
    const latest = useChat?.(view => view?.timeline?.turnOrder?.at(-1));
    const [message, setMessage] = React.useState('');
    const [busy, setBusy] = React.useState(false);
    const number = typeof turn === 'number' ? turn : turn?.turn;
    const proposals = state?.proposals?.filter(row => row.session === sessionId) ?? [];
    if ((!proposals.length && !message) || (latest !== undefined && number !== undefined && number !== latest) || form?.getSnapshot?.()?.value?.projectCards === false) return null;
    const act = async (payload, key, values) => {
      setBusy(true);
      try {
        const outcome = projectOutcome(await run(payload), t);
        setMessage(outcome.error ?? '');
        if (key && !outcome.error && !await reply(tf(t, key, { ...values, change: changeNote(outcome.text) }))) setMessage(t('cardReplyFailed'));
      } catch (error) { setMessage(String(error?.message ?? error)); } finally { setBusy(false); }
    };
    return h('section', { className: 'dpt-pv-group', 'aria-label': t('projectProposals') },
      ...proposals.map(proposal => h(ProposalRow, { key: proposal.id, proposal, card: state.cards.find(row => row.id === proposal.card), act, busy, t })),
      message ? h('p', { role: 'alert' }, message) : null);
  }

  function ProjectView({ useProjection, run, reply, t }) {
    const state = projectionValue(useProjection, 'deepPtcProject');
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState();
    const [editing, setEditing] = React.useState();
    const [answer, setAnswer] = React.useState('');
    React.useEffect(() => { void run?.({ op: 'refresh' }); }, []);
    if (typeof useProjection !== 'function') return h('div', { className: 'dpt-pv' }, h('p', { className: 'dpt-pv-empty-line' }, t('projectUnavailable')));
    const cards = Array.isArray(state?.cards) ? state.cards : [];
    const proposals = Array.isArray(state?.proposals) ? state.proposals : [];
    const fileBasis = { path: state?.path, baseVersion: state?.fileVersion };
    const beginEdit = card => setEditing({ ...fileBasis, card });
    const closeEdit = done => { if (done) setEditing(undefined); };
    const say = async (key, values) => {
      const sent = await reply?.(tf(t, key, values));
      if (sent === false) setMessage(t('cardReplyFailed'));
      return sent !== false;
    };
    // Run one command; on success tell the model what changed, so it rereads the new version.
    const act = async (payload, messageKey, values = {}) => {
      setBusy(true); setMessage(undefined);
      try {
        const outcome = projectOutcome(await run(payload), t);
        if (outcome.error) { setMessage(outcome.error); return false; }
        if (messageKey) {
          const details = { ...values, change: changeNote(outcome.text) };
          const owner = proposals.find(row => row.id === payload.proposal)?.session;
          if (state?.guide && owner === state.guide.childId) {
            const receipt = projectOutcome(await run({ op: 'guide-reply', message: tf(t, messageKey, details) }), t);
            if (receipt.error) setMessage(receipt.error);
          } else await say(messageKey, details);
        }
        return true;
      } catch (error) { setMessage(String(error?.message ?? error)); return false; } finally { setBusy(false); }
    };
    act.say = (key, values) => { void say(key, values); };
    const submit = async ({ card, ...basis }, draft, polish) => {
      const items = draft.items.map(item => ({ ...item, text: item.text.trim() })).filter(item => item.text !== '');
      if (polish) {
        if (!await act({ ...basis, op: 'check' })) return false;
        const lines = items.map(item => `- ${item.id ?? t('projectNew')} ${item.text}`).join('\n');
        // The draft is the full edited list, so entries the user deleted are named for the model's remove.
        const deleted = (card?.items ?? []).filter(old => !items.some(item => item.id === old.id)).map(old => old.id);
        return act({ op: state?.guide ? 'guide-reply' : 'guide-start', message: tf(t, card ? 'projectMsgPolish' : 'projectMsgPolishNew', { title: draft.title.trim(), id: card?.id ?? '', items: lines,
          version: JSON.stringify(basis.baseVersion ?? null), category: draft.category,
          removed: deleted.length > 0 ? tf(t, 'projectRemoved', { ids: deleted.join(', ') }) : '' }) });
      }
      return act({ ...basis, op: 'submit', card: card?.id, title: draft.title.trim(), category: draft.category, items, baseRev: card?.rev },
        card ? 'projectMsgSubmit' : 'projectMsgCreate', { title: draft.title.trim() });
    };
    const file = state?.path ? state.path.split(/[\\/]/u).slice(-2).join('/') : '';
    return h('div', { className: 'dpt-pv' },
      h('header', { className: 'dpt-pv-head' },
        h('div', { className: 'dpt-pv-titles' },
          h('h2', { className: 'dpt-pv-title' }, t('projectTab')),
          h('p', { className: 'dpt-pv-sub', title: state?.path }, state?.exists ? file : t('projectNoFile'))),
        h('div', { className: 'dpt-cc-actions' },
          cards.length > 0 && !state?.guide ? h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy, onClick: () => { void act({ op: 'guide-start', message: t('projectGuideStart') }); } }, t('projectBootstrap')) : null,
          h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', disabled: busy, onClick: () => { void run?.({ op: 'refresh' }); } }, t('projectRefresh')),
          h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy || editing !== undefined, onClick: () => beginEdit() }, t('projectNewCard')))),
      h('p', { className: 'dpt-pv-intro' }, t('projectIntro')),
      !cards.some(card => card.kind === 'setting') ? h('div', { className: 'dpt-cc-actions' },
        state?.setupStatus ? h('span', { role: 'status' }, t('projectSetup_' + state.setupStatus)) : null,
        state?.setupStatus === 'guiding' && state.setupSummary && !state.guide ? h('p', null, state.setupSummary) : null,
        !state?.guide && state?.setupStatus !== 'deferred' ? h('button', { type: 'button', disabled: busy, onClick: () => { void act({ op: 'setup-defer' }); } }, t('projectDefer')) : null) : null,
      message ? h('p', { className: 'dpt-cc-errors', role: 'alert' }, message) : null,
      state?.guide ? h('section', { className: 'dpt-pv-card', 'aria-label': t('projectGuide') },
        h('h3', null, t('projectGuide')),
        h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy, onClick: () => { void act({ op: 'guide-stop' }); } }, t('projectEndGuide')),
        ...state.guide.messages.map((row, index) => h('p', { key: index, style: { whiteSpace: 'pre-wrap' } }, h('strong', null, t(row.role === 'user' ? 'projectYou' : 'projectGuide') + ' · '), row.text)),
        state.guide.pending ? h('p', { role: 'status' }, t('projectGuideWorking')) : null,
        h('form', { onSubmit: async event => { event.preventDefault(); if (answer.trim() && !busy && await act({ op: 'guide-reply', message: answer.trim() })) setAnswer(''); } },
          h('textarea', { className: 'dpt-pv-textarea', value: answer, 'aria-label': t('projectAnswer'), placeholder: t('projectAnswer'), onChange: event => setAnswer(event.target.value) }),
          h('button', { className: 'dpt-cc-btn', type: 'submit', disabled: busy || !answer.trim() }, t('projectSend')))) : null,
      (state?.warnings ?? []).length > 0 ? h('p', { className: 'dpt-pv-warn' }, tf(t, 'projectWarnings', { count: state.warnings.length })) : null,
      proposals.length > 0 ? h('section', { className: 'dpt-pv-group', 'aria-label': t('projectProposals') },
        h('h3', { className: 'dpt-pv-group-title' }, t('projectProposals'), h('span', { className: 'dpt-pv-count' }, proposals.length)),
        ...proposals.map(proposal => h(ProposalRow, { key: proposal.id, proposal, card: cards.find(card => card.id === proposal.card), busy, act, t }))) : null,
      editing ? h('section', { className: 'dpt-pv-card', 'data-kind': 'setting' },
        h(CardEditor, { initial: editing, latest: cards.find(card => card.id === editing.card?.id), file: fileBasis, busy, t,
          onCancel: () => setEditing(undefined),
          onDelete: ({ card, ...basis }) => { void act({ ...basis, op: 'delete', card: card.id, baseRev: card.rev }, 'projectMsgDelete', { title: card.title }).then(closeEdit); },
          onSubmit: (base, draft, polish) => { void submit(base, draft, polish).then(closeEdit); } })) : null,
      cards.length === 0 && !editing ? h('section', { className: 'dpt-pv-empty' },
        h('p', { className: 'dpt-pv-empty-title' }, t('projectEmptyTitle')),
        h('p', { className: 'dpt-pv-intro' }, t('projectEmptyHint')),
        h('div', { className: 'dpt-cc-actions' },
          h('button', { type: 'button', className: 'dpt-cc-btn', onClick: () => beginEdit() }, t('projectNewCard')),
          !state?.guide ? h('button', { type: 'button', className: 'dpt-cc-btn', 'data-primary': '', disabled: busy, onClick: () => { void act({ op: 'guide-start', message: t('projectGuideStart') }); } }, t('projectBootstrap')) : null)) : null,
      // Setting cards by topic, then the records the model keeps, each group with its own heading.
      ...[...PROJECT_CATEGORIES.map(category => ({ key: category, label: t(`projectCat_${category}`),
        cards: cards.filter(card => card.kind === 'setting' && (card.category ?? 'other') === category) })),
      { key: 'records', label: t('projectRecords'), cards: cards.filter(card => card.kind !== 'setting') }]
        .filter(group => group.cards.length > 0)
        .map(group => h('section', { key: group.key, className: 'dpt-pv-group', 'aria-label': group.label },
          h('h3', { className: 'dpt-pv-group-title' }, group.label, h('span', { className: 'dpt-pv-tally' }, group.cards.length)),
          h('div', { className: 'dpt-pv-grid' }, ...group.cards.map(card => h(ProjectCard, { key: card.id, card, onEdit: beginEdit, file: fileBasis,
            versions: Array.isArray(state?.history?.[card.id]) ? state.history[card.id] : [], busy: busy || editing !== undefined, act, t }))))));
  }
  return { PROJECT_COMMAND_NAME, runProjectCommand, ProjectView, ProjectChatProposals };
}
