import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const name = 'deep-ptc-bundled-skills';

const directory = new URL('./bundled-skills/', import.meta.url);
const catalog = [
  ['dsh-operations', '在 Deep PTC 与 DSH 中选择工具、Skill、卡片、任务状态或 profile，查找当前版本的操作入口。 Navigate DSH and Deep PTC features.'],
  ['local-web-testing', '用真实浏览器验证本地 Web 交互，定位控件、触发动作并核对用户可见结果及请求次数。 Local web UI and Playwright testing.'],
  ['frontend-design', '实现前端页面与可靠的交互状态，含可运行的异步查询页面。 Frontend layout, responsive design, forms and stale requests.'],
  ['primary-source-research', '从原始资料核验主张、数据、版本与出处，含 HTML 段落定位器。 Primary sources, citations and evidence checks.'],
  ['office-delivery', '交付可编辑的办公成品和跨文件对账，含 CSV 转 Excel 与 Word 的月报生成器。 Office, spreadsheet and report generation.'],
  ['scientific-figures', '把实验数据变成科学图、统计表和 ui_card，处理单位、误差和缺失值。 Scientific charts, publication figures and result cards.'],
];

export function apply(ctx) {
  ctx.inject(['skills'], child => {
    for (const [id, description] of catalog) {
      const file = new URL(id + '.md', directory);
      child.skills.register({ name: 'deep-ptc-' + id, description, content: readFileSync(file, 'utf8'), source: 'runtime',
        path: fileURLToPath(file), resourceBase: { kind: 'directory', path: fileURLToPath(directory) } });
    }
  });
}
