// The deep_sleep tool: the model's side of deep sleep mode.
//
//   ask      post one batch of question cards and wait until every card is answered;
//   confirm  post the confirmation card; its answer is what starts the run (lib/deep-sleep.mjs);
//   status   read the mode, the batch and the session goal;
//   complete mark the objective complete and end the run.
//
// The tool never starts a run by itself: only the user's answer on the confirmation card does, so a
// model cannot skip the confirmation and keep going.
import { cardsRuntime, reviewQuestions } from './cards-context.mjs';
import { postQuestionBatch, postQuestionCard, waitForBatch, waitForCard } from './card-batch.mjs';
import { readQuestionInput } from './card-questions.mjs';
import { sleepRuntime } from './deep-sleep.mjs';
import { DEFAULT_SLEEP_ROUNDS, DEFAULT_SLEEP_ROUNDS_MAX, records, SLEEP_TOOL } from './deep-sleep-state.mjs';
import { TOOL_DESCRIPTION } from './deep-sleep-prompt.mjs';
import { REPORT_TO_PARENT } from './subagent-interaction.mjs';
import { userIsElsewhere } from './subagent-direct.mjs';

export const name = 'deep-ptc-sleep-tool';
export const inject = ['tools'];

const service = (ctx, name) => typeof ctx.get === 'function' ? ctx.get(name) : undefined;
const goalView = goal => goal === undefined ? null : {
  id: goal.id, phase: goal.phase, roundsStarted: goal.roundsStarted, maxGoalRounds: goal.maxGoalRounds, activation: goal.activation,
};

function definition(ctx) {
  return {
    name: SLEEP_TOOL,
    resident: true,
    description: TOOL_DESCRIPTION,
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['ask', 'confirm', 'status', 'complete'],
        description: 'ask posts the batch of questions; confirm posts the confirmation card that starts the run; status reads the mode; complete ends a finished run.' },
      title: { type: 'string', description: 'ask/confirm: the card title, in the user\'s language.' },
      subtitle: { type: 'string', description: 'ask/confirm: one line of context under the title.' },
      question: { type: 'string', description: 'confirm: the decision question, e.g. 这些设定可以开始了吗？' },
      cards: { type: 'array', description: 'ask: any number of question cards answered together; each card takes any number of questions.', items: {
        type: 'object', additionalProperties: false, required: ['title', 'questions'], properties: {
          title: { type: 'string', description: 'The card title, e.g. 目标与背景.' },
          subtitle: { type: 'string' },
          questions: reviewQuestions,
        } } },
      summary: { type: 'array', description: 'confirm: any number of rows showing the settings the user confirms.', items: {
        type: 'object', additionalProperties: false, required: ['label', 'value'], properties: {
          label: { type: 'string' }, value: { type: 'string' },
        } } },
      objective: { type: 'string', description: 'confirm: the concrete completion objective the unattended run aims at.' },
      max_rounds: { type: 'number', description: `confirm: cap on automatic goal rounds (default ${DEFAULT_SLEEP_ROUNDS}, at most ${DEFAULT_SLEEP_ROUNDS_MAX}).` },
    } },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const session = exec.agent?.session;
      if (!session) throw new Error('No active conversation');
      if (userIsElsewhere(session)) throw new Error(REPORT_TO_PARENT);
      const state = sleepRuntime.read(session);
      if (args.action === 'status') {
        const goal = service(ctx, 'goals')?.get(exec.agent);
        return { on: state.on, phase: state.phase, cards: state.cards.length, answered: state.answered,
          objective: state.objective, rounds: state.rounds, runs: state.runs, reason: state.reason ?? null, goal: goalView(goal) };
      }
      if (args.action === 'complete') {
        const goals = service(ctx, 'goals');
        const goal = goals?.get(exec.agent);
        if (goal !== undefined && goal.phase === 'active') goals.complete(exec.agent, { id: goal.id, revision: goal.revision });
        if (sleepRuntime.append !== undefined) await sleepRuntime.append(session, records.complete(Date.now()));
        return { phase: 'done', goal: goalView(goals?.get(exec.agent)) };
      }
      if (state.on !== true) throw new Error('Deep sleep mode is off. The user turns it on in the side panel; do not ask a batch or confirm otherwise.');
      if (sleepRuntime.append === undefined) throw new Error('Deep sleep mode is not ready yet; try again in a moment');
      const store = cardsRuntime.store;
      if (store === undefined) throw new Error('Question cards are not ready; try again in a moment');
      if (args.action === 'ask') return ask(ctx, exec, store, session, args);
      if (args.action === 'confirm') return confirm(ctx, exec, store, session, args);
      throw new Error(`Unknown action ${JSON.stringify(args.action)}`);
    },
  };
}

