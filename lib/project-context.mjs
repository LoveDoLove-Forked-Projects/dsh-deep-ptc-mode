// Runtime for project cards.
//
// - A global system prompt section shows the workspace's cards to every conversation there, Deep
//   PTC or not. Its text is computed on each model request, so only the latest version is ever in
//   context: an edit withdraws the old text instead of piling a new copy on top of it.
// - A session projection mirrors the cards, proposals and history for the 特点卡片 view.
// - The `deep-ptc-project` command applies the user's edits from that view (Deep PTC only).
// - The `project_cards` tool lets the model read, propose changes to setting cards (the user
//   approves) and write the two cards it owns: implemented features and user requirements.

import { createHash } from 'node:crypto';
import { PROJECT_SKILL_REGISTRATION } from './card-skill.mjs';
import { gated } from './gate.mjs';
import { GUIDE_EVENT, foldGuide, projectGuide } from './project-guide.mjs';
import { importHost } from './host.mjs';
import { CATEGORIES, DEFAULT_TITLES, blankDoc, mergeProposal, MAX_ITEMS, MODEL_KINDS, REQUIREMENT_STATES, diffItems, diffText, promptText, removeCard,
  writeCard } from './project-cards.mjs';
import { createProjectStore } from './project-store.mjs';
import { isDeepPtcSession } from './session-preset.mjs';

export const PROJECT_KEY = 'deepPtcProject';
export const PROJECT_EVENT = 'plugin:dsh-deep-ptc-mode/project';
export const PROJECT_COMMAND = 'deep-ptc-project';
export const PROJECT_TOOL = 'project_cards';
const SECTION = 'deep-ptc:project-cards';
const SECTION_ORDER = 10195;

const cwdOf = session => session?.header?.cwd ?? session?.cwd;
const cardVersion = card => createHash('sha256').update(JSON.stringify(card ?? null)).digest('hex');

export function blankProject() {
  return { v: 1, hash: '', fileVersion: null, path: '', exists: false, cards: [], warnings: [], proposals: [], history: {} };
}

function parseProject(value) {
  if (value === null || typeof value !== 'object' || value.v !== 1 || !Array.isArray(value.cards)) throw new Error('Invalid Deep PTC project state');
  return value;
}

/**
 * @param options - `{ enabled, watch, store }`: the setting getter, its change subscription and an
 *   optional store (tests).
 */
export function apply(ctx, options = {}) {
  const store = options.store ?? createProjectStore();
  const prompt = ctx.plugin({ name: 'deep-ptc-project-prompt', inject: ['systemPrompt'], apply: child => {
    gated(child, options.enabled, options.watch, () => child.systemPrompt.section({
      name: SECTION, order: SECTION_ORDER, text: context => sectionText(ctx, store, context),
    }), 'Deep PTC: project cards prompt');
  } }).await().catch(error => ctx.logger.warn('Deep PTC: project cards are not in the prompt (%s)', error.message));
  const runtime = ctx.plugin({ name: 'deep-ptc-project-layer', inject: ['commands', 'sessionProjections', 'tools'],
    apply: child => install(child, sessionRecords, { ...options, store }) }).await()
    .catch(error => ctx.logger.warn('Deep PTC: the project cards view is off (%s)', error.message));
  const skill = ctx.plugin({ name: 'deep-ptc-project-cards-skill', inject: ['skills'],
    apply: child => gated(child, options.enabled, options.watch, () => child.skills.register(PROJECT_SKILL_REGISTRATION), 'Deep PTC: project cards skill'),
  }).await().catch(error => ctx.logger.warn('Deep PTC: the project cards skill is off (%s)', error.message));
  return Promise.all([prompt, runtime, skill]);
}

/** The prompt text for one model request; never throws, an empty string drops the section. */
export function sectionText(ctx, store, context) {
  try {
    const session = context?.agent?.session;
    const cwd = cwdOf(session);
    if (cwd === undefined) return '';
    const path = store.locate(cwd);
    return promptText(store.read(path)?.doc, { deep: isDeepPtcSession(ctx, session), path: path ?? undefined });
  } catch (error) {
    ctx.logger?.warn?.('Deep PTC: project cards unreadable (%s)', error.message);
    return '';
  }
}

export async function sessionRecords() {
  const { appendPluginRecord } = await importHost('@deepseek-ai/dsh-session');
  if (typeof appendPluginRecord !== 'function') throw new Error('the installed session module has no appendPluginRecord');
  return appendPluginRecord;
}

