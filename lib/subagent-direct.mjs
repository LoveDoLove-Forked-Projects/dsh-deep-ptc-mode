// The user talking to a subagent directly. A file of its own: after a live update, modules of the previous
// version may still be in memory, so new names never join an existing file (scripts/check-live-update.mjs).
function isSubagentSession(session) {
  const header = session?.header;
  return !!header?.parentSession || header?.delegationDepth > 0;
}

/** A message the user typed into this conversation; the parent's first prompt has no request id. */
export function hasDirectInput(event) {
  const source = event?.type === 'user/message' && (event.surfaceOp === undefined || event.surfaceOp === 'append') ? event.data?.source : undefined;
  return source?.kind === 'user' && !!source.rpcId;
}

/** Reads a session's card state; set by lib/cards-context.mjs, whose fold tracks direct messages. */
export const directRuntime = { read: undefined };
const stateOf = session => { try { return directRuntime.read?.(session); } catch { return undefined; } };

/** Whether the user is talking to this subagent directly (since the parent's last message). */
export const userEngaged = session => isSubagentSession(session) && stateOf(session)?.direct !== undefined;
/** Whether this session must not put anything to the user. */
export const userIsElsewhere = session => isSubagentSession(session) && !userEngaged(session);
/** The first log sequence that belongs to this session itself rather than to the fork it came from. */
export const ownSince = session => stateOf(session)?.own ?? 0;

export const DIRECT_GUIDANCE = 'The user may also write to you directly in this conversation. Their words have full authority and take effect at once, also over the assignment. First pass them on with task_brief action=report (title, the instructions as items quoting the user, and a summary of how they change your assignment); the parent sees that internal card, the chat does not. Then do what the user asked and answer them here. After a direct message you may ask the user about it with ask_user or ui_card in this conversation; they answer it here, and their answers are reported too. Task cards from the parent are complete: never ask the user to fill in or confirm them.';
