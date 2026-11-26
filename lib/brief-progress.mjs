// Acceptance progress for the task brief.
//
// A file of its own on purpose: after a live update, modules of the previous version may still be in
// memory (scripts/check-live-update.mjs), so new names never join an existing file.

/** How much of the acceptance is verified: `{ done, total, open }`, open ids in card order. */
export function acceptanceProgress(brief) {
  const rows = brief.items.filter(item => item.section === 'acceptance' && item.status !== 'dropped');
  return { done: rows.filter(item => item.status === 'done').length, total: rows.length,
    open: rows.filter(item => item.status === 'open').map(item => item.id) };
}
