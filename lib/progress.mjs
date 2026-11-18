import { isDeepPtcSession } from './session-preset.mjs';

// Count visible assistant steps, independently for each live session. Reasoning
// blocks, tool descriptions and program output do not reach the chat as progress.
export function installProgressReminder(ctx) {
  const silent = new WeakMap();
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      silent.delete(session);
      return;
    }
    if (event.type !== 'assistant/message') return;
    const blocks = event.data?.message?.content;
    if (!Array.isArray(blocks)) return;
    if (blocks.some(block => block.type === 'text' && block.text?.trim())) silent.delete(session);
    else if (blocks.some(block => block.type === 'tool-call')) silent.set(session, Math.min(2, (silent.get(session) ?? 0) + 1));
  });
  ctx.systemPrompt.context({
    name: 'deep-ptc:progress-reminder', order: 123,
    text: ({ agent }) => silent.get(agent?.session) === 2 && isDeepPtcSession(ctx, agent.session)
      ? 'Your last two tool steps had no visible assistant text. Before your next tool call, tell the user what you have found and what you will do next in a brief chat message. Honor an explicit request for silence.'
      : '',
  });
}
