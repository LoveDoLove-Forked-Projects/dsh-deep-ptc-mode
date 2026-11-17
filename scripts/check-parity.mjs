// Compare Deep PTC with the official PTC preset on a real host composition: official dsh-base, the
// official ptc preset and this plugin mounted side by side, in a throwaway home, with no model request.
// Whatever is not a Deep PTC feature must match the official preset, including with third-party plugins
// that know nothing about Deep PTC.
//   PTC_RUNTIME_MODULES=/path/to/dsh/node_modules node scripts/check-parity.mjs
import { registerHooks, createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import path from 'node:path';

const modules = process.env.PTC_RUNTIME_MODULES;
if (!modules) throw new Error('Set PTC_RUNTIME_MODULES to the runtime node_modules directory');
const stage = path.resolve(import.meta.dirname, '..');
const home = mkdtempSync(path.join(tmpdir(), 'deep-ptc-parity-'));
process.env.HOME = home;
process.env.USERPROFILE = home;
process.env.DSH_HOME = path.join(home, '.dsh');

const scenario = process.argv[2] ?? 'plain';
const useWsl = scenario === 'cards-wsl';
const parentURL = pathToFileURL(path.join(modules, '__parity__.mjs')).href;
registerHooks({ resolve(specifier, context, next) {
  if (scenario === 'own-row-fails' && specifier === 'dsh-deep-ptc-mode/guard') throw new Error('simulated: this row cannot load');
  if (specifier === 'dsh-deep-ptc-mode') return next(pathToFileURL(path.join(stage, 'lib/index.mjs')).href, context);
  if (specifier.startsWith('dsh-deep-ptc-mode/')) return next(pathToFileURL(path.join(stage, 'lib', `${specifier.split('/')[1]}.mjs`)).href, context);
  if (specifier.startsWith('@deepseek-ai/')) return next(specifier, { ...context, parentURL });
  return next(specifier, context);
} });
const from = createRequire(path.join(modules, 'package.json'));
const load = name => import(pathToFileURL(from.resolve(name)).href);
const yaml = from('js-yaml');
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', resolve: data => typeof data === 'string', construct: data => ({ __jsExpr: data }) });
const schema = yaml.JSON_SCHEMA.extend(JsExpr);
const declared = file => yaml.load(readFileSync(path.join(modules, file), 'utf8'), { schema });
const fixture = name => pathToFileURL(path.join(stage, 'scripts', 'fixtures', name)).href;

const config = path.join(home, 'cordis.yml');
writeFileSync(config, '[]\n');
const extra = {
  plain: [], cards: [], 'cards-wsl': [], 'tool-overrides': [], 'runtime-update': [], 'own-row-fails': [],
  misbehaving: [{ id: 'misbehaving', name: fixture('misbehaving-plugin.mjs') }],
  'broken-plugin': [{ id: 'broken', name: fixture('broken-plugin.mjs') }],
}[scenario];
assert.ok(extra, `unknown scenario ${scenario}`);
const patches = [
  ...declared('@deepseek-ai/dsh-base/cordis.patch.yml'),
  { insert: [{ id: 'agent-preset-registry', name: '@deepseek-ai/dsh-agent-preset-registry', config: { default: 'ptc' } }] },
  ...declared('@deepseek-ai/dsh-web-app/presets/ptc.patch.yml'),
  { insert: [{ id: 'deep-ptc-settings', name: 'dsh-deep-ptc-mode', config: {
    environment: useWsl ? 'wsl' : process.platform === 'win32' ? 'powershell' : 'bash', wslDistribution: '',
    ...scenario === 'tool-overrides' ? {
      disabledShellTools: [process.platform === 'win32' ? 'pwsh' : 'bash'],
      toolOverrides: [{ tool: 'todo_write', row: 'tool-todo', replacement: 'profile_todo' }],
    } : {},
  } }] },
  ...extra.length ? [{ insert: extra }] : [],
];
let updateFile, updateSource;
if(scenario==='runtime-update'){
 updateSource=readFileSync(path.join(modules,'@deepseek-ai/dsh-web-app/presets/ptc.patch.yml'),'utf8');
 assert.ok(updateSource.includes('applyPatch: false'));
 updateFile=path.join(home,'current-official.patch.yml');writeFileSync(updateFile,updateSource);
 process.env.DSH_DEEP_PTC_PRESET=updateFile;
}
const { boot } = await load('@deepseek-ai/dsh-app-boot');
const ctx = await boot('dsh', config, patches, async host => { host.loader.internal = undefined; }, pathToFileURL(modules + path.sep).href);
await ctx.get('loader')?.await();
const presets = ctx.get('agentPresets');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const inventoryOf = async id => (await presets.compositionInventory()).find(row => row.id === id);
for (let i = 0; i < 200 && (await inventoryOf('deep-ptc')) === undefined; i++) await sleep(25);
if (scenario === 'own-row-fails') for (let i = 0; i < 200 && (await inventoryOf('deep-ptc'))?.broken; i++) await sleep(25);
assert.equal((await inventoryOf('ptc')).broken, undefined, 'the official preset itself must mount');
assert.equal((await inventoryOf('deep-ptc')).broken, undefined, 'Deep PTC must mount');

const view = async id => {
  const lease = await presets.acquireScope(id);
  await sleep(500);
  const assembly = await ctx.systemPrompt.assemble({ scope: lease.key });
  const sdk = assembly.sections.find(section => section.name === 'tools:sdk')?.text ?? '';
  return { scope: lease.key, tools: new Map(ctx.tools.definitions(lease.key).map(tool => [tool.name, tool])), assembly, sdk,
    sections: new Map(assembly.sections.map(section => [section.name, section.text])),
    commands: [...(await ctx.get('commands')?.list?.({ scope: lease.key, ...{} }) ?? [])].map(row => row.name).sort() };
};
const official = await view('ptc');
const globalPluginTools = new Set(['ui_card']);
const {toolDirectory}=await import('../lib/official-names.mjs');
const {parseOfficialPreset}=await import('../lib/upstream.mjs');
const officialRows=[];
const collect=rows=>{for(const row of rows){if(row.group===true)collect(row.config);else officialRows.push({name:row.name,toolName:row.config?.toolName});}};
collect(parseOfficialPreset(readFileSync(path.join(modules,'@deepseek-ai/dsh-web-app/presets/ptc.patch.yml'),'utf8')).plugins);
const attribution=toolDirectory(()=>ctx.get('loader'),{modules:officialRows,base:pathToFileURL(path.join(modules,'package.json')).href});
const missedOfficial=[...official.tools.keys()].filter(name=>!name.startsWith('misbehaving_')&&!globalPluginTools.has(name)&&!attribution.isOfficial(name));
assert.deepEqual(missedOfficial,[],'all tools in the installed official-only composition must be identified as official');

const deep = await view('deep-ptc');
assert.ok(official.tools.has('ui_card') && deep.tools.has('ui_card'), 'conversation cards are profile-wide');
assert.ok(!official.tools.has('project_cards'), 'project cards are scoped to Deep PTC');
const names = tools => [...tools.keys()].sort();
const inSdk = (side, name) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\b`, 'u').test(side.sdk);

if (scenario === 'tool-overrides') {
  const shell = process.platform === 'win32' ? 'pwsh' : 'bash';
  assert.ok(official.tools.has(shell), 'the official scope keeps its shell');
  assert.ok(!deep.tools.has(shell) && !inSdk(deep, shell), 'the inherited shell is hidden in Deep PTC too');
  assert.ok(official.tools.has('todo_write') && !deep.tools.has('todo_write'), 'a non-shell row and its inherited tool can be replaced');
  assert.match(deep.sections.get('deep-ptc:tool-overrides'), /profile_todo.*unavailable/u);
  const remove = ctx.tools.register({
    name: 'profile_todo', description: 'Test replacement supplied by a profile plugin',
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: () => 'test replacement',
  });
  try {
    const updated = await view('deep-ptc');
    assert.ok(updated.tools.has('profile_todo'));
    assert.match(updated.sections.get('deep-ptc:tool-overrides'), /Use .profile_todo./u);
    assert.ok(!updated.tools.has('todo_write'));
  } finally {
    remove();
  }
  console.log('ok  scoped shell opt-out and non-shell replacement, including a provider loaded later');
  process.exit(0);
}

if (scenario === 'cards' || useWsl) {
  const { CARD_COMMAND, CARD_TOOL } = await import('../lib/cards.mjs');
  const { PROJECT_COMMAND, PROJECT_TOOL } = await import('../lib/project-context.mjs');
  const { setSandboxMode } = await load('@deepseek-ai/dsh-sandbox-policy');
  const { agent, dispose } = await ctx.agents.create({
    sessionId: 'deep-ptc-card-host-check',
    meta: { cwd: home, agentPreset: 'deep-ptc' },
    setup: async agentCtx => { await presets.mount(agentCtx, 'deep-ptc'); },
  });
  try {
    const signal = AbortSignal.timeout(30_000);
    const run = async (name, payload) => (await ctx.commands.execute(agent, `/${name} ${JSON.stringify(payload)}`, [], signal)).result;
    const tool = ctx.tools.get(CARD_TOOL, agent);
    const expectedShell = useWsl || process.platform !== 'win32' ? 'bash' : 'pwsh';
    const command = useWsl ? 'test -n "$WSL_DISTRO_NAME"' : expectedShell === 'pwsh'
      ? 'if (-not $PSVersionTable.PSVersion) { exit 1 }' : 'test -n "$BASH_VERSION"';
    const show = () => tool.execute({ action: 'show', id: 'shell', title: 'Host check', note: 'Verify the active shell',
      actions: [{ id: 'check', label: 'Check shell', run: { command } }] }, { agent });
    const press = async () => {
      const { revision } = await show();
      return run(CARD_COMMAND, { id: 'shell', revision, action: 'act', key: 'check' });
    };
    setSandboxMode(agent.session, 'danger-full-access');
    const guard = ctx.tools.guard(exec => exec.agent === agent && exec.name === expectedShell ? 'host test guard denied' : undefined);
    try { assert.match((await press()).text, /host test guard denied/u); }
    finally { guard(); }
    if (useWsl) {
      setSandboxMode(agent.session, 'read-only');
      assert.match((await press()).text, /confined Windows sandbox/u);
      setSandboxMode(agent.session, 'danger-full-access');
    }
    const shellResult = await press();
    assert.equal(shellResult.kind, 'success', shellResult.text);

    const cardsFile = path.join(home, 'PROJECT-CARDS.md');
    const submit = await run(PROJECT_COMMAND, { op: 'submit', path: cardsFile, baseVersion: null, title: 'Rules', items: ['Use the test workspace'] });
    assert.equal(submit.kind, 'success', submit.text);
    const project = ctx.tools.get(PROJECT_TOOL, agent);
    const { proposal } = await project.execute({ action: 'propose', card: 'rules', items: [{ id: 'R1', text: 'Use the isolated test workspace' }] }, { agent });
    assert.equal((await run(PROJECT_COMMAND, { op: 'approve', proposal })).kind, 'success');
    assert.match(readFileSync(cardsFile, 'utf8'), /Use the isolated test workspace/u);
    console.log(`ok  real host card command (${useWsl ? 'WSL' : expectedShell}), host policy denial, and project proposal approval`);
  } finally {
    await dispose();
  }
  process.exit(0);
}

if (scenario === 'own-row-fails') {
  assert.deepEqual(names(deep.tools), names(official.tools), 'safe mode offers the official tools');
  assert.ok(!deep.tools.has('deep_ptc_tools'));
  console.log('ok  a Deep PTC row that cannot load: safe mode with the official tools');
  process.exit(0);
}

assert.ok(deep.tools.has('project_cards'), 'the Deep PTC scope registers its project tool');
const features = new Set(['deep_ptc_tools', 'project_cards']);
const featureTools = new Set(['ask_user_question']);
const externals = names(official.tools).filter(name => name.startsWith('misbehaving_'));
assert.deepEqual(names(official.tools).filter(name => !deep.tools.has(name)), [], 'no official tool is missing');
assert.deepEqual(names(deep.tools).filter(name => !official.tools.has(name) && !features.has(name)), [], 'no unexpected tool is added');
for (const name of names(official.tools)) {
  if (featureTools.has(name)) continue;
  const left = official.tools.get(name);
  const right = deep.tools.get(name);
  assert.deepEqual(right.parameters, left.parameters, `${name} keeps its official parameters`);
  // The shell tool's description stays official too; only its executor differs.
  assert.equal(right.description, left.description, `${name} keeps its official description`);
}
const hidden = names(deep.tools).filter(name => inSdk(official, name) && !inSdk(deep, name));
assert.deepEqual(hidden.filter(name => !externals.includes(name)), [], 'official tools stay in the SDK');
const persona = /^persona|^deep-ptc:|^tools:sdk$|^system-prompt:persona/u;
const changed = [...official.sections].filter(([name, text]) => !persona.test(name) && deep.sections.has(name) && deep.sections.get(name) !== text).map(([name]) => name);
const missing = [...official.sections.keys()].filter(name => !deep.sections.has(name));
assert.deepEqual(missing, [], 'no official prompt section is lost');
console.log(`ok  ${names(official.tools).length} shared tools: same names, parameters and descriptions except ${[...featureTools]}`);
console.log(`ok  shared tools present in the SDK; prompt sections differing: ${JSON.stringify(changed)}`);
if (scenario === 'misbehaving') {
  assert.deepEqual(hidden.sort(), externals, 'third-party tools are on demand');
  assert.ok(deep.sections.has('misbehaving:note'), 'the plugin\'s own prompt section is kept');
  assert.ok(deep.sdk.length < official.sdk.length, 'on-demand tools shrink the SDK');
  console.log(`ok  third-party tools on demand; SDK ${official.sdk.length} -> ${deep.sdk.length} chars`);
}
if(scenario==='runtime-update'){
 assert.equal(deep.tools.has('apply_patch'),false);
 writeFileSync(updateFile,updateSource.replace('applyPatch: false','applyPatch: true'));
 await presets.resolve('deep-ptc');
 const updated = await view('deep-ptc');
 assert.ok(updated.tools.has('apply_patch'),'detect changed installed declarations and publish the new tools automatically');
 assert.equal(deep.tools.has('apply_patch'),false,'leased old generations remain unchanged');
 console.log('ok  installed declaration changed: new apply_patch capability detected automatically; old scope retained');
}
process.exit(0);
