// Where the skill manager keeps the user's choices: $DSH_HOME/storages/deep-ptc-skills/skills.json.
//
// Two facts live in one small file: which skill names are hidden from the model, and the newest
// complete skill list Deep PTC saw. The settings page reads the file through the plugin's own route;
// the manager reads it at every step, so a toggle applies without restarting anything.

import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dshHome } from './project-store.mjs';

export const SKILLS_DIRNAME = 'deep-ptc-skills';
export const SKILLS_FILE = 'skills.json';
export const MAX_HIDDEN = 2000;
export const MAX_KNOWN = 500;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

const text = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/gu, ' ').trim().slice(0, max) : '';

/** A valid skill name, or '' when the value is not one. */
export function skillName(value) {
  const name = text(value, 128);
  return NAME.test(name) ? name : '';
}

function normalizeKnown(rows) {
  const known = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const name = skillName(row?.name);
    if (name === '' || seen.has(name)) continue;
    seen.add(name);
    known.push({
      name, description: text(row?.description, 500),
      source: text(row?.source, 40) || 'unknown', provider: text(row?.provider, 120),
      // The executor treats a missing policy as not model-invocable; the settings row must agree.
      modelInvocable: row?.modelInvocable === true,
    });
    if (known.length >= MAX_KNOWN) break;
  }
  return known;
}

/** Validate one stored value, dropping anything unusable. */
export function normalizeSkillStore(value) {
  const hidden = [];
  const seen = new Set();
  for (const row of Array.isArray(value?.hidden) ? value.hidden : []) {
    const name = skillName(row);
    if (name === '' || seen.has(name)) continue;
    seen.add(name);
    hidden.push(name);
    if (hidden.length >= MAX_HIDDEN) break;
  }
  return { v: 1, hidden, known: normalizeKnown(value?.known), updatedAt: Number.isSafeInteger(value?.updatedAt) ? value.updatedAt : 0 };
}

function atomicWrite(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.' + randomUUID() + '.tmp';
  writeFileSync(temporary, content, { encoding: 'utf8', flag: 'wx' });
  try { renameSync(temporary, path); }
  catch (error) { try { unlinkSync(temporary); } catch { /* the rename failed first */ } throw error; }
}

export function createSkillStore({ directory = join(dshHome(), 'storages', SKILLS_DIRNAME) } = {}) {
  const file = join(directory, SKILLS_FILE);

  // Always read the file: the settings page writes it through the plugin's route while the manager
  // runs in another module instance, so an in-memory copy would go stale after a toggle.
  function read() {
    try { return normalizeSkillStore(JSON.parse(readFileSync(file, 'utf8'))); }
    catch { return normalizeSkillStore(undefined); }
  }

  function write(value) {
    const next = normalizeSkillStore({ ...value, updatedAt: Date.now() });
    atomicWrite(file, JSON.stringify(next, null, 2) + '\n');
    return next;
  }

  return {
    read,
    hidden() { return read().hidden; },
    known() { return read().known; },
    setHidden(name, hidden) {
      const value = skillName(name);
      if (value === '') throw new Error('invalid skill name');
      const current = read();
      const names = new Set(current.hidden);
      if (hidden === true) names.add(value); else names.delete(value);
      return write({ ...current, hidden: [...names] });
    },
    remember(rows) {
      const known = normalizeKnown(rows);
      const current = read();
      if (JSON.stringify(current.known) === JSON.stringify(known)) return current;
      return write({ ...current, known });
    },
  };
}