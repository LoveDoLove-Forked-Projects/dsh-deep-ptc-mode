// Alert sounds live on the host: $DSH_HOME/storages/deep-ptc-sounds/.
//
// The uploaded audio and the clips people saved sit in one directory per profile, with an index.json
// beside them. The desktop host plays the file itself (lib/notify/popup.ps1), so a browser cache never
// holds the only copy; the web client streams the same bytes back through the plugin's own route.

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dshHome } from './project-store.mjs';

export const SOUNDS_DIRNAME = 'deep-ptc-sounds';
export const MAX_SOUND_BYTES = 30 * 1024 * 1024;
// Formats the Windows desktop player and the browser both decode.
export const SOUND_EXTENSIONS = ['.mp3', '.wav', '.m4a'];
export const MAX_CLIP_SECONDS = 30;
export const MIN_CLIP_SECONDS = 0.2;
const INDEX_FILE = 'index.json';
const TEMP_DIR = 'incoming';

const clampText = (value, max) => String(value ?? '').replace(/[\u0000-\u001f]/gu, ' ').trim().slice(0, max);

function atomicWrite(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, text, { encoding: 'utf8', flag: 'wx' });
  try { renameSync(temporary, path); }
  catch (error) { try { unlinkSync(temporary); } catch { /* the rename failed first */ } throw error; }
}

const validId = value => typeof value === 'string' && /^[a-z0-9-]{8,64}$/u.test(value);

export function createSoundStore({ directory = join(dshHome(), 'storages', SOUNDS_DIRNAME) } = {}) {
  const index = join(directory, INDEX_FILE);
  const incoming = join(directory, TEMP_DIR);

  function readIndex() {
    try {
      const parsed = JSON.parse(readFileSync(index, 'utf8'));
      const rows = Array.isArray(parsed?.sounds) ? parsed.sounds : [];
      return rows.filter(row => validId(row?.id) && typeof row.file === 'string'
        && typeof row.start === 'number' && typeof row.end === 'number');
    } catch { return []; }
  }

  function writeIndex(rows) {
    atomicWrite(index, JSON.stringify({ version: 1, sounds: rows }, null, 2) + '\n');
  }

  function list() {
    return readIndex().filter(row => existsSync(join(directory, row.file)));
  }

  function fileOf(id) {
    const row = list().find(entry => entry.id === id);
    return row === undefined ? undefined : { ...row, path: join(directory, row.file) };
  }

  function tempPath(id, extension) {
    if (!validId(id)) throw new Error('invalid id');
    const ext = extension.startsWith('.') ? extension : '.' + extension;
    if (!SOUND_EXTENSIONS.includes(ext)) throw new Error('unsupported format');
    mkdirSync(incoming, { recursive: true });
    return join(incoming, id + ext);
  }

  function save({ id, extension, name, start, end, duration }) {
    if (!validId(id)) throw new Error('invalid id');
    const ext = extension.startsWith('.') ? extension : '.' + extension;
    if (!SOUND_EXTENSIONS.includes(ext)) throw new Error('unsupported format');
    const from = join(incoming, id + ext);
    if (!existsSync(from)) { const error = new Error('upload not found'); error.code = 'ENOENT'; throw error; }
    const total = Number(duration) || 0;
    const safeStart = Math.max(0, Number(start) || 0);
    const safeEnd = Math.min(Number(end) || 0, total || Number(end) || 0);
    if (!(safeEnd - safeStart >= MIN_CLIP_SECONDS)) throw new Error('the clip is too short');
    if (safeEnd - safeStart > MAX_CLIP_SECONDS) throw new Error('the clip is too long');
    const file = id + ext;
    renameSync(from, join(directory, file));
    const entry = {
      id, file, name: clampText(name, 80) || '提示音',
      start: Number(safeStart.toFixed(3)), end: Number(safeEnd.toFixed(3)),
      duration: Number((total || safeEnd).toFixed(3)),
      size: statSync(join(directory, file)).size,
      createdAt: Date.now(),
    };
    writeIndex([...list().filter(row => row.id !== id), entry]);
    return entry;
  }

  function remove(id) {
    const row = list().find(entry => entry.id === id);
    if (row === undefined) return false;
    try { unlinkSync(join(directory, row.file)); } catch { /* already gone */ }
    writeIndex(list().filter(entry => entry.id !== id));
    return true;
  }

  function rename(id, name) {
    const rows = list();
    const row = rows.find(entry => entry.id === id);
    if (row === undefined) return undefined;
    const next = { ...row, name: clampText(name, 80) || row.name };
    writeIndex(rows.map(entry => entry.id === id ? next : entry));
    return next;
  }

  function trim(id, start, end) {
    const rows = list();
    const row = rows.find(entry => entry.id === id);
    if (row === undefined) return undefined;
    const safeStart = Math.max(0, Math.min(Number(start) || 0, row.duration));
    const safeEnd = Math.min(Number(end) || row.duration, row.duration);
    if (!(safeEnd - safeStart >= MIN_CLIP_SECONDS)) throw new Error('the clip is too short');
    if (safeEnd - safeStart > MAX_CLIP_SECONDS) throw new Error('the clip is too long');
    const next = { ...row, start: Number(safeStart.toFixed(3)), end: Number(safeEnd.toFixed(3)) };
    writeIndex(rows.map(entry => entry.id === id ? next : row));
    return next;
  }

  /** Drop one upload that was never saved. */
  function discard(id, extension) {
    if (!validId(id)) return false;
    const ext = extension.startsWith('.') ? extension : '.' + extension;
    if (!SOUND_EXTENSIONS.includes(ext)) return false;
    try { unlinkSync(join(incoming, id + ext)); return true; } catch { return false; }
  }

  /** Remove uploads that were never saved; the host calls it once at start. */
  function cleanup() {
    try {
      for (const name of readdirSync(incoming)) {
        try { unlinkSync(join(incoming, name)); } catch { /* keep cleaning */ }
      }
    } catch { /* no incoming folder yet */ }
  }

  return { directory, index, list, fileOf, tempPath, save, remove, rename, trim, discard, cleanup };
}
