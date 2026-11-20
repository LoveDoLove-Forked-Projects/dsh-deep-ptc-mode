export function createProjectCards({ React, h, tf, commandError, commandCode = () => undefined, stripCode = text => text, projectionValue, openTab = () => false }) {
  const PROJECT_COMMAND_NAME = 'deep-ptc-project';
  async function runProjectCommand(child, sessionId, payload) {
    const execute = child.remote?.commands?.execute;
    if (typeof execute !== 'function') return { ok: false, error: { message: 'unavailable' } };
    return execute(sessionId, `/${PROJECT_COMMAND_NAME} ` + JSON.stringify({ ...payload, serverNotice: true }), []);
  }
  // The command's success text, or an error text.
  function projectOutcome(result, t) {
    const error = commandError(result, t);
    if (error !== undefined) return { error };
    const outcome = result?.value?.result ?? result?.value;
    const raw = typeof outcome?.text === 'string' ? outcome.text : '';
    // `notified`: the server already told the model (and the setup guide), so the view sends nothing.
    return { text: stripCode(raw), notified: commandCode(raw) === 'notified' };
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

  // A polish suggestion next to the draft: each entry shows the draft text struck through and the
  // suggested text below; the user takes or keeps each one, then applies the result to the draft.
  function PolishReview({ suggestion, draft, t, onApply, onDismiss }) {
    const byId = new Map(draft.items.filter(item => item.id).map(item => [item.id, item.text]));
    const rows = [
      ...suggestion.items.map(item => ({ kind: item.id === undefined ? 'added' : byId.get(item.id) === item.text ? 'same' : 'changed', item, before: item.id ? byId.get(item.id) : undefined })),
      ...draft.items.filter(item => item.id && !suggestion.items.some(row => row.id === item.id)).map(item => ({ kind: 'dropped', item, before: item.text })),
    ];
    const [take, setTake] = React.useState(() => rows.map(row => row.kind !== 'same'));
    const changes = rows.filter(row => row.kind !== 'same').length;
    function apply() {
      const items = [];
      rows.forEach((row, index) => {
        if (row.kind === 'dropped') { if (!take[index]) items.push({ id: row.item.id, text: row.before }); return; }
        if (row.kind === 'added') { if (take[index]) items.push({ text: row.item.text }); return; }
        items.push({ id: row.item.id, text: take[index] || row.kind === 'same' ? row.item.text : row.before });
      });
      // Draft entries the polisher never saw (typed while it worked) stay at the end.
      for (const item of draft.items) if (!item.id && !rows.some(row => row.item === item)) items.push(item);
      onApply(items);
    }
    return h('section', { className: 'dpt-pv-review', 'aria-label': t('polishReview') },
      h('header', { className: 'dpt-pv-review-head' },
        h('span', { className: 'dpt-pv-review-title' }, t('polishReview')),
        h('span', { className: 'dpt-pv-meta' }, changes === 0 ? t('polishNoChange') : tf(t, 'polishChanges', { count: changes }))),
      h('ol', { className: 'dpt-pv-items' }, ...rows.map((row, index) => row.kind === 'same' ? null : h('li', { key: index, className: 'dpt-pv-item', 'data-diff': row.kind === 'dropped' ? 'removed' : row.kind },
        h('span', { className: 'dpt-pv-id', 'data-new': row.kind === 'added' ? '' : undefined }, row.item.id ?? t('projectNew')),
        h('div', { className: 'dpt-pv-item-main' },
          row.before !== undefined && row.kind !== 'dropped' ? h('del', { className: 'dpt-pv-old' }, row.before) : null,
          row.kind === 'dropped' ? h('del', { className: 'dpt-pv-item-text' }, row.before) : h('span', { className: 'dpt-pv-item-text' }, row.item.text),
          row.item.note ? h('span', { className: 'dpt-pv-note' }, row.item.note) : null),
        h('div', { className: 'dpt-seg dpt-pv-take', role: 'radiogroup', 'aria-label': row.item.id ?? t('projectNew') },
          h('button', { type: 'button', role: 'radio', className: 'dpt-seg-btn', 'aria-checked': take[index], onClick: () => setTake(value => value.map((on, at) => at === index ? true : on)) },
            t(row.kind === 'dropped' ? 'polishTakeDelete' : 'polishTake')),
          h('button', { type: 'button', role: 'radio', className: 'dpt-seg-btn', 'aria-checked': !take[index], onClick: () => setTake(value => value.map((on, at) => at === index ? false : on)) },
            t('polishKeep')))))),
      h('div', { className: 'dpt-cc-actions' },
        h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', onClick: onDismiss }, t('polishDiscard')),
        changes > 0 ? h('button', { type: 'button', className: 'dpt-cc-btn', onClick: () => setTake(rows.map(() => true)) }, t('polishTakeAll')) : null,
        h('button', { type: 'button', className: 'dpt-cc-btn', 'data-primary': '', onClick: apply }, t('polishApply'))));
  }

  const newDraftId = () => `d-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

  function CardEditor({ initial, latest, file, busy, suggestions = [], t, onSubmit, onCancel, onDelete, onPolish, onDismissPolish }) {
    const [base, setBase] = React.useState(initial);
    const card = base.card;
    const [draft, setDraft] = React.useState(() => card ? draftOf(card) : { ...draftOf(card), items: [{ text: '' }] });
    const draftId = React.useRef(newDraftId()).current;
    const [polishBy, setPolishBy] = React.useState('subagent');
    const suggestion = suggestions.find(row => row.id === draftId);
    const polishing = suggestion?.state === 'working';
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
    const polishable = draft.title.trim() !== '' && draft.items.some(item => item.text.trim() !== '');
    const applySuggestion = items => { setDraft(current => ({ ...current, items })); onDismissPolish(draftId); };
    return h('form', { className: 'dpt-pv-editor', 'data-polishing': polishing ? '' : undefined,
      onSubmit: event => { event.preventDefault(); if (usable && !busy && !polishing) onSubmit(base, draft); } },
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
          placeholder: t('projectItemPlaceholder'), disabled: polishing, onChange: event => setItem(index, event.target.value) }),
        h('button', { type: 'button', className: 'dpt-pv-link', 'aria-label': t('projectRemoveItem'), title: t('projectRemoveItem'),
          onClick: () => setDraft(current => ({ ...current, items: current.items.filter((_, at) => at !== index) })) }, '×')))),
      h('button', { type: 'button', className: 'dpt-pv-add', disabled: polishing, onClick: () => setDraft(current => ({ ...current, items: [...current.items, { text: '' }] })) }, t('projectAddItem')),
      polishing ? h('p', { className: 'dpt-pv-polishing', role: 'status' }, h('span', { className: 'dpt-pv-spinner', 'aria-hidden': 'true' }),
        t(suggestion.by === 'chat' ? 'polishWorkingChat' : 'polishWorkingSubagent'),
        h('button', { type: 'button', className: 'dpt-pv-link', onClick: () => onDismissPolish(draftId) }, t('projectCancel'))) : null,
      suggestion?.state === 'failed' ? h('p', { className: 'dpt-pv-warn', role: 'alert' }, suggestion.error ?? t('polishFailed'), ' ',
        h('button', { type: 'button', className: 'dpt-pv-link', onClick: () => onDismissPolish(draftId) }, t('projectClose'))) : null,
      suggestion?.state === 'ready' ? h(PolishReview, { key: suggestion.at, suggestion, draft, t, onApply: applySuggestion, onDismiss: () => onDismissPolish(draftId) }) : null,
      h('div', { className: 'dpt-pv-editor-foot' },
        h('div', { className: 'dpt-pv-polish' },
          h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy || polishing || !polishable || suggestion?.state === 'ready',
            onClick: () => { void onPolish(base, draft, polishBy, draftId); } }, t('projectPolishNow')),
          h('div', { className: 'dpt-seg', role: 'radiogroup', 'aria-label': t('polishBy') }, ...['subagent', 'chat'].map(by =>
            h('button', { key: by, type: 'button', role: 'radio', className: 'dpt-seg-btn', 'aria-checked': polishBy === by, disabled: polishing,
              title: t(by === 'chat' ? 'polishByChatHint' : 'polishBySubagentHint'), onClick: () => setPolishBy(by) }, t(by === 'chat' ? 'polishByChat' : 'polishBySubagent'))))),
        h('div', { className: 'dpt-cc-actions' },
          card ? h('button', { type: 'button', className: 'dpt-cc-btn', 'data-danger': '', disabled: busy || changed, onClick: () => onDelete(base) }, t('projectDelete')) : null,
          h('button', { type: 'button', className: 'dpt-cc-btn', 'data-ghost': '', disabled: busy, onClick: onCancel }, t('projectCancel')),
          h('button', { type: 'submit', className: 'dpt-cc-btn', 'data-primary': '', disabled: busy || !usable || polishing }, t('projectSubmit')))));
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
        : h(ItemRows, { card, t, onQuestion: userOwned ? undefined : (item, question) => { void act.question(card, item, question); } }));
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
        if (key && !outcome.error && !outcome.notified && !await reply(tf(t, key, { ...values, change: changeNote(outcome.text) }))) setMessage(t('cardReplyFailed'));
      } catch (error) { setMessage(String(error?.message ?? error)); } finally { setBusy(false); }
    };
    return h('section', { className: 'dpt-pv-group', 'aria-label': t('projectProposals') },
      ...proposals.map(proposal => h(ProposalRow, { key: proposal.id, proposal, card: state.cards.find(row => row.id === proposal.card), act, busy, t })),
      message ? h('p', { role: 'alert' }, message) : null);
  }

  function ProjectView({ sessionId, useProjection, run, reply, t }) {
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
        if (messageKey && !outcome.notified) {
          const details = { ...values, change: changeNote(outcome.text) };
          const owner = proposals.find(row => row.id === payload.proposal)?.session;
          // Every change reaches the main conversation at once (a steering message, even mid-task);
          // a proposal written by the setup guide tells the guide as well.
          await say(messageKey, details);
          if (state?.guide && owner === state.guide.childId) {
            const receipt = projectOutcome(await run({ op: 'guide-reply', message: tf(t, messageKey, details) }), t);
            if (receipt.error) setMessage(receipt.error);
          }
        }
        return true;
      } catch (error) { setMessage(String(error?.message ?? error)); return false; } finally { setBusy(false); }
    };
    act.say = (key, values) => { void say(key, values); };
    // A question about a record goes through the server, which tells the model; the text is the fallback.
    act.question = async (card, item, question) => {
      const outcome = projectOutcome(await run({ op: 'question', card: card.id, item: item.id, question }).catch(() => undefined), t);
      if (outcome.error) { setMessage(outcome.error); return; }
      if (!outcome.notified) await say('projectMsgQuestion', { title: card.title, id: item.id, text: item.text, question });
    };
    // Guided setup happens in the main conversation: the model asks with question cards there, and
    // the request reaches it at once even mid-task. The editor here never involves the model.
    const guideInChat = async () => {
      setMessage(undefined);
      const asked = projectOutcome(await run({ op: 'ask', kind: cards.length === 0 ? 'guide-first' : 'guide-more' }).catch(() => undefined), t);
      const sent = asked.notified || await reply?.(t(cards.length === 0 ? 'projectMsgGuideFirst' : 'projectMsgGuideMore'));
      if (sent === false) { setMessage(t('cardReplyFailed')); return; }
      openTab(sessionId, (_tab, index) => index === 0);
    };
    const cleanItems = draft => draft.items.map(item => ({ ...item, text: item.text.trim() })).filter(item => item.text !== '');
    const submit = async ({ card, ...basis }, draft) => act({ ...basis, op: 'submit', card: card?.id, title: draft.title.trim(), category: draft.category,
      items: cleanItems(draft), baseRev: card?.rev }, card ? 'projectMsgSubmit' : 'projectMsgCreate', { title: draft.title.trim() });
    // Start a polish and return: a subagent works on its own; the conversation gets the request as a
    // steering message, so it arrives even mid-task. The result comes back as a suggestion.
    const polish = async ({ card }, draft, by, draftId) => {
      setMessage(undefined);
      const items = cleanItems(draft);
      const removed = (card?.items ?? []).filter(old => !items.some(item => item.id === old.id)).map(old => old.id);
      const outcome = projectOutcome(await run({ op: 'polish', by, draftId, card: card?.id, title: draft.title.trim(), category: draft.category, items, removed }), t);
      if (outcome.error) { setMessage(outcome.error); return; }
      let started = {};
      try { started = JSON.parse(outcome.text); } catch { /* an older server answered plainly */ }
      if (by === 'chat' && started.instruction && !outcome.notified) {
        const sent = await reply?.(started.instruction);
        if (sent === false) setMessage(t('cardReplyFailed'));
      }
    };
    const dismissPolish = draftId => { void run({ op: 'polish-dismiss', draftId }); };
    const file = state?.path ? state.path.split(/[\\/]/u).slice(-2).join('/') : '';
    return h('div', { className: 'dpt-pv' },
      h('header', { className: 'dpt-pv-head' },
        h('div', { className: 'dpt-pv-titles' },
          h('h2', { className: 'dpt-pv-title' }, t('projectTab')),
          h('p', { className: 'dpt-pv-sub', title: state?.path }, state?.exists ? file : t('projectNoFile'))),
        h('div', { className: 'dpt-cc-actions' },
          cards.length > 0 && !state?.guide ? h('button', { type: 'button', className: 'dpt-cc-btn', disabled: busy, onClick: () => { void guideInChat(); } }, t(cards.length === 0 ? 'projectPanelGuideFirst' : 'projectPanelGuideMore')) : null,
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
          suggestions: Array.isArray(state?.suggestions) ? state.suggestions : [], onPolish: polish, onDismissPolish: dismissPolish,
          onCancel: () => setEditing(undefined),
          onDelete: ({ card, ...basis }) => { void act({ ...basis, op: 'delete', card: card.id, baseRev: card.rev }, 'projectMsgDelete', { title: card.title }).then(closeEdit); },
          onSubmit: (base, draft) => { void submit(base, draft).then(closeEdit); } })) : null,
      cards.length === 0 && !editing ? h('section', { className: 'dpt-pv-empty' },
        h('p', { className: 'dpt-pv-empty-title' }, t('projectEmptyTitle')),
        h('p', { className: 'dpt-pv-intro' }, t('projectEmptyHint')),
        h('div', { className: 'dpt-cc-actions' },
          h('button', { type: 'button', className: 'dpt-cc-btn', onClick: () => beginEdit() }, t('projectNewCard')),
          !state?.guide ? h('button', { type: 'button', className: 'dpt-cc-btn', 'data-primary': '', disabled: busy, onClick: () => { void guideInChat(); } }, t(cards.length === 0 ? 'projectPanelGuideFirst' : 'projectPanelGuideMore')) : null)) : null,
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