/** Everything the view shows for one session's workspace. */
function snapshot(store, session) {
  const cwd = cwdOf(session);
  if (typeof cwd !== 'string' || cwd === '') return blankProject();
  const path = store.target(cwd);
  const read = store.read(path, { fresh: true });
  const state = { v: 1, path, fileVersion: read?.version ?? null, exists: read !== undefined, cards: read?.doc.cards ?? [], warnings: read?.warnings ?? [],
    proposals: store.proposals(path), history: store.historyAll(path) };
  state.hash = createHash('sha256').update(JSON.stringify(state)).digest('hex').slice(0, 16);
  return state;
}

export async function install(ctx, records = sessionRecords, options = {}) {
  const store = options.store ?? createProjectStore();
  const appendPluginRecord = await records();
  const schema = { parse: parseProject };
  const projection = await ctx.sessionProjections.register({ key: PROJECT_KEY, stateVersion: 1, stateSchema: schema,
    init: blankProject, apply: (state, event) => {
      if (event.type === GUIDE_EVENT) return foldGuide(state, event);
      if (event.type !== PROJECT_EVENT) return state;
      try { return { ...parseProject(event.data), ...state.guide ? { guide: state.guide } : {} }; } catch { return state; }
    },
    wire: { viewSchema: schema, view: state => state, summary: false } });
  ctx.effect(() => () => projection.dispose());
  // Mirror the workspace into this session when it changed, so the view stays current.
  const publish = async session => {
    const next = snapshot(store, session);
    if (projection.stateOf(session)?.hash !== next.hash) await appendPluginRecord(session, PROJECT_EVENT, next);
    return next;
  };
  const enabled = () => { try { return options.enabled?.() !== false; } catch { return true; } };
  const guide = projectGuide(ctx, projection, appendPluginRecord, publish);
  const api = { ctx, store, publish, enabled, guide };
  projectRuntime.api = api;
  ctx.effect(() => () => { if (projectRuntime.api === api) projectRuntime.api = undefined; });

  ctx.commands.register({ name: PROJECT_COMMAND, recordInput: false,
    description: '编辑项目特点卡片 / Edit project cards',
    handler: ({ agent, rawInput, signal }) => command(api, agent?.session, rawInput, agent, signal) });

  // The tool itself is a Deep PTC preset row (lib/project-tool.mjs), so other modes never see it.
}

const ok = text => ({ kind: 'success', text });
const fail = text => ({ kind: 'error', text });

