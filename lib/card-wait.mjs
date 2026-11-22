// Keep human waits outside run_code: a human decision may take longer than its JavaScript budget.
// Nested SDK calls publish the card; only their root dispatch waits, before the next model step.
// A user who writes instead of answering ends that wait: the message carries the decision, and the
// card stays answerable for a later click. Only card tools are refused while one waits, so an
// unrelated call no longer fails the whole program (#40).
import { steeringPending, steeringWatch } from './reachable.mjs';

export const PENDING_CARD = 'Awaiting a card decision. Resume in the next model step.';
const CARD_TOOLS = new Set(['ui_card', 'ask_user', 'ask_user_question', 'task_brief', 'project_cards']);

export function installCardWait(ctx, watch) {
  const roots = new WeakMap();
  const listeners = new Set();
  const deliveries = new Map();
  const steering = steeringWatch(ctx);
  let disposed = false;
  const changed = () => { for (const check of listeners) check(); };
  const unwatch = watch(changed);
  ctx.effect(() => () => { disposed = true; changed(); unwatch(); });
  // A program can call the SDK more than once. Do not dispatch another nested operation
  // based on an assumed choice. The outer call remains alive for the actual decision.
  ctx.on('tools/pre-execute', (exec, next) => {
    // A card tool would answer or replace the card being decided; every other call can still run.
    if (!CARD_TOOLS.has(exec.name)) return next();
    const checks = exec.parent ? roots.get(exec.agent)?.get(exec.rootCallId) : undefined;
    return checks?.some(test => test()) ? { kind: 'deny', reason: PENDING_CARD } : next();
  });
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const calls = roots.get(exec.agent);
    const pending = calls?.get(exec.callId);
    if (!pending || exec.parent) return next();
    calls.delete(exec.callId);
    await new Promise((resolve, reject) => {
      // The user speaking is a decision channel of its own: it ends the wait instead of leaving the
      // root dispatch held until the card is clicked.
      const steered = exec.agent ? steering.next(exec.agent) : undefined;
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        listeners.delete(check);
        exec.signal?.removeEventListener('abort', check);
        steered?.dispose();
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        try {
          if (disposed || exec.signal?.aborted || steeringPending(exec.agent)
            || (!deliveries.has(exec.agent.session.id) && !pending.some(test => test()))) finish();
        } catch (error) { finish(error); }
      };
      listeners.add(check);
      exec.signal?.addEventListener('abort', check, { once: true });
      steered?.promise.then(check, check);
      check();
    });
    return next();
  });
  return {
    add(exec, pending) {
      const id = exec.rootCallId ?? exec.callId;
      if (!id || disposed) return;
      let calls = roots.get(exec.agent);
      if (!calls) roots.set(exec.agent, calls = new Map());
      const checks = calls.get(id) ?? [];
      checks.push(pending);
      calls.set(id, checks);
    },
    // A committed click may already be visible while its steering message is being queued.
    // Another click or settings refresh must not let the next step outrun that message.
    delivering(sessionId) {
      deliveries.set(sessionId, (deliveries.get(sessionId) ?? 0) + 1);
      return () => {
        const left = deliveries.get(sessionId) - 1;
        if (left) deliveries.set(sessionId, left);
        else deliveries.delete(sessionId);
        changed();
      };
    },
    changed,
  };
}
