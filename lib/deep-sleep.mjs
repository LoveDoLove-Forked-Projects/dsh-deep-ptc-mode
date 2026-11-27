// Deep sleep mode: the side-panel switch, its own state, and the unattended run it starts.
//
// Lifecycle:
//   off        the mode is off (default).
//   asking     the user turned it on; the model posts one batch of question cards.
//   ready      every card of the batch is answered; the model posts one confirmation card.
//   confirming the user decides on that card; only "start" begins the run.
//   running    a session goal is armed and the host's own goal-round driver keeps starting turns.
//   done       the objective is complete or blocked; the switch stays on for the next task.
//
// A user message while the run is going pauses the goal and reopens the batch (reopen), so new
// information is briefed and confirmed before the run continues. Turning the switch off pauses the
// goal; turning it on again resumes it. Every decision is a small session record, so the state
// survives reloads, forks and replays.
import { isDeepPtcSession } from './session-preset.mjs';
import { isSubagentSession } from './subagent-interaction.mjs';
import { coded, deliver, NO_SESSION, WRONG_MODE } from './model-view.mjs';
import { cardsRuntime, sessionRecords } from './cards-context.mjs';
import { blankSleep, DEFAULT_SLEEP_ROUNDS, DEFAULT_SLEEP_ROUNDS_MAX, foldSleep, parseSleepState, records,
  SLEEP_COMMAND, SLEEP_EVENT, SLEEP_KEY } from './deep-sleep-state.mjs';
import { modeContext, offText, resumeText, wakeText } from './deep-sleep-prompt.mjs';
import * as sleepQuota from './sleep-virtual-quota.mjs';

export const name = 'deep-ptc-deep-sleep';
export const inject = [];

const PHASE_LABELS = {
  off: '已关闭', asking: '等待一次性提问', ready: '等待确认卡', confirming: '等待用户确认',
  running: '无人值守运行中', done: '已结束',
};

/** The runtime the tool reads and writes; set once the profile-level layer is installed. */
export const sleepRuntime = { read: () => blankSleep(), append: undefined };

const service = (ctx, name) => typeof ctx.get === 'function' ? ctx.get(name) : undefined;
const refOf = view => ({ id: view.id, revision: view.revision });

/** Shut the mode's layer off without touching the switch: a missing service must not cost the preset. */
export function apply(ctx) {
  void ctx.plugin({ name: 'deep-ptc-sleep-layer', inject: ['sessionProjections', 'commands', 'systemPrompt'], apply: install })
    .await()
    .catch(error => ctx.logger.warn('Deep PTC: deep sleep mode is off (%s)', error.message));
}

