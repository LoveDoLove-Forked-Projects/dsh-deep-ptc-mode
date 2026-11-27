// Message text shared by the task brief's folder and its tool.
//
// Live updates keep modules of the previous version in memory, so a name imported from an already
// released file must exist in that release. This helper therefore lives in its own module: both
// brief-context.mjs and task-brief.mjs can use it without adding a name to an older file's exports.

/** The plain text of a user message's content blocks, before the brief's length cap. */
export function messageContent(message) {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  return blocks.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');
}
