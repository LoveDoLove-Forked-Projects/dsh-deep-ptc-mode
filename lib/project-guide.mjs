export const GUIDE_EVENT = 'plugin:dsh-deep-ptc-mode/project-guide';
export function foldGuide(state, event) {
  const { childId, kind, text } = event.data;
  if (typeof childId !== 'string') return state;
  if (kind === 'start') return { ...state, guide: { childId, messages: [], pending: true } };
  if (state.guide?.childId !== childId) return state;
  if (kind === 'reset') {
    const { guide, ...rest } = state;
    return rest;
  }
  const guide = state.guide;
  if (kind === 'idle' || kind === 'running') return { ...state, guide: { ...guide, pending: kind === 'running' } };
  if (!['assistant', 'user', 'error'].includes(kind) || typeof text !== 'string') return state;
  return { ...state, guide: { ...guide, pending: kind === 'error' ? false : guide.pending,
    messages: [...guide.messages, { role: kind, text: text.slice(0, 8000) }].slice(-40) } };
}

// Existing logs can still have a setup worker. End that legacy route before resuming in chat.
export function projectGuide(ctx, projection, append) {
  return {
    async stop(session) {
      const guide = projection.stateOf(session)?.guide;
      if (!guide) return;
      ctx.get('subagents')?.interrupt?.(guide.childId, { kind: 'user', parentSessionId: session.id });
      await append(session, GUIDE_EVENT, { childId: guide.childId, kind: 'reset' });
    },
  };
}
