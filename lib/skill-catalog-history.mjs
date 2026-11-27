// Session-level baseline for the published skill catalog.
//
// `agent/pre-step` hands the listener only the messages claimed for this step, never the session
// history, so a catalog published on an earlier step cannot be found in that list. The baseline
// therefore comes from the session's own event log, the way the official tool-skill row reads it:
// the newest catalog message still visible on the session surface.
//
// A host that cannot replay its log falls back to process memory keyed by the session object, so a
// fresh process publishes one catalog and then stays quiet for that session.

import { CATALOG_KIND, catalogDigest, readCatalogSource } from './skill-catalog.mjs';

/**
 * Digest of the newest catalog still on the session surface.
 * @returns `{ published, digest? }`, or undefined when the session cannot be read.
 */
export function sessionCatalogHistory(session) {
  const nodes = session?.surface?.nodes;
  const end = session?.seq;
  if (typeof session?.eventAt !== 'function' || !Array.isArray(nodes) || !Number.isInteger(end) || end < 0) return undefined;
  const visible = new Set(nodes);
  let published = false;
  for (let seq = end - 1; seq >= 0; seq -= 1) {
    const event = session.eventAt(seq);
    // A log truncated below the surface cannot answer this question; let the caller fall back.
    if (event === undefined || event === null) return undefined;
    if (event.type !== 'user/message' || event.data?.source?.kind !== CATALOG_KIND) continue;
    const read = readCatalogSource(event.data.source);
    if (read === undefined) continue;
    published = true;
    if (visible.has(seq)) return { published, digest: catalogDigest(read.entries, read.incomplete) };
  }
  return { published };
}

/** Process-local fallback: the last digest published per session object. */
export function createCatalogMemory() {
  const digests = new WeakMap();
  return {
    read(session) {
      if (session === null || typeof session !== 'object') return undefined;
      const digest = digests.get(session);
      return digest === undefined ? undefined : { published: true, digest };
    },
    remember(session, digest) {
      if (session !== null && typeof session === 'object') digests.set(session, digest);
    },
  };
}

/** Session history when readable, process memory otherwise. */
export function catalogHistoryOf(session, memory) {
  return sessionCatalogHistory(session) ?? memory.read(session) ?? { published: false };
}