/** Install the profile-level layer; exported so a test can run it without the plugin loader. */
export async function install(ctx, records_ = sessionRecords) {
  const appendPluginRecord = await records_();
  const schema = { parse: parseSleepState };
  const projection = await ctx.sessionProjections.register({
    // Bumped from 1: older cache rows contain undefined fields, so the host must drop them.
    key: SLEEP_KEY, stateVersion: 2, stateSchema: schema,
    init: () => blankSleep(), apply: foldSleep,
    wire: { viewSchema: schema, view: state => state, summary: false },
  });
  ctx.effect(() => () => projection.dispose());

  const read = session => projection.stateOf(session) ?? blankSleep();
  const append = (session, record) => appendPluginRecord(session, SLEEP_EVENT, record);
  sleepRuntime.read = read;
  sleepRuntime.append = append;
  ctx.effect(() => () => {
    if (sleepRuntime.read === read) {
      sleepRuntime.read = () => blankSleep();
      sleepRuntime.append = undefined;
    }
  });

  // The confirmation card's decision: answering it is what starts the run, so the model cannot
  // start early by calling its tool again.
  cardsRuntime.sleep = {
    answer({ agent, session, card, answers }) {
      const state = read(session);
      if (card.sleep !== true || state.on !== true) return undefined;
      if (answers?.decision !== 'start') {
        void Promise.resolve(append(session, records.revise(Date.now()))).catch(() => {});
        return {
          text: '[Deep sleep: the user is not satisfied with these settings]\nDo not start the run. Ask what to change: post a new batch with deep_sleep action=ask (only the points to revise), then a new confirmation card. The run starts only after the user confirms the revised settings.',
          summary: '深度睡眠 · 用户要求调整设定',
        };
      }
      const objective = card.sleepObjective;
      const maxRounds = Number.isSafeInteger(card.sleepRounds) ? card.sleepRounds : DEFAULT_SLEEP_ROUNDS;
      let view;
      try {
        view = ensureGoal(ctx, agent, { objective, maxRounds });
      } catch (error) {
        return {
          text: `[Deep sleep: the settings are confirmed, but the run could not start] ${error.message}\nTell the user, then continue as a normal conversation: describe what still needs their input.`,
          summary: '深度睡眠 · 无法启动运行',
        };
      }
      void Promise.resolve(append(session, records.start({ objective, goalId: view?.id, at: Date.now() }))).catch(() => {});
      return {
        text: `[Deep sleep: the user confirmed the settings; the unattended run has started]\nObjective: ${JSON.stringify(objective)}\nThe host starts a new goal round whenever a turn ends without the goal completed (up to ${view?.maxGoalRounds ?? maxRounds} rounds).\nWork without stopping and without asking: decide every unasked detail yourself and record the decision with task_brief. Call deep_sleep action=complete only when the objective is verified complete, then write the closing summary.`,
        summary: '深度睡眠 · 用户已确认，开始运行',
      };
    },
    // One card of the batch was answered: the panel counts it, and the batch's own view is sent
    // only when the last card lands (lib/cards-context.mjs settleBatch).
    briefingAnswered({ session, card, store }) {
      const state = read(session);
      if (state.on !== true || state.series !== card.series) return;
      void Promise.resolve(append(session, records.answered(card.id, Date.now()))).catch(() => {});
      if (card.virtualQuota !== true || store === undefined) return;
      const answered = store.read(session).versions.findLast(row => row.id === card.id && row.series === card.series);
      sleepQuota.grant(session, answered?.result?.answers?.[sleepQuota.QUOTA_QUESTION]);
    },
    dismiss({ session }) {
      const state = read(session);
      if (state.on === true && state.phase === 'confirming') void Promise.resolve(append(session, records.revise(Date.now()))).catch(() => {});
    },
  };
  ctx.effect(() => () => { if (cardsRuntime.sleep !== undefined) cardsRuntime.sleep = undefined; });

  ctx.commands.register({
    name: SLEEP_COMMAND, recordInput: false,
    description: '深度睡眠模式的开关与状态 / Toggle deep sleep mode and read its state',
    handler: request => runCommand(ctx, request, read, append),
  });

  // The model sees the mode, its phase and its rules in the runtime-context snapshot while it is on.
  ctx.systemPrompt.context({
    name: 'deep-ptc:deep-sleep', order: 124, interpolate: false,
    text: ({ agent }) => {
      if (!agent || isSubagentSession(agent.session) || !isDeepPtcSession(ctx, agent.session)) return '';
      try { return modeContext(read(agent.session)); } catch { return ''; }
    },
  });

  installReactions(ctx, read, append);
}

/** Goal helpers. The goal service is mounted by dsh-base; without it an unattended run cannot continue. */
function goalService(ctx) {
  const goals = service(ctx, 'goals');
  if (goals === undefined || typeof goals.get !== 'function') {
    throw new Error('This DSH has no goal service, so an unattended run cannot continue across turns. Update DSH, or finish the work in this turn.');
  }
  return goals;
}

function ensureGoal(ctx, agent, { objective, maxRounds }) {
  const goals = goalService(ctx);
  const cap = Number.isSafeInteger(maxRounds) && maxRounds > 0 ? Math.min(maxRounds, DEFAULT_SLEEP_ROUNDS_MAX) : DEFAULT_SLEEP_ROUNDS;
  const current = goals.get(agent);
  let view;
  if (current === undefined || current.phase === 'complete' || current.phase === 'blocked') {
    view = goals.create(agent, { objective, maxGoalRounds: cap });
  } else {
    view = goals.edit(agent, refOf(current), { objective, ...current.maxGoalRounds < cap ? { maxGoalRounds: cap } : {} });
  }
  if (view.phase !== 'active' || view.activation !== 'armed') view = goals.resume(agent, refOf(view));
  return view;
}

function pauseGoal(ctx, agent) {
  const goals = service(ctx, 'goals');
  if (goals === undefined || agent === undefined) return;
  try {
    const current = goals.get(agent);
    if (current?.phase === 'active' && current.activation === 'armed') goals.pause(agent, refOf(current));
  } catch (error) {
    ctx.logger.warn('Deep PTC: could not pause the goal (%s)', error.message);
  }
}

function rearmGoal(ctx, agent) {
  const goals = service(ctx, 'goals');
  if (goals === undefined || agent === undefined) return;
  try {
    const current = goals.get(agent);
    if (current === undefined || current.phase === 'complete' || current.phase === 'blocked') return;
    if (current.phase === 'active' && current.activation === 'armed') return;
    goals.resume(agent, refOf(current));
  } catch (error) {
    ctx.logger.warn('Deep PTC: could not resume the goal (%s)', error.message);
  }
}

async function notify(agent, text, summary, source = 'deep-ptc-sleep') {
  try { return await deliver(agent, { text, summary }, source); } catch { return false; }
}

function statusText(state, goal) {
  const parts = [`${PHASE_LABELS[state.phase] ?? state.phase}`];
  if (state.cards.length > 0) parts.push(`已答 ${state.answered}/${state.cards.length} 张卡`);
  if (state.objective) parts.push(`目标：${state.objective}`);
  if (state.rounds > 0) parts.push(`第 ${state.rounds} 轮`);
  if (goal !== undefined) parts.push(`goal：${goal.phase}${goal.activation === 'armed' ? '·续跑中' : '·已暂停'}`);
  return parts.join(' · ');
}

