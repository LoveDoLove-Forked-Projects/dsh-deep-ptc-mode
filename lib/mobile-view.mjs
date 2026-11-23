// Native cards in DSH Go's conversation.
//
// DSH Go draws a native card from a tool result's `meta["dsh-go/view"]`, which travels with the log, so
// it works on the phone's own engine, over SSH and over the relay. Cards are posted from inside run_code
// programs, and DSH Go shows only root calls, so the view goes on the root call's result.
//
// The host takes meta only from a definition's `output.presentationMeta`, and run_code's definition
// belongs to the PTC executor. For the one result that carries cards, the hook adds that projector and
// returns the unchanged value, so the host renders the same content again with the meta. It runs after
// the wait for the user (lib/card-wait.mjs), so the card shows what was decided. Any surprise leaves the
// result as the host made it.

import { toolCardView, VIEW_KEY } from './card-text.mjs';
import { hostLanguage } from './decisions.mjs';

// The host re-renders the content from the value; a large result may have been shaped by other policies.
const MAX_CONTENT = 12_000;
const views = new WeakMap();
const patched = new WeakSet();
const log = new WeakMap();

/**
 * Note that this call posted something DSH Go should show.
 * @param key - the same key again replaces the earlier note, so a card shows once per call.
 * @param section - builds `{ title, children }` when the call's result is written.
 */
export function noteMobileView(exec, key, section) {
  const root = exec?.rootCallId ?? exec?.callId;
  if (root === undefined || exec.agent === undefined) return;
  let calls = log.get(exec.agent);
  if (calls === undefined) log.set(exec.agent, calls = new Map());
  const sections = calls.get(root) ?? new Map();
  sections.set(key, section);
  calls.set(root, sections);
}

function definitionOf(ctx, exec) {
  const tools = ctx.get('tools');
  return exec.name === 'run_code' ? tools?.selectExecutor?.(exec.agent)?.requirePtcTransport?.()
    : tools?.executable?.(exec.name, exec.agent, exec.toolSet) ?? tools?.get?.(exec.name, exec.agent, exec.toolSet);
}

// The projector exists only while a result with cards is being written, so other results keep theirs.
let active = 0;
function patch(definition) {
  const output = definition?.output;
  if (typeof output?.render !== 'function') return false;
  if (patched.has(output)) return true;
  const original = output.presentationMeta;
  const projector = (args, value) => {
    const view = args !== null && typeof args === 'object' ? views.get(args) : undefined;
    const base = original?.call(output, args, value) ?? {};
    return view === undefined ? base : { ...base, [VIEW_KEY]: view };
  };
  Object.defineProperty(output, 'presentationMeta', { configurable: true, enumerable: true, get: () => active > 0 ? projector : original });
  patched.add(output);
  return true;
}

const sizeOf = content => Array.isArray(content) ? content.reduce((sum, block) => sum + (block?.type === 'text' ? block.text.length : Infinity), 0) : Infinity;

/** Call before lib/card-wait.mjs installs its hook, so this one sees the settled cards. */
export function installMobileView(ctx, options = {}) {
  const language = options.language ?? hostLanguage();
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next();
    if (exec.parent || exec.agent === undefined) return decision;
    const calls = log.get(exec.agent);
    const sections = calls?.get(exec.callId);
    if (sections === undefined) return decision;
    calls.delete(exec.callId);
    try {
      if (options.enabled?.() === false || result.isError || decision.kind !== 'accept' || Object.hasOwn(decision, 'content') || Object.hasOwn(decision, 'value')
        || exec.arguments === null || typeof exec.arguments !== 'object' || sizeOf(result.content) > MAX_CONTENT) return decision;
      const view = toolCardView([...sections.values()].map(build => { try { return build(); } catch { return undefined; } }).filter(Boolean), language);
      if (view === undefined || !patch(definitionOf(ctx, exec))) return decision;
      views.set(exec.arguments, view);
      active += 1;
      // The host reads the projector right after this hook returns.
      setTimeout(() => { active -= 1; }, 1000).unref?.();
      return { ...decision, value: result.value };
    } catch (error) {
      ctx.logger?.warn?.('Deep PTC: no native card for DSH Go (%s)', error?.message);
      return decision;
    }
  });
}
