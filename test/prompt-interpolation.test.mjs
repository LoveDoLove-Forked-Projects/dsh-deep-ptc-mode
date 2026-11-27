import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL('../lib/' + file, import.meta.url), 'utf8');

test('contexts that carry user text opt out of prompt interpolation', () => {
  const contexts = [
    ['brief-context.mjs', 'deep-ptc:task-brief-state'],
    ['project-context.mjs', 'deep-ptc:project-cards-state'],
    ['intervention.mjs', 'deep-ptc:interventions'],
    ['deep-sleep.mjs', 'deep-ptc:deep-sleep'],
  ];
  for (const [file, name] of contexts) {
    const source = read(file);
    const start = source.indexOf("name: '" + name + "'");
    assert.ok(start >= 0, file + ' registers ' + name);
    assert.match(source.slice(start, start + 600), /interpolate: false/u, file + ' ' + name + ' opts out');
  }
});

test('the two prompt sections that can carry user cards opt out too', () => {
  for (const [file, anchor] of [
    ['brief-context.mjs', 'systemPrompt.section({ name: SECTION_NAME'],
    ['project-context.mjs', 'systemPrompt.section({ name: SECTION'],
  ]) {
    const source = read(file);
    const start = source.indexOf(anchor);
    assert.ok(start >= 0, file + ' registers its section');
    assert.match(source.slice(start, start + 300), /interpolate: false/u, file + ' section opts out');
  }
});
