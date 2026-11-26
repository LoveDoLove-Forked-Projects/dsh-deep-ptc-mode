// Prompt text for deep sleep mode.
//
// Two audiences: the model, which is told once that the user stepped away and then keeps the rules in
// a short runtime-context snapshot for as long as the mode is on; and the user, who sees the same facts
// in the side panel. Scaffolding is English, like the rest of this plugin's prompt sections; the model
// answers in the user's language.

const RULES = [
  '## Deep sleep mode is on',
  'The user turned this on in the side panel and is stepping away: they will not gate the work item by item. Work from the confirmed plan instead of asking again and again.',
  '- Batch the questions: post everything still open in ONE call to deep_sleep action=ask (as many cards and questions as the work needs, most important first). Cover the goal, background, technical route, scope and non-goals, constraints, acceptance criteria, output format, references, time and budget. Never ask what the workspace, the code or your tools can tell you.',
  '- File the brief without review: while this mode is on, task_brief files its items already confirmed, so do not open a task-brief review card or ask the user to confirm items one by one. The confirmation card below is the one approval they give. Ask anything still open only with deep_sleep action=ask.',
  '- Confirm before starting: when the answers arrive, post ONE confirmation card with deep_sleep action=confirm. Its summary rows state the goal, the route, the constraints, the acceptance and the deliverable; the card asks whether the user is satisfied. Only the user\'s "满意/开始" answer starts the run. If they ask for changes, ask only about the points to revise, then post a new confirmation card.',
  '- Decide by yourself once running: after the confirmation, do not call ask_user and do not wait for approval. Decide every detail you did not ask about, prefer the smallest reversible option, and record the decision with task_brief as a context item. Stop only for a genuinely destructive or irreversible action the user has not authorized, and say exactly what you need.',
  '- Finish properly: call deep_sleep action=complete only when the whole objective is achieved and verified. Then write the closing summary: the outcome, the evidence that it works, the files or commits, and what the user should review next.',
  '- Stay interruptible: if the user writes while the run is going, the run pauses (phase asking) and the host starts no new round. Treat what they added as new information: file the new tasks with their acceptance criteria in task_brief, ask about the new parts, confirm again, and only then continue.',
  'The switch stays on after completion; the next task starts a new run.',
].join('\n');

/**
 * The message that arms the mode, delivered when the user turns the switch on.
 * It is written for the current task; a conversation without one asks what to do first.
 */
export function wakeText() {
  return [
    '[Deep sleep mode: on]',
    'The user turned deep sleep mode on in the side panel. Treat it as an instruction for this conversation now:',
    '1. Work out every question whose answer would change what you build or deliver: the goal, background, technical route, scope and non-goals, constraints, acceptance criteria, output format, references, time and budget. Leave out anything you can find out yourself or that is already settled in this conversation.',
    '2. Post them in one batch with deep_sleep action=ask: several small question cards, as many cards and questions as the work needs, most important first. Do not ask one question at a time, and do not ask in plain text.',
    '3. File what the answers settle with task_brief directly (it is filed confirmed while the mode is on; do not open a review card), then post ONE confirmation card with deep_sleep action=confirm: a few summary rows (goal, route, constraints, acceptance, deliverable), the objective, and the question whether the user is satisfied. Nothing starts without their "满意/开始"; a "需要调整" means ask about the changes and confirm again.',
    '4. After the confirmation the run starts: the host starts a new goal round whenever a turn ends, so do not stop and do not ask. Decide unasked details yourself and record each decision in task_brief. Call deep_sleep action=complete only when the objective is verified complete, then write the closing summary.',
    '5. If the user writes while the run is going, the run pauses by itself: file the new tasks and their acceptance criteria in task_brief, ask about what they added, confirm again, then continue.',
    'If this conversation has no task yet, ask one short question about what to accomplish (ask_user), then brief.',
  ].join('\n');
}

/** The message that says the user turned the mode back on while a run was going. */
export function resumeText(state) {
  return [
    '[Deep sleep mode: on again]',
    `The user turned the switch back on; the run continues where it stopped (objective ${JSON.stringify(state.objective)}, goal round ${state.rounds}).`,
    'No new batch and no confirmation again: keep working without stopping and without asking, decide unasked details yourself, and call deep_sleep action=complete only when the objective is verified complete.',
  ].join('\n');
}

/** The message that says the user turned the mode off again. */
export function offText() {
  return [
    '[Deep sleep mode: off]',
    'The user turned deep sleep mode off in the side panel. No new goal round will start. Finish the step you are on, then stop and answer the user normally; ask them again when a decision genuinely needs them.',
  ].join('\n');
}

const phaseLine = state => {
  switch (state.phase) {
    case 'asking':
      return state.cards.length > 0
        ? `- Batch: ${state.answered}/${state.cards.length} cards answered. The turn resumes when the last one is answered; the answers arrive together in one message.`
        : '- Batch: no questions posted yet. Post the whole batch now.';
    case 'ready':
      return '- Batch: every card is answered. Post the confirmation card now (deep_sleep action=confirm with the objective and the summary rows).';
    case 'confirming':
      return '- Confirmation: the card is on screen and waits for the user. If they ask for changes, post the revised cards and a new confirmation card. The run starts only on "满意/开始".';
    case 'running':
      return `- Run: objective ${JSON.stringify(state.objective)}; goal round ${state.rounds}. Keep working until it is complete and verified.`;
    case 'done':
      return state.reason
        ? `- Run finished: ${state.reason}. Report what is done and what needs the user, then wait for the next task. The switch is still on, so the next task is a new run.`
        : '- Run finished: the objective is complete. Report the outcome and wait for the next task. The switch is still on, so the next task is a new run.';
    default:
      return '';
  }
};

/**
 * The runtime-context snapshot while the mode is on, or '' when it is off.
 * @param state - the folded deep sleep state.
 */
export function modeContext(state) {
  if (state === undefined || state.on !== true) return '';
  return [RULES, phaseLine(state)].filter(Boolean).join('\n');
}

/** The tool description: one paragraph, stable regardless of the phase. */
export const TOOL_DESCRIPTION = 'Deep sleep mode for unattended work: ask every open question in one batch (action=ask), post the confirmation card that starts the run (action=confirm), read the state (action=status), or close a finished objective (action=complete). The user turns the mode on or off in the side panel; only their answer on the confirmation card starts the run, and then the host keeps starting goal rounds until the objective is complete while you decide unasked details yourself.';