function parseCommand(rawInput) {
  const raw = String(rawInput ?? '').trim();
  if (raw === '') return { action: 'toggle' };
  if (['on', 'off', 'status', 'toggle'].includes(raw)) return { action: raw };
  try {
    const value = JSON.parse(raw);
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const wanted = typeof value.action === 'string' ? value.action : value.on === true ? 'on' : value.on === false ? 'off' : 'toggle';
      if (['on', 'off', 'status', 'toggle'].includes(wanted)) return { action: wanted };
    }
  } catch { /* plain words were tried first */ }
  return undefined;
}

async function runCommand(ctx, request, read, append) {
  const agent = request.agent;
  const session = agent?.session;
  if (!session) return { kind: 'error', text: NO_SESSION };
  if (!isDeepPtcSession(ctx, session)) return { kind: 'error', text: WRONG_MODE };
  const parsed = parseCommand(request.rawInput);
  if (parsed === undefined) return { kind: 'error', text: 'Use on, off or status. / 请使用 on、off 或 status。' };
  const state = read(session);
  const goals = service(ctx, 'goals');
  if (parsed.action === 'status') return { kind: 'success', text: coded('sleep:' + state.phase, statusText(state, goals?.get(agent))) };
  const next = parsed.action === 'on' ? true : parsed.action === 'off' ? false : !state.on;
  if (next === state.on) return { kind: 'success', text: coded('sleep:' + state.phase, statusText(state, goals?.get(agent))) };
  await append(session, records.toggle(next, Date.now()));
  if (next) sleepQuota.begin(session); else sleepQuota.finish(session);
  if (next) {
    rearmGoal(ctx, agent);
    const after = read(session);
    const resuming = after.phase === 'running';
    await notify(agent, resuming ? resumeText(after) : wakeText(),
      resuming ? '深度睡眠模式已重新开启 · 继续运行' : '深度睡眠模式已开启 · 请一次性问完所有问题', 'deep-ptc-sleep');
  } else {
    pauseGoal(ctx, agent);
    if (agent.status === 'running') await notify(agent, offText(), '深度睡眠模式已关闭', 'deep-ptc-sleep');
  }
  return {
    kind: 'success',
    text: coded(next ? 'sleep:on' : 'sleep:off', next ? '深度睡眠模式已开启。' : '深度睡眠模式已关闭。'),
  };
}

/** Follow the run: count goal rounds, and reopen the briefing when the user writes during a run. */
function installReactions(ctx, read, append) {
  ctx.on('session/event', (session, event) => {
    let state;
    try { state = read(session); } catch { return; }
    if (state.on !== true) return;
    if (event.type === 'user/message') {
      const source = event.data?.source ?? {};
      if (source.kind === 'goal') {
        const round = Number(source.round);
        if (Number.isSafeInteger(round) && round > state.rounds) void Promise.resolve(append(session, records.round(round, Date.now()))).catch(() => {});
        return;
      }
      // What the user writes while the run goes is new information: pause the run and brief it,
      // then confirm again. Card answers and notices are not user messages.
      if (source.kind !== 'user' || state.phase !== 'running') return;
      const agent = service(ctx, 'agents')?.get(session.id);
      pauseGoal(ctx, agent);
      void Promise.resolve(append(session, records.reopen('用户发来新信息', Date.now()))).catch(() => {});
      if (agent !== undefined) {
        void notify(agent, '[Deep sleep mode: the user wrote while the run was going] New information arrived. Pause the work: turn what they added into questions (deep_sleep action=ask) or straight into a confirmation card, confirm with the user again, and only then continue the run. The host will not start another goal round until the confirmation is accepted.',
          '用户发来新信息 · 先确认再继续', 'deep-ptc-sleep').catch(() => {});
      }
      return;
    }
  });

  // The goal finishing (by the tool or by update_goal) ends the run in the panel too.
  ctx.on('goal/changed', ({ agent }) => {
    try {
      const session = agent?.session;
      if (!session) return;
      const state = read(session);
      if (state.on !== true || (state.phase !== 'running' && state.phase !== 'confirming')) return;
      const goal = service(ctx, 'goals')?.get(agent);
      if (goal === undefined) return;
      if (goal.phase === 'complete') {
        void Promise.resolve(append(session, records.complete(Date.now()))).catch(() => {});
        sleepQuota.finish(session);
      } else if (goal.phase === 'blocked') {
        void Promise.resolve(append(session, records.blocked({ reason: goal.blockedReason?.message ?? 'blocked', at: Date.now() }))).catch(() => {});
        sleepQuota.finish(session);
      }
    } catch { /* a projection must never break the goal event */ }
  });
}
