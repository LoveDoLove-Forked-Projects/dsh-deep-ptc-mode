// File I/O for project cards.
//
// The cards live in the workspace (PROJECT-CARDS.md, found like AGENTS.md by walking up from the
// conversation's folder). Version history and pending proposals are bookkeeping, not project
// content, so they stay in DSH's own storage: $DSH_HOME/storages/deep-ptc-project-cards.json.
//
// Prompt reads reuse parsed documents. Writes re-read the bytes to detect external edits.

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse, resolve } from 'node:path';
import { PROJECT_FILE, parseDoc, serializeDoc } from './project-cards.mjs';

export const HISTORY_DEPTH = 10;
const MAX_PROPOSALS = 20;

export function dshHome(env = process.env) {
  return typeof env.DSH_HOME === 'string' && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh');
}

function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx' });
  try { renameSync(temporary, path); }
  catch (error) { try { unlinkSync(temporary); } catch {} throw error; }
}

/**
 * The store. `sidecar` can be overridden for tests.
 * @param options - `{ sidecar?: string }`: path of the bookkeeping file.
 */
export function createProjectStore({ sidecar = join(dshHome(), 'storages', 'deep-ptc-project-cards.json') } = {}) {
  const cache = new Map();

  /** The project file for a folder: the nearest PROJECT-CARDS.md at or above it, else undefined. */
  function locate(cwd) {
    if (typeof cwd !== 'string' || cwd === '') return undefined;
    let folder = resolve(cwd);
    const { root } = parse(folder);
    for (;;) {
      const candidate = join(folder, PROJECT_FILE);
      if (existsSync(candidate)) return candidate;
      if (folder === root) return undefined;
      folder = dirname(folder);
    }
  }

  /** Where a new file goes: the conversation's own folder. */
  const target = cwd => locate(cwd) ?? join(resolve(cwd), PROJECT_FILE);

  /** Read and parse a project file, cached by its filesystem signature. */
  function read(path, { fresh = false } = {}) {
    if (path === undefined) return undefined;
    const hit = cache.get(path);
    let stat, source;
    try {
      stat = statSync(path, { bigint: true });
      const signature = `${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
      if (!fresh && hit?.signature === signature) return hit.value;
      source = readFileSync(path, 'utf8');
      const value = hit?.value.source === source ? hit.value : {
        path, source, ...parseDoc(source, { trackLayout: true }),
        version: createHash('sha256').update(path).update('\0').update(source).digest('hex'),
      };
      cache.set(path, { signature, value });
      return value;
    } catch (error) {
      cache.delete(path);
      if (error.code !== 'ENOENT') throw error;
    }
  }

  function write(path, doc, expectedVersion) {
    const previous = read(path, { fresh: true });
    if (expectedVersion !== undefined && expectedVersion !== (previous?.version ?? null)) {
      const error = new Error('PROJECT-CARDS.md changed. Review the latest version before saving.');
      error.code = 'PROJECT_CARDS_CONFLICT';
      throw error;
    }
    atomicWrite(path, serializeDoc(doc, previous));
    cache.delete(path);
    return read(path);
  }

  function books() {
    try { return JSON.parse(readFileSync(sidecar, 'utf8')); } catch { return {}; }
  }
  function saveBooks(value) { atomicWrite(sidecar, JSON.stringify(value, null, 1)); }
  const entry = (all, path) => (all[path] ??= { history: {}, proposals: [], seq: 0 });

  /** Remember a card version before it is replaced, newest first. */
  function remember(path, card) {
    if (card === undefined) return;
    const all = books();
    const book = entry(all, path);
    const list = book.history[card.id] ?? [];
    book.history[card.id] = [{ rev: card.rev, title: card.title, ...card.category ? { category: card.category } : {}, items: card.items, updated: card.updated }, ...list.filter(row => row.rev !== card.rev)].slice(0, HISTORY_DEPTH);
    saveBooks(all);
  }

  const history = (path, id) => books()[path]?.history?.[id] ?? [];
  const historyAll = path => books()[path]?.history ?? {};
  const proposals = path => books()[path]?.proposals ?? [];

  function propose(path, proposal) {
    const all = books();
    const book = entry(all, path);
    book.seq += 1;
    const row = { id: `P${book.seq}`, at: new Date().toISOString(), ...proposal };
    book.proposals = [...book.proposals.filter(item => item.card === undefined || item.card !== proposal.card), row].slice(-MAX_PROPOSALS);
    saveBooks(all);
    return row;
  }

  function settle(path, id) {
    const all = books();
    const book = entry(all, path);
    const row = book.proposals.find(item => item.id === id);
    book.proposals = book.proposals.filter(item => item.id !== id);
    saveBooks(all);
    return row;
  }

  return { locate, target, read, write, remember, history, historyAll, proposals, propose, settle };
}
