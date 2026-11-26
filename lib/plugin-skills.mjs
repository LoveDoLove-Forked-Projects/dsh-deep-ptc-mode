// The plugin's own skills: id and model-facing description.
//
// A file of its own on purpose: after a live update, modules of the previous version may still be in
// memory (scripts/check-live-update.mjs), so new names never join an existing file.

/** `[id, description]` pairs; the body lives in lib/bundled-skills/<id>.md and is registered as deep-ptc-<id>. */
export const PLUGIN_SKILLS = [
  ['dsh-operations', 'Navigate DSH and Deep PTC: choose tools, skills, cards, task state or profiles; which cards wait for the user; approvals, quarantined tools and common mistakes.'],
  ['local-web-testing', 'Verify a local web interaction in a real browser: locate controls, trigger the action, check what the user sees and how many requests ran (Playwright).'],
  ['frontend-design', 'Build frontend pages with reliable interaction states: layout, responsive design, forms and stale requests; includes a runnable async query page.'],
  ['ui-visual-design', 'Give an interface a deliberate look: reuse the existing design system, define colour, type and spacing variables with light and dark themes, set hierarchy, keep layouts from jumping, avoid template looks, and self-check; includes a runnable variables and components page.'],
  ['primary-source-research', 'Check claims, numbers, versions and citations against primary sources; includes an HTML passage locator.'],
  ['office-delivery', 'Deliver editable Office outputs with cross-file reconciliation; includes a CSV to Excel and Word monthly report generator.'],
  ['scientific-figures', 'Turn experimental data into scientific figures, statistics tables and ui_card results, handling units, error bars and missing values.'],
  ['windows-wsl', 'Work across Windows and WSL: path mapping and Chinese paths, interop, PowerShell 5.1 pitfalls, encodings and line endings, localhost between the two sides, file locks.'],
  ['dsh-plugin-dev', 'Develop DSH plugins: prompt section vs context cache cost, the PTC SDK schema subset, session projections, slot rendering timing, history replacement, testing a build.'],
  ['virtual-dsh-testing', 'Test plugin, preset, skill or configuration changes in a virtual DSH with the virtual_dsh tool: start with a built package, check it loaded, exercise the behavior in the browser or with the user, iterate, report and clean up.'],
  ['tool-evaluation', 'Evaluate whether an agent picks the right tool, fills its arguments and finishes the task: fixed cases, machine-checkable results, comparing two versions.'],
];
