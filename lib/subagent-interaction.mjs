export function isSubagentSession(session) {
  const header = session?.header;
  return !!header?.parentSession || header?.delegationDepth > 0;
}

export const REPORT_TO_PARENT = 'Follow the parent’s assignment. Resolve small, reversible uncertainties yourself. If a choice materially changes scope, acceptance criteria or permissions, send the parent one concise message with the blocker, your recommendation and its consequence. Wait for the parent’s decision before dependent work. Keep all questions and approvals in that channel.';

const INTERACTIVE_TOOLS = new Set(['ask_user', 'ask_user_question', 'ui_card']);

export function installSubagentInteraction(ctx) {
  ctx.on('tools/pre-execute', (exec, next) => {
    if (isSubagentSession(exec.agent?.session) && (INTERACTIVE_TOOLS.has(exec.name) || exec.arguments?.sandbox_permissions)) {
      return { kind: 'deny', reason: REPORT_TO_PARENT };
    }
    return next();
  }, { prepend: true });

  // Host tools and external plugins can request native UI without using the Deep PTC tools.
  ctx.on('approval/request', (request, next) => isSubagentSession(request.agent?.session)
    ? Promise.resolve('rejected') : next(), { prepend: true });
  ctx.on('user-questions/request', (request, next) => {
    if (isSubagentSession(request.agent?.session)) throw new Error(REPORT_TO_PARENT);
    return next();
  }, { prepend: true });

  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || !isSubagentSession(agent?.session)) return decision;
    // Browser prompts carry an RPC identity. The host's initial delegation prompt and
    // authenticated agent-to-agent relays must still reach the child.
    const messages = decision.messages.filter(({ source }) => !(source?.kind === 'user' && source.rpcId));
    return messages.length === decision.messages.length ? decision : { ...decision, messages };
  });
}
