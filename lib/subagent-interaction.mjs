// How the user and a subagent interact.
//
// The parent agent assigns the work, and its task cards arrive complete: the user never fills them in.
// The user may still write to a subagent directly. While they do, the subagent can put its own cards
// and approvals to them in its conversation, and what they said goes up to the parent as an internal
// card (lib/intervention.mjs). Without a direct message a subagent never interrupts the user.

const MIRROR_PREFIX = 'dpt:';

export function isSubagentSession(session) {
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

export const REPORT_TO_PARENT = 'Follow the parent’s assignment. Resolve small, reversible uncertainties yourself. If a choice materially changes scope, acceptance criteria or permissions, send the parent one concise message with the blocker, your recommendation and its consequence. Wait for the parent’s decision before dependent work. Keep all questions and approvals in that channel.';

export const DIRECT_GUIDANCE = 'The user may also write to you directly in this conversation. Their words have full authority and take effect at once, also over the assignment. First pass them on with task_brief action=report (title, the instructions as items quoting the user, and a summary of how they change your assignment); the parent sees that internal card, the chat does not. Then do what the user asked and answer them here. After a direct message you may ask the user about it with ask_user or ui_card in this conversation; they answer it here, and their answers are reported too. Task cards from the parent are complete: never ask the user to fill in or confirm them.';

const INTERACTIVE_TOOLS = new Set(['ask_user', 'ask_user_question', 'ui_card']);
const mirrored = request => request?.questions?.length > 0 && request.questions.every(question => String(question?.id).startsWith(MIRROR_PREFIX));

export function installSubagentInteraction(ctx) {
  ctx.on('tools/pre-execute', (exec, next) => {
    if (userIsElsewhere(exec.agent?.session) && (INTERACTIVE_TOOLS.has(exec.name) || exec.arguments?.sandbox_permissions)) {
      return { kind: 'deny', reason: REPORT_TO_PARENT };
    }
    return next();
  }, { prepend: true });

  // Host tools and external plugins can request native UI without using the Deep PTC tools.
  ctx.on('approval/request', (request, next) => userIsElsewhere(request.agent?.session)
    ? Promise.resolve('rejected') : next(), { prepend: true });
  ctx.on('user-questions/request', (request, next) => {
    if (userIsElsewhere(request.agent?.session) && !mirrored(request)) throw new Error(REPORT_TO_PARENT);
    return next();
  }, { prepend: true });
}
