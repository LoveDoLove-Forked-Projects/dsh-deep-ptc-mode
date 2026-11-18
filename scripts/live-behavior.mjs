import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { blankDoc, serializeDoc, writeCard } from '../lib/project-cards.mjs';

export async function runBehaviorCases(ctx, presets, root, { createUserMessage }) {
  const cases = {
    setup: '帮我看看这个仓库。',
    investigation: '定位 scores.mjs 的均值计算为什么在空输入时出错。检查源码、运行脚本并验证一个普通输入和空输入，汇报证据。请勿修改文件。',
    display: '把 stats.json 中三个版本的性能结果展示给我，并说明哪个版本最快。',
    choice: '这个项目的导出格式要在 CSV 和 JSON 里选一个。它既给分析师用也给别的程序用，我还没决定，请让我选。',
    regression: '请修改 mean，使空数组返回 0，并验证这次修改。',
  };
  async function run([id, prompt]) {
    const cwd = path.join(root, id);
    mkdirSync(cwd);
    writeFileSync(path.join(cwd, 'README.md'), '# Score analysis\nNode.js application for a mathematics lab.\n');
    writeFileSync(path.join(cwd, 'scores.mjs'), 'export const mean = xs => xs.reduce((a,b) => a+b) / xs.length;\n');
    writeFileSync(path.join(cwd, 'stats.json'), JSON.stringify({ metric: 'latency_ms', v1: 48, v2: 35, v3: 29 }));
    if (id !== 'setup') {
      let doc = writeCard(blankDoc(), { title: 'Runtime', items: ['Use Node 24'] }).doc;
      if (id === 'regression') doc = writeCard(doc, { kind: 'features', items: ['scores.mjs mean returns the arithmetic mean for non-empty arrays. Verify mean([1,2,3]) === 2.'] }).doc;
      writeFileSync(path.join(cwd, 'PROJECT-CARDS.md'), serializeDoc(doc));
    }
    const { agent, dispose } = await ctx.agents.create({ sessionId: 'evaluation-' + id,
      meta: { cwd, agentPreset: 'deep-ptc' }, agentOptions: { provider: 'deepseek-account', model: 'deepseek-flash', reasoningEffort: 'high' },
      setup: async agentCtx => { await presets.mount(agentCtx, 'deep-ptc'); } });
    const started = Date.now();
    const texts = [], calls = [];
    let reason, timeout = false;
    const off = ctx.on('session/event', (session, event) => {
      if (session !== agent.session) return;
      if (event.type === 'turn/end') reason = event.data.reason;
      if (event.type !== 'assistant/message') return;
      for (const block of event.data.message.content) {
        if (block.type === 'text' && block.text.trim()) texts.push({ ms: Date.now() - started, text: block.text.slice(0, 360) });
        if (block.type === 'tool-call') calls.push(block.name);
      }
    });
    const timer = setTimeout(() => { timeout = true; agent.cancel({ kind: 'user' }); }, 210000);
    try {
      agent.followup(createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'user' } }));
      await agent.whenIdle();
      const view = ctx.sessionProjections.snapshot(agent.session, ['deepPtcCards','deepPtcProject']).values;
      const marks = [0, ...texts.map(row => row.ms), Date.now() - started];
      const result = { id, timeout, reason, visibleSteps: texts.length, calls, longestGapMs: Math.max(...marks.slice(1).map((v,i)=>v-marks[i])),
        texts, cards: (view.deepPtcCards?.cards ?? []).map(card => ({ title: card.title, blocks: card.blocks?.map(b=>b.type), actions: card.actions?.length })),
        proposals: view.deepPtcProject?.proposals?.length ?? 0 };
      console.log(JSON.stringify(result));
      writeFileSync(path.join(root, id + '-result.json'), JSON.stringify(result, null, 2));
    } finally { clearTimeout(timer); off(); await dispose(); }
  }
  const selected = process.argv.slice(3);
  if (selected.some(id => !Object.hasOwn(cases, id))) throw new Error('Unknown behavior case');
  const entries = Object.entries(cases).filter(([id]) => !selected.length || selected.includes(id));
  console.log('Live behavior results directory:', root);
  for (let index = 0; index < entries.length; index += 2) await Promise.all(entries.slice(index, index + 2).map(run));
}