async function ask(ctx, exec, store, session, args) {
  const cards = args.cards;
  if (!Array.isArray(cards) || cards.length < 1) {
    throw new Error('cards: post at least 1 question card in one batch');
  }
  const built = cards.map((item, index) => {
    const entry = item !== null && typeof item === 'object' ? item : {};
    const parsed = readQuestionInput({ title: entry.title, subtitle: entry.subtitle, questions: entry.questions });
    if (parsed.issues !== undefined) throw new Error(`cards.${index}: ${parsed.issues.join('; ')}`);
    return parsed.card;
  });
  const before = store.read(session);
  const series = `sleep-${before.seq + 1}`;
  const posted = await postQuestionBatch(store, session, { series, cards: built }, exec.rootCallId);
  await sleepRuntime.append(session, records.briefing({
    series, cards: posted.cards.map(row => ({ id: row.id, title: row.title, count: (row.questions ?? []).length })), at: Date.now(),
  }));
  waitForBatch(store, exec, series);
  return { series, cards: posted.cards.map(row => ({ id: row.id, title: row.title, questions: (row.questions ?? []).length })),
    status: 'posted, waiting for the user to answer every card',
    next: 'The user sees the batch now; the answers arrive together, as one message, when the last card is answered. Then post the confirmation card (action=confirm).' };
}

async function confirm(ctx, exec, store, session, args) {
  const objective = typeof args.objective === 'string' ? args.objective.trim() : '';
  if (objective === '') throw new Error('objective: required; state the concrete completion objective the run aims at');
  const rounds = Number.isSafeInteger(args.max_rounds) && args.max_rounds > 0
    ? Math.min(args.max_rounds, DEFAULT_SLEEP_ROUNDS_MAX) : DEFAULT_SLEEP_ROUNDS;
  const body = {
    title: typeof args.title === 'string' && args.title.trim() !== '' ? args.title : '确认深度睡眠设定',
    subtitle: typeof args.subtitle === 'string' ? args.subtitle : undefined,
    summary: Array.isArray(args.summary) ? args.summary : undefined,
    sleep: true, sleepObjective: objective, sleepRounds: rounds,
    questions: [{ id: 'decision', type: 'single', required: true,
      prompt: typeof args.question === 'string' && args.question.trim() !== '' ? args.question : '这些设定可以开始了吗？满意后我会独立工作，直到目标完成。',
      options: [{ value: 'start', label: '满意，开始' }, { value: 'revise', label: '需要调整' }] }],
  };
  const parsed = readQuestionInput(body);
  if (parsed.issues !== undefined) throw new Error(parsed.issues.join('; '));
  const before = store.read(session);
  const version = await postQuestionCard(store, session, parsed.card, exec.rootCallId, `sleep-confirm-${before.seq + 1}`);
  await sleepRuntime.append(session, records.confirm(Date.now()));
  waitForCard(store, exec, version);
  return { id: version.id, status: 'posted, waiting for the user decision',
    next: 'The run starts only when the user answers 满意/开始 on this card. A 需要调整 answer means: ask what to change and post a new batch, then confirm again.' };
}

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(definition(ctx)), 'Deep PTC: deep sleep tool');
}
