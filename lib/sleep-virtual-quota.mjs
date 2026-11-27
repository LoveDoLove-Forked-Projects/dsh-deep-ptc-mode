// Per-run virtual DSH quota for deep sleep mode.
//
// A deep sleep run starts with 20 uses already allowed; the initial ask batch may request a larger
// total (3x the model's estimate). The quota itself lives in the virtual DSH runtime; this module
// only owns the per-run seeding/finishing and the editable question card that carries the request.

import { virtualRuntime } from './virtual-dsh.mjs';

export const DEFAULT_USES = 20;
export const MAX_USES = 200;
export const QUOTA_QUESTION = 'starts';

// Sessions whose current run already has a quota. A run ends with finish(), so the next task in the
// same conversation seeds its own 20 without touching an approved larger total mid-run.
const seeded = new Set();

const api = () => virtualRuntime.api;

/** Start a run with the default 20 uses; replaces an earlier run's quota. */
export function begin(session) {
  if (session?.id === undefined || api() === undefined) return;
  seeded.add(session.id);
  api().setQuota(session.id, DEFAULT_USES);
}

/** Seed the default for a new run; an already seeded run keeps its (possibly larger) total. */
export function ensure(session) {
  if (session?.id === undefined || seeded.has(session.id)) return;
  begin(session);
}

/** Grant the total the user approved in the batch, clamped to the supported range. */
export function grant(session, value) {
  const total = parseUses(value);
  if (session?.id === undefined || total === undefined) return undefined;
  const runtime = api();
  if (runtime === undefined) return undefined;
  seeded.add(session.id);
  return runtime.setQuota(session.id, total);
}

/** End the run; the next run seeds its own default. */
export function finish(session) {
  if (session?.id === undefined) return;
  seeded.delete(session.id);
  api()?.setQuota(session.id, 0);
}

/** Parse a user answer (`90`, `90 次`) into 20..200, or undefined when it has no number. */
export function parseUses(value) {
  const match = String(value ?? '').match(/\d+/u);
  if (match === null) return undefined;
  const total = Number(match[0]);
  if (!Number.isSafeInteger(total)) return undefined;
  return Math.min(MAX_USES, Math.max(DEFAULT_USES, total));
}

/** The requested total when the model estimates more than the default; otherwise undefined. */
export function requested(value) {
  const total = parseUses(value);
  return total !== undefined && total > DEFAULT_USES ? total : undefined;
}

/** The extra card added to the model's first ask batch when it needs more than the default. */
export function quotaCard(requestedTotal) {
  return {
    title: '虚拟 DSH 使用额度',
    subtitle: `本次深度睡眠运行默认 ${DEFAULT_USES} 次；按估算值的 3 倍申请，至少 ${DEFAULT_USES} 次，最多 ${MAX_USES} 次。`,
    virtualQuota: true,
    questions: [{
      id: QUOTA_QUESTION,
      type: 'text',
      optional: true,
      prompt: `允许本次运行使用多少次虚拟 DSH？建议 ${requestedTotal} 次（3 倍估算，至少 ${DEFAULT_USES}，最多 ${MAX_USES}）；留空保持 ${DEFAULT_USES} 次。`,
      placeholder: String(requestedTotal),
    }],
  };
}
