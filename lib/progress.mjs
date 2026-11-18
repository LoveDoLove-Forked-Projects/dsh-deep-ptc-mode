import { isDeepPtcSession } from './session-preset.mjs';

// How a Deep PTC agent keeps the user informed. A protected system prompt section: it is read on
// every request and never enters the history, so compaction cannot drop it.
export const PROGRESS_GUIDANCE = [
  '# Keeping the user informed',
  'The user should be able to tell at any moment what you are doing and how. Before your first tool call in a turn, say in one sentence what you are about to do. Then, every one or two tool steps, write one or two short sentences: what you just found, what you now think, and what you will try next.',
  'An update does not need a milestone. A hypothesis, a dead end, a change of plan, or the file you are reading and why are all worth a line. Keep each update short and new; do not repeat earlier updates or narrate trivial reads one by one.',
  'Before a long program, wait or subagent run, say what it does and roughly how long it takes. When something needs the user (an approval, a question, a decision), say so in plain words right away.',
  'Honor an explicit request from the user to work quietly.',
].join('\n');

// Count visible assistant steps, independently for each live session. Reasoning
// blocks, tool descriptions and program output do not reach the chat as progress.
export function installProgressReminder(ctx) {
  // session → { silent: consecutive tool steps without visible text, spoke: any visible text this turn }
  const state = new WeakMap();
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      state.delete(session);
      return;
    }
    if (event.type !== 'assistant/message') return;
    const blocks = event.data?.message?.content;
    if (!Array.isArray(blocks)) return;
    const row = state.get(session) ?? { silent: 0, spoke: false };
    if (blocks.some(block => block.type === 'text' && block.text?.trim())) state.set(session, { silent: 0, spoke: true });
    else if (blocks.some(block => block.type === 'tool-call')) state.set(session, { ...row, silent: Math.min(2, row.silent + 1) });
  });
  ctx.systemPrompt.section?.({
    name: 'deep-ptc:progress', order: 10193,
    text: ({ agent }) => isDeepPtcSession(ctx, agent?.session) ? PROGRESS_GUIDANCE : '',
  });
  ctx.systemPrompt.context({
    name: 'deep-ptc:progress-reminder', order: 123,
    text: ({ agent }) => {
      const row = state.get(agent?.session);
      if (row === undefined || !isDeepPtcSession(ctx, agent.session)) return '';
      if (!row.spoke && row.silent >= 1) {
        return 'You started this turn with a tool step and no visible text. Before your next tool call, tell the user in one sentence what you are doing and why. Honor an explicit request for silence.';
      }
      return row.silent >= 2
        ? 'Your last two tool steps had no visible assistant text. Before your next tool call, tell the user what you have found and what you will do next in a brief chat message. Honor an explicit request for silence.'
        : '';
    },
  });
}
