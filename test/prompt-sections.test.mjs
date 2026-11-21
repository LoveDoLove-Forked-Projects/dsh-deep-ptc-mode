import assert from 'node:assert/strict';
import test from 'node:test';
import { ASKING_WITH_CARDS, ASKING_WITHOUT_CARDS, HOST_GUIDANCE, installProgressReminder } from '../lib/progress.mjs';
import { reachabilityText } from '../lib/rules.mjs';
import { personaFrom } from '../lib/model.mjs';

function sections(questionCards) {
  const rows = new Map();
  const ctx = {
    on() {}, get: name => name === 'agentPresets' ? { presetForSession: session => session.preset } : undefined,
    systemPrompt: { section: row => { rows.set(row.name, row); }, context: () => {} },
  };
  installProgressReminder(ctx, { questionCards });
  return (name, preset = 'deep-ptc') => rows.get(name).text({ agent: { session: { id: 's', preset, header: { agentPreset: preset } } } });
}

test('the asking section follows the conversation cards switch, so the model never looks for a missing tool', () => {
  let on = true;
  const text = sections(() => on);
  assert.equal(text('deep-ptc:asking'), ASKING_WITH_CARDS);
  assert.match(ASKING_WITH_CARDS, /ask_user_question is not available/u);
  on = false;
  assert.equal(text('deep-ptc:asking'), ASKING_WITHOUT_CARDS);
  assert.match(ASKING_WITHOUT_CARDS, /Question cards are off/u);
  assert.equal(text('deep-ptc:asking', 'ptc'), '', 'other modes keep their own question tool');
});

test('the host section tells the model what DSH and Deep PTC are, so it does not explore the host', () => {
  const text = sections(() => true);
  assert.equal(text('deep-ptc:host'), HOST_GUIDANCE);
  assert.match(HOST_GUIDANCE, /Do not explore the DSH installation/u);
  assert.match(HOST_GUIDANCE, /dsh-doc skill/u);
  assert.equal(text('deep-ptc:host', 'ptc'), '');
});

test('the persona names no question tool of its own; reachability names the one in use', () => {
  const persona = personaFrom().suffix;
  assert.doesNotMatch(persona, /ask_user_question/u);
  assert.match(persona, /## Understand what the user really wants/u);
  assert.match(persona, /Never silently assume a detail that changes the result/u);
  // The two constraints that stay as they were.
  assert.match(persona, /## Spend an unlimited budget on the work/u);
  assert.match(persona, /## Work visibly/u);
  assert.match(reachabilityText({ foregroundSeconds: 30, maxQuestionSeconds: 300, maxPollsPerProgram: 3, questionCards: true }), /enclosing call waits for the answer/u);
  assert.match(reachabilityText({ foregroundSeconds: 30, maxQuestionSeconds: 300, maxPollsPerProgram: 3 }), /ask_user_question waits at most 300 s/u);
});
