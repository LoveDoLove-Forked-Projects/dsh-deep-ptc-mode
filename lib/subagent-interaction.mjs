// How the user and a subagent interact.
//
// The parent agent assigns the work, and its task cards arrive complete: the user never fills them in.
// The user may still write to a subagent directly. While they do, the subagent can put its own cards
// and approvals to them in its conversation, and what they said goes up to the parent as an internal
// card (lib/intervention.mjs). Without a direct message a subagent never interrupts the user.

import { userIsElsewhere } from './subagent-direct.mjs';

const MIRROR_PREFIX = 'dpt:';

export function isSubagentSession(session) {
  const header = session?.header;
  return !!header?.parentSession || header?.delegationDepth > 0;
}

export const REPORT_TO_PARENT = 'Follow the parent’s assignment. Resolve small, reversible uncertainties yourself. If a choice materially changes scope, acceptance criteria or permissions, send the parent one concise message with the blocker, your recommendation and its consequence. Wait for the parent’s decision before dependent work. Keep all questions and approvals in that channel.';

export { directRuntime, DIRECT_GUIDANCE, hasDirectInput, ownSince, userEngaged, userIsElsewhere } from './subagent-direct.mjs';

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
