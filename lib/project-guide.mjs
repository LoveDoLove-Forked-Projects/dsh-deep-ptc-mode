import { randomUUID } from 'node:crypto';

export const GUIDE_EVENT = 'plugin:dsh-deep-ptc-mode/project-guide';
const instruction = 'The user started project card setup in the Project cards panel. Act as its dedicated guide, in the user’s language. Ask one concrete question in plain assistant text and end your turn to receive the panel reply. Avoid chat-only UI and question tools. Read the workspace and existing proposals as needed. Use project_cards propose for user settings. The user reviews proposals here. Continue until the user is satisfied.';

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
  if (kind === 'idle') return { ...state, guide: { ...guide, pending: false } };
  if (!['assistant', 'user', 'error'].includes(kind) || typeof text !== 'string') return state;
  return { ...state, guide: { ...guide, pending: kind === 'user',
    messages: [...guide.messages, { role: kind, text: text.slice(0, 8000) }].slice(-40) } };
}

export function projectGuide(ctx, projection, append, publish) {
  const state = session => projection.stateOf(session)?.guide;
  const record = (session, childId, kind, text) => append(session, GUIDE_EVENT,
    { childId, kind, ...text === undefined ? {} : { text } });
  const parentOf = child => {
    const parentId = child.header?.parentSession;
    if (!parentId) return;
    const parent = ctx.get('agents')?.get(parentId)?.session;
    if (parent && state(parent)?.childId === child.id) return parent;
  };
  ctx.on?.('session/event', (child, event) => {
    if (!['assistant/message', 'turn/end'].includes(event.type)) return;
    const parent = parentOf(child);
    if (!parent) return;
    const text = event.data?.message?.content?.filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
    // Publish after the child's session event has finished notifying observers.
    queueMicrotask(() => {
      if (text) record(parent, child.id, 'assistant', text);
      if (event.type === 'turn/end') {
        const reason = event.data?.reason;
        if (reason?.kind === 'error') record(parent, child.id, 'error', String(reason.error?.message ?? 'Project card guide failed.'));
        else record(parent, child.id, 'idle');
      }
    });
  });
  return {
    async refreshParent(child) {
      const parent = parentOf(child);
      if (parent) await publish(parent);
    },
    async handle(agent, op, message, signal) {
      const parent = agent.session;
      const host = ctx.get('subagents');
      if (!host) throw new Error('Subagent service unavailable. / 子代理服务不可用。');
      const guide = state(parent);
      if (op === 'guide-start') {
        if (guide) return;
        const childId = randomUUID();
        record(parent, childId, 'start');
        try {
          const activation = await host.startActivation({ childId, provider: 'spawn', label: 'Project card setup',
            delivery: 'caller', signal, request: { parent: agent, agentPreset: 'deep-ptc',
              maxDepth: host.resolveMaxDepth(), prompt: [{ type: 'text', text: instruction + (message ? '\n' + message : '') }] } });
          activation.result.catch(error => record(parent, childId, 'error', String(error?.message ?? error)));
        } catch (error) {
          record(parent, childId, 'reset');
          throw error;
        }
      } else {
        if (!guide || !message?.trim()) throw new Error('No guide or empty message.');
        await host.prompt({ requestId: randomUUID(), parentSessionId: parent.id, childSessionId: guide.childId,
          mode: 'continuable', delivery: 'steer', content: [{ type: 'text', text: message }] }, signal);
        record(parent, guide.childId, 'user', message);
      }
    },
  };
}
