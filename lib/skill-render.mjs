// Skill name validation, invocation policy and the model-facing <skill_content> frame.
//
// The official helpers live in @deepseek-ai/dsh-skill, which a profile plugin cannot always resolve
// while the preset mounts. The skill manager therefore owns these few pure functions: the grammar,
// the default policy and the renderer match the installed host's module exactly, so skill cards and
// the user-explicit invocation path keep parsing the same shapes.

/** The public kebab-case skill-name grammar. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export function isSkillName(name) {
  return typeof name === 'string' && SKILL_NAME.test(name);
}

export function isModelInvocable(skill) {
  return skill?.invocation?.modelInvocable === true;
}

export function isUserInvocable(skill) {
  return skill?.invocation?.userInvocable === true;
}

const escapeText = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const escapeAttr = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

function resourceHint(skill) {
  const base = skill?.resourceBase;
  if (base === undefined) return ['Resources for this skill are managed by provider "' + escapeText(skill?.provider) + '".', 'Load referenced resources only as needed.'];
  if (base.kind === 'directory') return ['Base directory for this skill: ' + escapeText(base.path), 'Resolve relative paths mentioned by this skill against the base directory before using them. Load referenced resources only as needed.'];
  if (base.kind === 'url') return ['Base URL for this skill: ' + escapeText(base.url), 'Resolve relative URLs mentioned by this skill against the base URL before using them. Load referenced resources only as needed.'];
  if (base.kind === 'opaque') return ['Resources for this skill: ' + escapeText(base.description), 'Load referenced resources only as needed.'];
  return ['Load referenced resources only as needed.'];
}

/** The one canonical <skill_content> block, identical to the host's renderer. */
export function renderSkillContent(skill) {
  return [
    '<skill_content name="' + escapeAttr(skill?.name) + '">',
    '<skill_resources>',
    ...resourceHint(skill),
    '</skill_resources>',
    '',
    '<skill_instructions>',
    String(skill?.content ?? ''),
    '</skill_instructions>',
    '</skill_content>',
  ].join('\n');
}
