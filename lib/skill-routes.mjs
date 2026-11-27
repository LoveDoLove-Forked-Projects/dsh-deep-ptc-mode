// The plugin's own HTTP route for the skill manager: /deep-ptc/skills/…
//
// The settings page is a web view in the desktop app as well, so it talks to the host here. The list
// prefers a live Deep PTC conversation, whose view merges the preset layer with the host layer; with
// no conversation open it falls back to the newest list the manager recorded, then to the plugin's
// own built-in skills.

import { createSkillStore } from './skill-store.mjs';
import { PLUGIN_SKILLS } from './plugin-skills.mjs';
import { CARD_EXAMPLES_REGISTRATION, CARD_SKILL_REGISTRATION, PROJECT_SKILL_REGISTRATION } from './card-skill.mjs';
import { isDeepPtcSession } from './session-preset.mjs';
import { isModelInvocable } from './skill-render.mjs';

const PREFIX = '/deep-ptc/skills';
const MAX_JSON = 64 * 1024;

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_JSON) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (error) { reject(error); } });
    req.on('error', reject);
  });
}

const rowOf = (skill, modelInvocable) => ({ name: skill.name, description: typeof skill.description === 'string' ? skill.description : '',
  ...typeof skill.whenToUse === 'string' && skill.whenToUse !== '' ? { whenToUse: skill.whenToUse } : {},
  source: typeof skill.source === 'string' ? skill.source : 'custom', provider: typeof skill.provider === 'string' ? skill.provider : '',
  modelInvocable });

/** The plugin's own skills, known even before any Deep PTC conversation has run. */
export function builtinSkills() {
  const rows = [CARD_SKILL_REGISTRATION, CARD_EXAMPLES_REGISTRATION, PROJECT_SKILL_REGISTRATION]
    .map(row => rowOf({ ...row, source: 'plugin', provider: 'dsh-deep-ptc-mode' }, true));
  for (const [id, description] of PLUGIN_SKILLS) rows.push(rowOf({ name: 'deep-ptc-' + id, description, source: 'plugin', provider: 'dsh-deep-ptc-mode' }, true));
  return rows;
}

/** One Deep PTC conversation's merged view, or undefined when none is live. */
async function liveSkills(ctx) {
  const agents = ctx.get?.('agents');
  const skills = ctx.get?.('skills');
  if (typeof agents?.list !== 'function' || typeof skills?.list !== 'function') return undefined;
  const agent = agents.list().find(candidate => candidate?.session && isDeepPtcSession(ctx, candidate.session));
  if (agent === undefined) return undefined;
  try {
    const rows = await skills.list({ scope: agent, cwd: agent.session?.header?.cwd });
    return rows.map(row => rowOf(row, isModelInvocable(row)));
  } catch { return undefined; }
}

function mergeRows(primary, extra) {
  const merged = [...primary];
  const seen = new Set(merged.map(row => row.name));
  for (const row of extra) if (!seen.has(row.name)) { seen.add(row.name); merged.push(row); }
  return merged.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

async function listAll(ctx, store) {
  const live = await liveSkills(ctx);
  if (live !== undefined && live.length > 0) return { skills: mergeRows(live, builtinSkills()), origin: 'live' };
  const known = store.known();
  if (known.length > 0) return { skills: mergeRows(known.map(row => rowOf(row, row.modelInvocable === true)), builtinSkills()), origin: 'cache' };
  return { skills: builtinSkills(), origin: 'builtin' };
}

async function serve(ctx, store, req, res, url) {
  const path = url.pathname.slice(PREFIX.length) || '/';
  if (req.method === 'GET' && path === '/list') {
    const { skills, origin } = await listAll(ctx, store);
    const hidden = store.hidden();
    return json(res, 200, { skills: skills.map(row => ({ ...row, hidden: hidden.includes(row.name) })), hidden, origin });
  }
  if (req.method === 'POST' && path === '/set') {
    let body;
    try { body = await readJson(req); } catch (error) { return json(res, 400, { error: error.message }); }
    try {
      const next = store.setHidden(body?.name, body?.hidden === true);
      return json(res, 200, { name: body.name, hidden: body.hidden === true, hidden: next.hidden });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  return json(res, 404, { error: 'not found' });
}

export function installSkillRoutes(ctx, { logger = ctx.logger, store = createSkillStore() } = {}) {
  const server = ctx.get?.('webServer');
  if (typeof server?.register !== 'function') return () => {};
  const handler = (req, res) => { serve(ctx, store, req, res, new URL(req.url ?? '/', 'http://localhost')).catch(error => {
    logger?.warn?.('Deep PTC: skill route failed (%s)', error.message);
    if (!res.headersSent) json(res, 500, { error: 'skill route failed' });
    else res.destroy();
  }); };
  return server.register({ kind: 'prefix', path: PREFIX, handler });
}

export { PREFIX as SKILL_ROUTE_PREFIX };
