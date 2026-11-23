// A live update keeps modules of the previous version in memory while a Deep PTC conversation is open:
// the new entry then links against them. Every name imported from a file that already existed in an
// earlier release must therefore exist in that release too; new names belong in new files.
//   node scripts/check-live-update.mjs            check against scripts/live-exports.json
//   node scripts/check-live-update.mjs --record   add this version's exports (run at release)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const lib = new URL('../lib/', import.meta.url);
const file = new URL('./live-exports.json', import.meta.url);
const baseline = JSON.parse(readFileSync(file, 'utf8'));
const sources = Object.fromEntries(readdirSync(lib).filter(name => name.endsWith('.mjs')).map(name => [name, readFileSync(new URL(name, lib), 'utf8')]));

export function exportsOf(source) {
  const names = new Set([...source.matchAll(/^export (?:async )?(?:function\*?|const|let|class) ([\w$]+)/gmu)].map(match => match[1]));
  for (const [, list] of source.matchAll(/^export \{([^}]*)\}/gmu)) for (const part of list.split(',')) { const name = part.trim().split(/\s+as\s+/u).at(-1); if (name) names.add(name); }
  return [...names].sort();
}
export function conflicts(oldExports, files = sources) {
  const out = [];
  for (const [name, source] of Object.entries(files)) {
    for (const [, list, from] of source.matchAll(/^(?:import|export) \{([^}]*)\} from '\.\/([\w-]+\.mjs)'/gmu)) {
      if (oldExports[from] === undefined) continue;
      for (const part of list.split(',')) { const want = part.trim().split(/\s+as\s+/u)[0]; if (want && !oldExports[from].includes(want)) out.push(`${name}: ${want} from ${from}`); }
    }
  }
  return out;
}

if (process.argv[1]?.endsWith('check-live-update.mjs')) {
  if (process.argv.includes('--record')) {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    baseline[version] = Object.fromEntries(Object.entries(sources).map(([name, source]) => [name, exportsOf(source)]));
    writeFileSync(file, JSON.stringify(baseline));
  }
  for (const [version, table] of Object.entries(baseline)) for (const row of conflicts(table)) { console.log(`${version} → here: ${row}`); process.exitCode = 1; }
}
