// Pure helpers for the Deep PTC skill catalog.
//
// The official tool-skill row publishes the model-visible <available_skills> message and only lists
// invocable skills. Deep PTC replaces that row with the skill manager, so these helpers own the same
// message shape: the side panel's skill card and every other consumer keep reading it unchanged.

import { createHash } from 'node:crypto';

export const CATALOG_KIND = 'skill-catalog';
export const MAX_DESCRIPTION = 500;
export const MAX_ENTRIES = 500;

const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/gu, ' ').trim() : '';
const esc = value => value.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');

/** One catalog entry per skill, hidden names removed, sorted by name. */
export function catalogEntries(skills, hidden = [], maxDescription = MAX_DESCRIPTION) {
  const blocked = new Set(Array.isArray(hidden) ? hidden : []);
  return (Array.isArray(skills) ? skills : [])
    .filter(skill => skill !== null && typeof skill === 'object' && typeof skill.name === 'string' && skill.name !== '' && !blocked.has(skill.name))
    .slice(0, MAX_ENTRIES)
    .map(skill => ({ name: skill.name, description: clean(skill.description).slice(0, maxDescription) }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

/** Identity of one catalog: entries plus discovery completeness. */
export function catalogDigest(entries, incomplete = false) {
  const canonical = (Array.isArray(entries) ? entries : []).map(entry => JSON.stringify([entry.name, entry.description])).join('\n');
  return createHash('sha256').update(incomplete ? 'incomplete\n' : '').update(canonical).digest('hex');
}

/** The model-facing catalog text, the same frames the official skill tool emits. */
export function catalogText(entries, { incomplete = false, update = false } = {}) {
  const lines = (Array.isArray(entries) ? entries : []).map(entry => '- \u0060' + entry.name + '\u0060: ' + esc(entry.description));
  const head = update
    ? (incomplete
      ? 'Skill discovery is incomplete. This catalog of currently available skills replaces every earlier available-skills list in this session:'
      : 'The available skill catalog changed. This complete catalog replaces every earlier available-skills list in this session:')
    : (entries.length === 0
      ? 'No skills could be confirmed in this discovery attempt.'
      : 'A skill is a reusable set of task-specific instructions. The following skills are available in this session:');
  return [
    '<system-reminder>',
    head,
    '',
    '<available_skills>',
    ...lines,
    '</available_skills>',
    '',
    ...incomplete ? ['Some skills could not be checked. Only confirmed skills are listed; a lower-priority definition of the same name may be selected when a preferred source is unavailable. Discovery will be retried on the next request.', ''] : [],
    ...entries.length === 0
      ? [update
        ? (incomplete ? 'No skills could be confirmed in this discovery attempt. Do not use names from earlier skill catalogs.' : 'No skills are currently available through the \u0060skill\u0060 tool. Do not use names from earlier skill catalogs.') : 'Wait for an updated catalog before calling the \u0060skill\u0060 tool. Do not infer skill instructions from an empty catalog.',
        'A user may still invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the \u0060skill\u0060 tool for it.']
      : [update
        ? 'Use only names in this replacement catalog. If the user names a listed skill, or the task clearly matches its description, call the \u0060skill\u0060 tool with the exact name before acting.'
        : 'If the user names a skill, or the task clearly matches a skill\u2019s description, call the \u0060skill\u0060 tool with the exact skill name before taking task actions. Load all applicable skills, then follow their full instructions. This catalog contains summaries only; do not infer or follow a skill\u2019s instructions until it has been loaded.',
        'A user may also invoke a skill directly; its <skill_content> block then appears in this conversation. Follow it, and do not call the \u0060skill\u0060 tool again for that skill.'],
    '</system-reminder>',
  ].join('\n');
}

/** The source object carried by the catalog message. */
export function catalogSource(entries, { incomplete = false, update = false } = {}) {
  return { kind: CATALOG_KIND, form: 'catalog', ...update ? { update: true } : {}, entries, ...incomplete ? { incomplete: true } : {} };
}

/** Entries of one catalog source, or undefined when the record is not a usable catalog. */
export function readCatalogSource(source) {
  if (source === null || typeof source !== 'object' || source.kind !== CATALOG_KIND || !Array.isArray(source.entries)) return undefined;
  const entries = [];
  for (const entry of source.entries) {
    if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string' || entry.name === ''
      || typeof entry.description !== 'string') return undefined;
    entries.push({ name: entry.name, description: entry.description });
  }
  return { entries, incomplete: source.incomplete === true };
}

/** The first catalog message in a model-visible message list. */
export function catalogMessageOf(messages) {
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.source?.kind !== CATALOG_KIND) continue;
    const read = readCatalogSource(message.source);
    if (read !== undefined) return { message, ...read };
  }
  return undefined;
}
