import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_FILE, blankDoc, mergeProposal, ordered, diffItems, parseDoc, promptCards, promptText, removeCard, serializeDoc, writeCard } from '../lib/project-cards.mjs';
import { createProjectStore } from '../lib/project-store.mjs';
import { cardsContextText, command, install, projectToolDefinition, sectionText, PROJECT_COMMAND, PROJECT_TOOL } from '../lib/project-context.mjs';
import { apply as applyProjectTool } from '../lib/project-tool.mjs';
import { deriveDeepPtc } from '../lib/model.mjs';
import snapshot from '../lib/preset.json' with { type: 'json' };
import { foldGuide } from '../lib/project-guide.mjs';

const at = '2026-11-17T12:00:00.000Z';

test('guide progress text retains running status until the host ends its turn', () => {
  const fold = (state, kind, text) => foldGuide(state, { data: { childId: 'guide', kind, text } });
  let state = fold({}, 'start');
  assert.equal(fold(state, 'assistant', 'Reading the project').guide.pending, true);
  state = fold(state, 'idle');
  assert.equal(fold(state, 'user', 'Continue').guide.pending, false);
  state = fold(state, 'running');
  assert.equal(state.guide.pending, true);
  assert.equal(fold(state, 'reset').guide, undefined);
});

test('competing proposals stay independent, can rebase and require fresh approval', async () => {
  const { project, store } = workspace();
  const host = fakeHost();
  await install(host.ctx, host.records, { store });
  const path = store.target(project);
  const session = { id: 'main', header: { cwd: project } };
  const run = payload => host.handlers.get(PROJECT_COMMAND)({ agent: { session }, rawInput: JSON.stringify(payload) });
  await run({ op: 'submit', path, baseVersion: null, title: 'Runtime', items: ['Old A', 'Old B'] });
  const propose = (id, item, text) => projectToolDefinition().execute({
    action: 'propose', card: 'runtime', items: [{ id: item, text }],
  }, { agent: { session: { ...session, id } } });
  const a = await propose('main', 'R1', 'New A');
  const b = await propose('assistant', 'R2', 'New B');
  assert.equal(store.proposals(path).length, 2);
  assert.equal((await run({ op: 'approve', proposal: a.proposal })).kind, 'success');
  assert.equal((await run({ op: 'approve', proposal: b.proposal })).kind, 'error');
  assert.equal((await run({ op: 'rebase', proposal: b.proposal })).kind, 'success');
  assert.equal((await run({ op: 'approve', proposal: b.proposal })).kind, 'error');
  assert.equal((await run({ op: 'approve', proposal: store.proposals(path)[0].id })).kind, 'success');
  assert.deepEqual(store.read(path).doc.cards[0].items.map(item => item.text), ['New A', 'New B']);
});

test('another conversation sees project setup progress, pending drafts and user deferral', async () => {
  const { project, store } = workspace();
  const host = fakeHost();
  await install(host.ctx, host.records, { store });
  const first = { session: { id: 'one', header: { cwd: project } } };
  const second = { session: { id: 'two', header: { cwd: project } } };
  const tool = projectToolDefinition();
  // The setup state rides in the snapshot; the system prompt rules never change with it.
  const rules = sectionText(host.ctx, store, { agent: second });
  const instruction = () => { assert.equal(sectionText(host.ctx, store, { agent: second }), rules); return cardsContextText(host.ctx, store, { agent: second }); };
  await tool.execute({ action: 'setup', status: 'guiding', summary: 'Which runtime?' }, { agent: first });
  assert.match(instruction(), /already underway/u);
  assert.equal((await tool.execute({ action: 'read' }, { agent: second })).setup.summary, 'Which runtime?');
  await tool.execute({ action: 'propose', title: 'Runtime', items: ['Node'] }, { agent: first });
  assert.match(instruction(), /pending setting proposals/u);
  await tool.execute({ action: 'setup', status: 'deferred' }, { agent: second });
  assert.match(instruction(), /user deferred/u);
  assert.equal((await tool.execute({ action: 'read' }, { agent: second })).proposals.length, 1);
});