/** Apply one edit from the 特点卡片 view. Success texts start with `v<rev>` so the view can quote them. */
export async function command(api, session, rawInput, agent, signal) {
  if (!session) return fail('No active conversation. / 当前没有活动对话。');
  if (!api.enabled()) return fail('Project cards are turned off in settings. / 特点卡片已在设置中关闭。');
  if (!isDeepPtcSession(api.ctx, session)) return fail('Project cards are edited in Deep PTC sessions. / 特点卡片只能在深度 PTC 会话中修改。');
  let request;
  try { request = JSON.parse(String(rawInput ?? '')); } catch { return fail('Invalid request. / 无效的请求。'); }
  if (request === null || typeof request !== 'object') return fail('Invalid request. / 无效的请求。');
  if (request.op === 'guide-start' || request.op === 'guide-reply') {
    try {
      await api.guide.handle(agent, request.op, typeof request.message === 'string' ? request.message.slice(0, 8000) : '', signal);
      return ok('accepted');
    } catch (error) { return fail(String(error?.message ?? error)); }
  }
  const { store } = api;
  const cwd = cwdOf(session);
  if (typeof cwd !== 'string' || cwd === '') return fail('No workspace. / 当前没有工作区。');
  const path = store.target(cwd);
  const currentFile = store.read(path, { fresh: true });
  const version = currentFile?.version ?? null;
  const doc = currentFile?.doc ?? blankDoc();
  const stale = async () => {
    await api.publish(session);
    return fail('The project cards file changed. Review the latest cards before applying your draft. / 特点卡片文件已更新，请先查看新内容，再提交草稿。');
  };
  if (['submit', 'delete', 'rollback', 'check'].includes(request.op)
    && (request.baseVersion !== version || request.path !== path)) return stale();
  const conflict = result => fail(result.conflict
    ? 'This card was changed elsewhere; reload and edit again. / 这张卡片已在别处被修改，请刷新后重新编辑。' : result.error);
  const save = (result, previous) => {
    store.write(path, result.doc, version);
    store.remember(path, previous);
  };
  try {
    switch (request.op) {
      case 'refresh':
        await api.publish(session);
        return ok('refreshed');
      case 'check':
        return ok('current');
      case 'submit': {
        const current = doc.cards.find(row => row.id === request.card);
        if (current !== undefined && MODEL_KINDS.includes(current.kind)) return fail('The model maintains this card; question an entry instead. / 这张卡片由模型维护，请对条目提出质疑。');
        const result = writeCard(doc, { id: request.card, kind: 'setting', title: request.title, category: request.category, items: request.items, baseRev: request.baseRev });
        if (result.error) return conflict(result);
        save(result, result.previous);
        await api.publish(session);
        return ok(`v${result.card.rev} · ${result.card.id} · ${diffText(result.diff) || '='}`);
      }
      case 'delete': {
        const result = removeCard(doc, request.card, request.baseRev);
        if (result.error) return conflict(result);
        save(result, result.card);
        await api.publish(session);
        return ok(`deleted · ${result.card.id}`);
      }
      case 'rollback': {
        const version = store.history(path, request.card).find(row => row.rev === request.rev);
        if (version === undefined) return fail('Unknown version. / 未知的版本。');
        const result = writeCard(doc, { id: request.card, title: version.title, category: version.category, items: version.items, baseRev: request.baseRev });
        if (result.error) return conflict(result);
        if (MODEL_KINDS.includes(result.card.kind)) return fail('The model maintains this card. / 这张卡片由模型维护。');
        save(result, result.previous);
        await api.publish(session);
        return ok(`v${result.card.rev} · ${result.card.id} · ${diffText(result.diff) || '='}`);
      }
      case 'approve': {
        const proposal = store.proposals(path).find(row => row.id === request.proposal);
        if (proposal === undefined) return fail('Unknown proposal. / 未知的提案。');
        const prior = doc.cards.find(card => card.id === proposal.card);
        if (proposal.card !== undefined && proposal.baseCardVersion !== cardVersion(prior)) {
          await api.publish(session);
          return fail('The proposed card changed. Ask for an updated proposal. / 原卡片已更新，请让模型重新提案。');
        }
        const result = writeCard(doc, { id: proposal.card, kind: 'setting', title: proposal.title, category: proposal.category, items: proposal.items, baseRev: proposal.baseRev });
        if (result.error) return conflict(result);
        save(result, result.previous);
        store.settle(path, proposal.id);
        await api.publish(session);
        return ok(`v${result.card.rev} · ${result.card.id} · ${diffText(result.diff) || '='}`);
      }
      case 'reject': {
        if (store.settle(path, request.proposal) === undefined) return fail('Unknown proposal. / 未知的提案。');
        await api.publish(session);
        return ok('rejected');
      }
      default:
        return fail('Invalid request. / 无效的请求。');
    }
  } catch (error) {
    if (error.code === 'PROJECT_CARDS_CONFLICT') return stale();
    throw error;
  }
}

/** The runtime the preset row's tool uses; set once the profile-level layer is installed. */
export const projectRuntime = { api: undefined };

/** The project_cards tool, bound to the shared runtime at call time. */
export function projectToolDefinition(runtime = projectRuntime) {
  const definition = toolDefinition(new Proxy({}, { get: (_target, key) => {
    if (runtime.api === undefined) throw new Error('Project cards are not ready yet; try again in a moment');
    return runtime.api[key];
  } }));
  const execute = definition.execute;
  return { ...definition, async execute(args, exec) {
    if (runtime.api === undefined) throw new Error('Project cards are not ready yet; try again in a moment');
    if (!runtime.api.enabled()) throw new Error('Project cards are turned off in settings');
    return execute(args, exec);
  } };
}

