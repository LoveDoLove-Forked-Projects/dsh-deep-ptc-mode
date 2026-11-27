// The skill manager: Deep PTC's replacement for the official tool-skill row.
//
// The official row publishes the model-visible <available_skills> catalog and the `skill` loader.
// Its own comment names the supported way to filter that catalog: a scoped same-name tool shadow
// removes both the schema and its call guidance. Deep PTC disables the official row and mounts this
// one instead, so the catalog and the loader both honour the user's hidden-skill list while the
// registry, providers and skill bodies stay exactly as DSH installed them.

import { randomUUID } from 'node:crypto';
import { isDeepPtcSession } from './session-preset.mjs';
import * as hostSkill from './skill-render.mjs';
import { createSkillStore } from './skill-store.mjs';
import { catalogDigest, catalogEntries, catalogMessageOf, catalogSource, catalogText } from './skill-catalog.mjs';

export const name = 'deep-ptc-skill-manager';
export const inject = ['skills', 'tools', 'workingDirectory'];

const GESTURE = /(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/gu;

/** Text blocks of one claimed step message that the user typed. */
function userTextOf(message) {
  if (message?.source?.kind !== 'user' || !Array.isArray(message.content)) return [];
  return message.content.filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text);
}

export function apply(ctx) {
  return installSkillManager(ctx);
}

/** The installable core; the host helpers and the store are explicit so tests can drive them. */
export function installSkillManager(ctx, helpers = {}, { store = createSkillStore() } = {}) {
  const isModelInvocable = helpers.isModelInvocable ?? hostSkill.isModelInvocable;
  const isSkillName = helpers.isSkillName ?? hostSkill.isSkillName;
  const isUserInvocable = helpers.isUserInvocable ?? hostSkill.isUserInvocable;
  const renderSkillContent = helpers.renderSkillContent ?? hostSkill.renderSkillContent;
  // The official createUserMessage only adds the user role and a fresh id; the catalog message must
  // carry the same shape so the session surface and the skill card read it like the official one.
  const userMessage = input => ({ ...input, role: 'user', id: randomUUID() });

  async function lookupOf(agent, signal) {
    const cwd = agent === undefined ? undefined : await ctx.workingDirectory.ensure(agent, signal);
    return { cwd, signal, scope: agent };
  }

  // A user gesture is an explicit /skill-name in a message they typed; it loads even when the skill
  // is hidden from the model catalog, because the user asked for it by name.
  async function gestureMessages(messages, lookup) {
    const names = [];
    for (const message of messages) {
      for (const text of userTextOf(message)) {
        for (const match of text.matchAll(GESTURE)) if (!names.includes(match[2])) names.push(match[2]);
      }
    }
    const out = [];
    for (const skillName of names) {
      const skill = await ctx.skills.get(skillName, lookup).catch(() => undefined);
      if (skill === undefined || !isUserInvocable(skill)) continue;
      out.push(userMessage({ content: [{ type: 'text', text: renderSkillContent(skill) }],
        source: { kind: 'skill-invocation', name: skillName, form: 'instructions' } }));
    }
    return out;
  }

  const skillTool = {
    name: 'skill',
    resident: true,
    description: 'Load the full instructions for a skill. Call it before acting on a task that names or clearly matches a skill in the session skill catalog.',
    parameters: { type: 'object', additionalProperties: false, required: ['name'],
      properties: { name: { type: 'string', description: 'The exact skill name from the available skills list.' } } },
    output: { schema: {
      type: 'object', additionalProperties: false, required: ['name', 'provider', 'content'],
      properties: {
        name: { type: 'string' },
        provider: { type: 'string' },
        resourceBase: { oneOf: [
          { type: 'object', additionalProperties: false, required: ['kind', 'path'], properties: { kind: { type: 'string', const: 'directory' }, path: { type: 'string' } } },
          { type: 'object', additionalProperties: false, required: ['kind', 'url'], properties: { kind: { type: 'string', const: 'url' }, url: { type: 'string' } } },
          { type: 'object', additionalProperties: false, required: ['kind', 'description'], properties: { kind: { type: 'string', const: 'opaque' }, description: { type: 'string' } } },
        ] },
        content: { type: 'string' },
      },
    }, render: (_args, value) => [{ type: 'text', text: renderSkillContent(value) }] },
    async execute(args, exec) {
      const skillName = args?.name;
      if (!isSkillName(skillName)) throw new Error('invalid skill name "' + String(skillName ?? '') + '"');
      if (store.hidden().includes(skillName)) throw new Error('skill "' + skillName + '" is hidden by the Deep PTC skill settings');
      const lookup = await lookupOf(exec.agent, exec.signal);
      const summary = (await ctx.skills.list(lookup)).find(skill => skill.name === skillName);
      if (summary === undefined) throw new Error('skill "' + skillName + '" is unknown or no longer available');
      if (!isModelInvocable(summary)) throw new Error('skill "' + skillName + '" is not available for model invocation');
      const skill = await ctx.skills.get(skillName, lookup);
      if (skill === undefined) throw new Error('skill "' + skillName + '" is unknown or no longer available');
      if (!isModelInvocable(skill)) throw new Error('skill "' + skillName + '" is not available for model invocation');
      return { name: skill.name, provider: skill.provider, ...skill.resourceBase !== undefined ? { resourceBase: { ...skill.resourceBase } } : {}, content: skill.content };
    },
    presentCall(args) { return { card: 'generic', title: 'Load skill ' + String(args?.name ?? ''), kind: 'read', rawInput: args?.name }; },
  };

  ctx.effect(() => ctx.tools.register(skillTool), 'Deep PTC: skill tool');

  ctx.effect(() => ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next();
    if (decision === undefined || decision.kind === 'reject') return decision;
    const agent = payload?.agent;
    if (agent === undefined || !isDeepPtcSession(ctx, agent.session)) return decision;
    if (typeof ctx.tools.get === 'function' && ctx.tools.get('skill', agent) !== skillTool) return decision;
    try {
      const lookup = await lookupOf(agent, payload.signal);
      const injections = await gestureMessages(payload.messages ?? [], lookup);
      const snapshot = await ctx.skills.snapshot(lookup);
      const incomplete = snapshot.complete === false;
      // A partial discovery must not replace the last complete list: after the conversation closes,
      // the settings page falls back to it, and a provider that missed this request would look uninstalled.
      if (!incomplete) {
        store.remember(snapshot.skills.map(skill => ({ name: skill.name, description: skill.description, source: skill.source,
          provider: skill.provider, modelInvocable: isModelInvocable(skill) })));
      }
      const entries = catalogEntries(snapshot.skills.filter(skill => isModelInvocable(skill)), store.hidden());
      const existing = catalogMessageOf(decision.messages);
      const unchanged = existing !== undefined
        && catalogDigest(existing.entries, existing.incomplete) === catalogDigest(entries, incomplete);
      let messages = injections.length === 0 ? decision.messages : [...decision.messages, ...injections];
      if (!unchanged && (existing !== undefined || entries.length > 0)) {
        const message = userMessage({ content: [{ type: 'text', text: catalogText(entries, { incomplete, update: existing !== undefined }) }],
          source: catalogSource(entries, { incomplete, update: existing !== undefined }) });
        messages = existing === undefined ? [...messages, message] : messages.map(candidate => candidate === existing.message ? message : candidate);
      }
      return messages === decision.messages ? decision : { ...decision, messages };
    } catch (error) {
      ctx.logger?.warn?.('Deep PTC: skill catalog failed (%s)', error.message);
      return decision;
    }
  }), 'Deep PTC: skill catalog');
}