function sampleDoc() {
  let doc = blankDoc();
  doc = writeCard(doc, { title: '技术栈', items: ['前端 React 18 + Vite', { text: '  测试用 node:test  ' }] }, at).doc;
  doc = writeCard(doc, { kind: 'features', items: ['对话卡片接口'] }, at).doc;
  doc = writeCard(doc, { kind: 'requirements', items: [{ text: '版本号 1.9.9' }, { text: '旧要求', status: 'superseded', by: 'Q1' }] }, at).doc;
  return doc;
}

test('the file round-trips and stays readable Markdown', () => {
  const doc = sampleDoc();
  const text = serializeDoc(doc);
  assert.match(text, /^<!-- deep-ptc:project-cards v1 next=R3,F2,Q3 -->/u);
  assert.match(text, /## 技术栈\n<!-- card id=c1 kind=setting category=other rev=1 updated=2026-11-17T12:00:00.000Z -->\n\n- \*\*R1\*\* 前端 React 18 \+ Vite\n- \*\*R2\*\* 测试用 node:test/u);
  assert.match(text, /- \*\*Q2\*\* \[superseded by Q1\] 旧要求/u);
  const { doc: back, warnings } = parseDoc(text);
  assert.deepEqual(back, doc);
  assert.deepEqual(warnings, []);
  // A hand edit with stray lines keeps the cards and reports the rest.
  const edited = parseDoc(`${text}\nrandom note\n- **R9** orphan`);
  assert.equal(edited.doc.cards.length, 3);
  assert.equal(edited.warnings.length, 2, "a stray note and an orphan item are both reported");
});

test('ids are stable, never reused, and cannot be claimed', () => {
  let doc = sampleDoc();
  const card = doc.cards[0];
  const edit = writeCard(doc, { id: card.id, items: [{ id: 'R2', text: '测试用 node:test，覆盖率 80%' }, { text: '新规则' }, { id: 'R77', text: '伪造 id' }], baseRev: 1 }, at);
  assert.deepEqual(edit.card.items.map(item => item.id), ['R2', 'R3', 'R4']);
  assert.deepEqual(edit.diff, { added: ['R3', 'R4'], removed: ['R1'], changed: ['R2'] });
  doc = edit.doc;
  assert.equal(writeCard(doc, { id: card.id, items: ['x'] }).card.items[0].id, 'R5', 'deleted R1 is not reused');
  assert.equal(writeCard(doc, { id: card.id, items: ['x'], baseRev: 1 }).conflict, true, 'a stale edit is refused');
  assert.match(removeCard(doc, 'features').error, /model/u);
  assert.equal(removeCard(doc, card.id).doc.cards.length, 2);
  assert.deepEqual(diffItems([{ id: 'R1', text: 'a' }], [{ id: 'R1', text: 'a' }]), { added: [], removed: [], changed: [] });
});

test('the prompt carries only the latest version, with editing rights by mode', () => {
  const doc = sampleDoc();
  const deep = promptText(doc, { deep: true, path: 'D:\\p\\PROJECT-CARDS.md' });
  assert.match(deep, /Only the newest snapshot applies/u);
  assert.match(deep, /project_cards propose/u);
  assert.match(deep, /retest affected behavior/u);
  assert.match(deep, /- \*\*R1\*\* 前端 React 18/u);
  const plain = promptText(doc, { deep: false });
  assert.match(plain, /read-only/u);
  assert.doesNotMatch(plain, /project_cards propose/u);
  assert.equal(promptText(undefined, { deep: false }), '', 'nothing for other modes without cards');
  assert.match(promptText(undefined, { deep: true }), /first visible reply, even on a small task/u);
  assert.match(promptText({ cards: doc.cards.filter(card => card.kind === 'features') }, { deep: true }), /Start setup yourself/u);
  assert.doesNotMatch(deep, /Start setup yourself/u);
});

function workspace() {
  const root = mkdtempSync(join(tmpdir(), 'dpt-project-'));
  const project = join(root, 'repo');
  mkdirSync(join(project, 'src'), { recursive: true });
  return { root, project, store: createProjectStore({ sidecar: join(root, 'dsh', 'storages', 'books.json') }) };
}

test('the store finds the file above a subfolder and keeps history outside the repo', () => {
  const { root, project, store } = workspace();
  assert.equal(store.locate(join(project, 'src')), undefined);
  assert.equal(store.target(join(project, 'src')), join(project, 'src', PROJECT_FILE));
  writeFileSync(join(project, PROJECT_FILE), serializeDoc(sampleDoc()));
  const path = store.locate(join(project, 'src'));
  assert.equal(path, join(project, PROJECT_FILE));
  const first = store.read(path);
  assert.equal(store.read(path), first, 'cached while unchanged');
  store.remember(path, first.doc.cards[0]);
  assert.equal(store.history(path, 'c1')[0].rev, 1);
  assert.ok(readFileSync(join(root, 'dsh', 'storages', 'books.json'), 'utf8').includes('"history"'));
  const proposal = store.propose(path, { card: 'card', items: [] });
  assert.equal(proposal.id, 'P1');
  assert.equal(store.propose(path, { card: 'card', items: ['x'] }).id, 'P2');
  assert.equal(store.proposals(path).length, 1, 'a newer proposal for the same card replaces the older one');
});

function fakeHost(deep = true) {
  const state = new Map();
  const handlers = new Map();
  const tools = new Map();
  const ctx = {
    logger: { warn() {} }, effect(register) { const dispose = register(); return () => dispose?.(); },
    get: name => name === 'agentPresets' ? { presetForSession: () => deep ? 'deep-ptc' : 'standard' } : undefined,
    sessionProjections: { async register(definition) { return { stateOf: session => state.get(session), dispose() {} }; } },
    commands: { register(definition) { handlers.set(definition.name, definition.handler); } },
    tools: { register(definition) { tools.set(definition.name, definition); return () => tools.delete(definition.name); } },
  };
  const records = async () => (session, _type, value) => { JSON.stringify(value); state.set(session, value); };
  return { ctx, state, handlers, tools, records };
}

test('the user edits setting cards; the model proposes and the user approves', async () => {
  const { project, store } = workspace();
  const host = fakeHost();
  await install(host.ctx, host.records, { store });
  const session = { id: 's1', header: { cwd: project } };
  const run = payload => {
    const path = store.target(project);
    const baseVersion = host.state.get(session)?.fileVersion ?? null;
    return host.handlers.get(PROJECT_COMMAND)({ agent: { session }, rawInput: JSON.stringify({ path, baseVersion, ...payload }) });
  };

  const created = await run({ op: 'submit', title: '代码规范', items: ['用两个空格缩进'] });
  assert.equal(created.kind, 'success');
  assert.match(created.text, /^v1 · /u);
  assert.match(readFileSync(join(project, PROJECT_FILE), 'utf8'), /\*\*R1\*\* 用两个空格缩进/u);
  const id = host.state.get(session).cards[0].id;

  const tool = projectToolDefinition();
  await assert.rejects(() => tool.execute({ action: 'write', card: 'card', items: [] }, { agent: { session } }), /features or requirements/u);
  const proposed = await tool.execute({ action: 'propose', card: id, items: [{ id: 'R1', text: '使用两个空格缩进，禁止 Tab。' }], reason: '润色' }, { agent: { session } });
  assert.equal(host.tools.has(PROJECT_TOOL), false, 'the tool is not registered profile-wide');
  assert.equal(proposed.proposal, 'P1');
  assert.equal(host.state.get(session).proposals.length, 1);
  assert.match(readFileSync(join(project, PROJECT_FILE), 'utf8'), /用两个空格缩进$/mu, 'nothing changes before approval');

  const approved = await run({ op: 'approve', proposal: 'P1' });
  assert.match(approved.text, /^v2 · .* ~R1$/u);
  assert.match(readFileSync(join(project, PROJECT_FILE), 'utf8'), /禁止 Tab/u);
  assert.equal(host.state.get(session).proposals.length, 0);
  assert.equal(host.state.get(session).history[id][0].rev, 1, 'the previous version is kept');

  const rolled = await run({ op: 'rollback', card: id, rev: 1, baseRev: 2 });
  assert.match(rolled.text, /^v3 /u);
  assert.equal((await run({ op: 'submit', card: id, items: ['x'], baseRev: 2 })).kind, 'error', 'stale edits are refused');

  // The model's own cards: written directly, never edited from the view.
  const written = await tool.execute({ action: 'write', card: 'features', items: [{ text: '特点卡片视图' }] }, { agent: { session } });
  assert.equal(written.rev, 1);
  await tool.execute({ action: 'write', card: 'features', mode: 'append', items: [{ text: '润色提交' }] }, { agent: { session } });
  const features = host.state.get(session).cards.find(card => card.kind === 'features');
  assert.deepEqual(features.items.map(item => item.id), ['F1', 'F2']);
  assert.equal((await run({ op: 'submit', card: 'features', items: ['hack'], baseRev: 2 })).kind, 'error');
  assert.equal((await run({ op: 'delete', card: 'features' })).kind, 'error');
});

test('every conversation in the workspace reads the cards; only Deep PTC edits them', async () => {
  const { project, store } = workspace();
  writeFileSync(join(project, PROJECT_FILE), serializeDoc(sampleDoc()));
  const plain = fakeHost(false);
  const context = { agent: { session: { id: 'x', header: { cwd: join(project, 'src') } } } };
  assert.match(sectionText(plain.ctx, store, context), /read-only/u);
  assert.match(sectionText(fakeHost(true).ctx, store, context), /project_cards propose/u);
  assert.equal(sectionText(plain.ctx, store, { agent: { session: { header: { cwd: tmpdir() } } } }), '');
  const refused = await command({ ctx: plain.ctx, store, publish: async () => {}, enabled: () => true }, context.agent.session, '{"op":"refresh"}');
  assert.equal(refused.kind, 'error');
  const off = await command({ ctx: fakeHost(true).ctx, store, publish: async () => {}, enabled: () => false }, context.agent.session, '{"op":"refresh"}');
  assert.match(off.text, /turned off/u);
});

test('external edits invalidate old drafts and proposals without removing surrounding Markdown', async () => {
  const { project, store } = workspace();
  const host = fakeHost();
  await install(host.ctx, host.records, { store });
  const session = { id: 'external-edit', header: { cwd: project } };
  const path = store.target(project);
  const run = request => host.handlers.get(PROJECT_COMMAND)({ agent: { session }, rawInput: JSON.stringify({ path, ...request }) });
  writeFileSync(path, serializeDoc(sampleDoc()), 'utf8');
  await run({ op: 'refresh' });
  const original = host.state.get(session);
  const card = original.cards.find(row => row.kind === 'setting');
  const draft = { op: 'submit', card: card.id, baseRev: card.rev, baseVersion: original.fileVersion, items: [{ id: 'R1', text: 'Draft' }] };
  const proposal = await projectToolDefinition().execute({ action: 'propose', card: card.id, items: [{ id: 'R1', text: 'Proposal' }] }, { agent: { session } });
  const external = readFileSync(path, 'utf8').replace('- **R1** 前端 React 18 + Vite', '> Keep this note.\n- **R1** External edit');
  writeFileSync(path, external, 'utf8');

  assert.match((await run(draft)).text, /file changed/u);
  assert.match((await run({ op: 'approve', proposal: proposal.proposal })).text, /card changed/u);
  assert.equal(readFileSync(path, 'utf8'), external);
  const latest = host.state.get(session);
  assert.equal((await run({ ...draft, baseVersion: latest.fileVersion })).kind, 'success');
  assert.match(readFileSync(path, 'utf8'), /> Keep this note\.\n- \*\*R1\*\* Draft/u);
});

test('the tool is a Deep PTC preset row and honours the settings switch', async () => {
  const { project, store } = workspace();
  const host = fakeHost();
  let on = true;
  await install(host.ctx, host.records, { store, enabled: () => on });
  const rows = options => deriveDeepPtc(snapshot, { environment: 'powershell', ...options }, 'win32').preset.plugins.map(row => row.name);
  assert.ok(rows({}).includes('dsh-deep-ptc-mode/project-tool'));
  assert.ok(!rows({ projectCards: false }).includes('dsh-deep-ptc-mode/project-tool'), 'off in settings: not in new sessions');
  assert.ok(!rows({ safeMode: true }).includes('dsh-deep-ptc-mode/project-tool'));
  const registered = new Map();
  applyProjectTool({ effect: fn => fn(), tools: { register: definition => { registered.set(definition.name, definition); return () => {}; } } });
  const tool = registered.get(PROJECT_TOOL);
  assert.equal(tool.resident, true, 'the project tool keeps its schema in the PTC SDK');
  const session = { id: 's9', header: { cwd: project } };
  assert.deepEqual((await tool.execute({ action: 'read' }, { agent: { session } })).cards, []);
  on = false;
  await assert.rejects(() => tool.execute({ action: 'read' }, { agent: { session } }), /turned off/u);
});

test('a proposal carries only changes; omitted items stay and removals are explicit', () => {
  const card = { id: 'c1', items: [{ id: 'R1', text: 'a' }, { id: 'R2', text: 'b' }, { id: 'R3', text: 'c' }] };
  assert.deepEqual(mergeProposal(card, [{ id: 'R2', text: 'B' }, { text: 'd' }], ['R3']).items,
    [{ id: 'R1', text: 'a' }, { id: 'R2', text: 'B' }, { text: 'd' }]);
  assert.deepEqual(mergeProposal(card, []).items, card.items, 'nothing sent, nothing lost');
  assert.match(mergeProposal(card, [], ['R9']).error, /R9/u);
  assert.match(mergeProposal(card, [{ id: 'R1', text: 'x' }], ['R1']).error, /both/u);
  assert.match(mergeProposal(undefined, [], ['R1']).error, /existing/u);
  assert.deepEqual(mergeProposal(undefined, [{ text: 'new' }]).items, [{ text: 'new' }]);
});

test('setting cards group by category, ahead of the model records, in the file and the prompt', () => {
  let doc = sampleDoc();
  doc = writeCard(doc, { title: '禁止事项', category: 'constraints', items: ['不改公共 API'] }, at).doc;
  doc = writeCard(doc, { title: 'Stack', category: 'stack', items: ['Node 24'] }, at).doc;
  assert.deepEqual(ordered(doc.cards).map(card => card.title), ['Stack', '禁止事项', '技术栈', 'Implemented features / 已实现功能', 'User requirements / 用户要求']);
  assert.equal(writeCard(doc, { id: 'stack', items: ['Node 24'] }).card.category, 'stack', 'an edit keeps the category');
  assert.equal(writeCard(doc, { title: 'x', category: 'weird', items: ['y'] }).card.category, 'other');
  const back = parseDoc(serializeDoc(doc)).doc;
  assert.deepEqual(back.cards.map(card => card.category), ['stack', 'constraints', 'other', undefined, undefined]);
  const text = promptText(doc, { deep: true });
  assert.ok(text.indexOf('## Settings: Stack and environment') < text.indexOf('## Settings: Constraints'));
  assert.ok(text.indexOf('## Settings: Other') < text.indexOf('## Records kept by Deep PTC'));
});

test('an oversized prompt leaves out whole cards, settings first, and names the rest', () => {
  let doc = blankDoc();
  const long = n => Array.from({ length: 12 }, (_, index) => `${n} rule ${index} ${'x'.repeat(400)}`);
  for (let index = 0; index < 6; index++) doc = writeCard(doc, { title: `Rules ${index}`, category: 'code', items: long(index) }).doc;
  doc = writeCard(doc, { kind: 'features', items: ['records come last'] }).doc;
  const text = promptCards(doc, { deep: true });
  assert.ok(text.length <= 16_000);
  assert.match(text, /### Rules 0 \(rules-0, setting/u, 'the first setting card is kept');
  assert.match(text, /more card\(s\) not shown here: .*\(features\)\. Read them with project_cards read/u);
  for (const block of text.split('\n### ').slice(1, -1)) {
    if (block.startsWith('Rules')) assert.equal(block.split('\n').filter(row => /rule \d+/u.test(row)).length, 12, 'no card is cut in half');
  }
});

test('long omitted titles and ids fit in the project snapshot budget', () => {
  let doc = blankDoc();
  for (let i = 0; i < 45; i++) {
    doc = writeCard(doc, { title: 'Rules ' + String(i).padStart(2, '0') + ' ' + 'a'.repeat(48),
      items: Array.from({ length: 10 }, (_, j) => 'item ' + j + ' ' + 'x'.repeat(465)) }).doc;
  }
  const snapshot = promptCards(doc, { deep: true });
  assert.ok(snapshot.length <= 16_000);
  assert.ok(promptCards(doc, { deep: true, path: 'x'.repeat(20_000) }).length <= 16_000);
  assert.match(snapshot, /and \d+ more\. Read them with project_cards read/u);
});

test('the server tells the model about the user\'s edits in a structured form; the rules stay cached', async () => {
  const { project, store } = workspace();
  const host = fakeHost();
  await install(host.ctx, host.records, { store });
  const delivered = [];
  const session = { id: 'n1', header: { cwd: project } };
  const agent = { session, steer: message => delivered.push(message) };
  const run = payload => host.handlers.get(PROJECT_COMMAND)({ agent,
    rawInput: JSON.stringify({ serverNotice: true, path: store.target(project), baseVersion: host.state.get(session)?.fileVersion ?? null, ...payload }) });
  const context = { agent };

  const created = await run({ op: 'submit', title: '代码规范', category: 'conventions', items: ['用两个空格缩进'] });
  assert.match(created.text, /^\[dpt:notified\] v1 · /u, 'the code tells the view the model already knows');
  const notice = delivered.at(-1);
  assert.equal(notice.source.kind, 'deep-ptc-project');
  assert.equal(notice.source.form, 'notice');
  assert.match(notice.content[0].text, /^\[Project cards: the user created setting card \S+ «代码规范», rev 1: \+R1\]$/mu);
  assert.doesNotMatch(notice.content[0].text, /用两个空格缩进/u, 'the notice names ids; the cards live in the snapshot');

  const rules = sectionText(host.ctx, store, context);
  const tool = projectToolDefinition();
  await tool.execute({ action: 'write', card: 'features', items: [{ text: '特点卡片视图' }] }, { agent });
  assert.equal(sectionText(host.ctx, store, context), rules, 'a model write leaves the system prompt unchanged');
  assert.match(cardsContextText(host.ctx, store, context), /^# Project cards \(.*\) — current version[\s\S]*- \*\*F1\*\* 特点卡片视图/mu);

  const asked = await run({ op: 'question', card: 'features', item: 'F1', question: '这个视图真的实现了吗？' });
  assert.match(asked.text, /^\[dpt:notified\]/u);
  assert.match(delivered.at(-1).content[0].text, /the user questions F1 in features card features[\s\S]*Question: «这个视图真的实现了吗？»/u);

  const guide = await run({ op: 'ask', kind: 'guide-more' });
  assert.match(guide.text, /^\[dpt:notified\]/u);
  assert.match(delivered.at(-1).content[0].text, /^\[Project cards: the user asks you to help refine the project cards\]/u);

  const id = host.state.get(session).cards.find(card => card.kind === 'setting').id;
  await tool.execute({ action: 'propose', card: id, items: [{ id: 'R1', text: '用两个空格缩进，禁止 Tab' }] }, { agent });
  assert.doesNotMatch(delivered.at(-1).content[0].text, /ask_user/u, 'setup follows the active question tool');
  const rejected = await run({ op: 'reject', proposal: 'P1' });
  assert.match(rejected.text, /^\[dpt:notified\] rejected/u);
  assert.match(delivered.at(-1).content[0].text, /rejected proposal P1 for «代码规范»[\s\S]*Do not re-propose it unchanged/u);

  // Without a steerable agent nothing is delivered and the plain text lets the view send its message.
  const plain = await host.handlers.get(PROJECT_COMMAND)({ agent: { session }, rawInput: JSON.stringify({ op: 'ask', kind: 'guide-first' }) });
  assert.equal(plain.text, 'asked');
  const count = delivered.length;
  const legacy = await run({ op: 'ask', kind: 'guide-first', serverNotice: false });
  assert.equal(legacy.text, 'asked');
  assert.equal(delivered.length, count, 'a cached client supplies its own message');
});

test('project cards and conversation cards are not capped at a small number', () => {
  let doc = blankDoc();
  for (let index = 0; index < 120; index++) {
    const result = writeCard(doc, { title: `Card ${index}`, items: [`rule ${index}`] });
    assert.equal(result.error, undefined, `card ${index}`);
    doc = result.doc;
  }
  assert.equal(doc.cards.length, 120);
});