function toolDefinition(api) {
  const item = { type: 'object', additionalProperties: false, required: ['text'], properties: {
    id: { type: 'string', description: 'Existing item id to keep (R…, F…, Q…); omit for a new item.' },
    text: { type: 'string', description: 'One precise, self-contained rule or record, up to 500 characters.' },
    status: { type: 'string', enum: REQUIREMENT_STATES, description: 'requirements only.' },
    by: { type: 'string', description: 'requirements only: the Q id that supersedes this one.' },
  } };
  return {
    name: PROJECT_TOOL,
    // Deep PTC's own tool: its full schema stays in the run_code SDK instead of the compact catalog.
    resident: true,
    description: 'Read and maintain the workspace’s settings (user-owned R) and records (F features, Q requirements). Use propose for setting changes and write for records. The user approves proposals in Project cards. Load deep-ptc-project-cards for guidance.',
    parameters: { type: 'object', additionalProperties: false, required: ['action'], properties: {
      action: { type: 'string', enum: ['read', 'propose', 'write'] },
      card: { type: 'string', description: 'propose: id of the existing setting card to change (always pass it when editing a card; omit only for a brand-new card). write: features or requirements.' },
      title: { type: 'string', description: 'Card title (propose; optional for write).' },
      category: { type: 'string', enum: CATEGORIES, description: 'propose: the setting card topic group.' },
      items: { type: 'array', items: item, maxItems: MAX_ITEMS, description: 'propose: only what changes; a reworded item keeps its id, a new item has none, and items you leave out stay as they are. write: the full list, or the new items with mode append.' },
      remove: { type: 'array', items: { type: 'string' }, description: 'propose: ids of existing items to delete from the card.' },
      mode: { type: 'string', enum: ['replace', 'append'], description: 'write only; default replace.' },
      reason: { type: 'string', description: 'propose: why, shown to the user.' },
      baseVersion: { type: ['string', 'null'], description: 'propose: when a polish request supplies a file version, copy it exactly.' },
    } },
    output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const session = exec.agent?.session;
      if (!session) throw new Error('No active conversation');
      if (!isDeepPtcSession(api.ctx, session)) throw new Error('Project cards are edited in Deep PTC sessions only');
      const { store } = api;
      const cwd = cwdOf(session);
      if (typeof cwd !== 'string' || cwd === '') throw new Error('No workspace');
      const path = store.target(cwd);
      const file = store.read(path, { fresh: true });
      const doc = file?.doc ?? blankDoc();
      if (args.action === 'read') {
        return { path, exists: file !== undefined, version: file?.version ?? null, cards: doc.cards, proposals: store.proposals(path) };
      }
      if (args.action === 'propose') {
        if (Object.hasOwn(args, 'baseVersion') && args.baseVersion !== (file?.version ?? null)) {
          throw new Error('The draft is based on an older project cards file. Ask the user to review the latest cards.');
        }
        const current = args.card === undefined ? undefined : doc.cards.find(row => row.id === args.card);
        if (args.card !== undefined && current === undefined) throw new Error(`Unknown card ${args.card}`);
        if (current !== undefined && MODEL_KINDS.includes(current.kind)) throw new Error('Use write for the features and requirements cards');
        const merged = mergeProposal(current, args.items ?? [], args.remove ?? []);
        if (merged.error) throw new Error(merged.error);
        // Dry run: the same checks the approval will apply, so a proposal never fails at approval for its shape.
        const trial = writeCard(doc, { id: current?.id, kind: 'setting', title: args.title, category: args.category, items: merged.items });
        if (trial.error) throw new Error(trial.error);
        const proposal = store.propose(path, { card: current?.id, title: trial.card.title, category: trial.card.category, items: merged.items,
          baseRev: current?.rev, baseCardVersion: cardVersion(current), reason: typeof args.reason === 'string' ? args.reason.trim().slice(0, 300) : '',
          preview: trial.card.items, diff: trial.diff, session: session.id });
        await api.publish(session);
        await api.guide.refreshParent(session);
        return { proposal: proposal.id, status: 'awaiting user approval where setup started (chat or Project cards panel)', diff: diffText(trial.diff) };
      }
      if (args.action === 'write') {
        if (!MODEL_KINDS.includes(args.card)) throw new Error('write takes card features or requirements');
        const current = doc.cards.find(row => row.kind === args.card);
        const items = args.mode === 'append' ? [...current?.items ?? [], ...args.items ?? []] : args.items ?? [];
        const result = writeCard(doc, { id: current?.id, kind: args.card, title: args.title ?? current?.title ?? DEFAULT_TITLES[args.card], items });
        if (result.error) throw new Error(result.error);
        store.write(path, result.doc, file?.version ?? null);
        store.remember(path, result.previous);
        await api.publish(session);
        return { card: result.card.id, rev: result.card.rev, changes: diffText(result.diff) || 'none' };
      }
      throw new Error('action must be read, propose or write');
    },
  };
}

export { diffItems };
