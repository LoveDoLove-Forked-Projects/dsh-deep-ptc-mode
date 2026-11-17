// Pure schema for the Deep PTC action card.
//
// One generic card kind backs every small card a user asks for: a title, a few
// labelled rows, a note, and at most one verb that really stops what the card
// describes. The host service validates `details` with `cardDetails`, and the
// client body renders exactly these fields.

export const CARD_ACTION = 'deep-ptc-card';
export const CARD_SKILL = 'deep-ptc-cards';
export const CARD_STOP = 'stop';

const MAX_SUBTITLE = 120;
const MAX_LABEL = 40;
const MAX_VALUE = 300;
const MAX_LINES = 12;
const MAX_NOTE = 400;
const MAX_STOP_LABEL = 24;
const MAX_COMMAND = 2000;
const MAX_SCHEDULES = 8;
const MAX_SCHEDULE_ID = 120;

const objects = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function issue(path, message) {
  return { path, message };
}

function readLines(value, issues) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LINES) {
    issues.push(issue(['lines'], 'Use an array of at most ' + MAX_LINES + ' rows'));
    return [];
  }
  const rows = [];
  value.forEach((row, index) => {
    if (!objects(row)) {
      issues.push(issue(['lines', index], 'Each row is an object with label and value'));
      return;
    }
    const label = text(row.label, MAX_LABEL);
    const detail = text(row.value, MAX_VALUE);
    if (label === '') {
      issues.push(issue(['lines', index, 'label'], 'A row needs a label'));
      return;
    }
    rows.push({ label, value: detail });
  });
  return rows;
}

function readStop(value, issues) {
  if (value === undefined) return undefined;
  if (!objects(value)) {
    issues.push(issue(['stop'], 'stop must be an object'));
    return undefined;
  }
  const stop = {};
  const label = text(value.label, MAX_STOP_LABEL);
  if (label !== '') stop.label = label;
  const command = text(value.command, MAX_COMMAND);
  if (command !== '') stop.command = command;
  if (value.schedules !== undefined) {
    if (!Array.isArray(value.schedules) || value.schedules.length > MAX_SCHEDULES) {
      issues.push(issue(['stop', 'schedules'], 'Use at most ' + MAX_SCHEDULES + ' schedule ids'));
    } else {
      const ids = value.schedules.map(id => text(id, MAX_SCHEDULE_ID)).filter(id => id !== '');
      if (ids.length > 0) stop.schedules = ids;
    }
  }
  if (stop.command === undefined && stop.schedules === undefined) {
    issues.push(issue(['stop'], 'A stop action needs a command or schedule ids'));
    return undefined;
  }
  return stop;
}

/**
 * Normalize the `details` field of one card proposal.
 * @returns normalised card, or the list of problems for the model to fix.
 */
export function parseCardDetails(value) {
  if (!objects(value)) return { issues: [issue(['details'], 'Use an object')] };
  const issues = [];
  const card = {};
  const subtitle = text(value.subtitle, MAX_SUBTITLE);
  if (subtitle !== '') card.subtitle = subtitle;
  const lines = readLines(value.lines, issues);
  if (lines.length > 0) card.lines = lines;
  const note = text(value.note, MAX_NOTE);
  if (note !== '') card.note = note;
  if (value.tone === 'warn') card.tone = 'warn';
  else if (value.tone !== undefined && value.tone !== 'info') issues.push(issue(['tone'], 'Use info or warn'));
  const stop = readStop(value.stop, issues);
  if (stop !== undefined) card.stop = stop;
  if (issues.length > 0) return { issues };
  if (card.subtitle === undefined && card.lines === undefined && card.note === undefined) {
    return { issues: [issue(['details'], 'A card needs a subtitle, lines or a note')] };
  }
  return { card };
}

/** The host service validates details through this `safeParse` contract. */
export const cardDetails = {
  safeParse(value) {
    const parsed = parseCardDetails(value);
    if (parsed.card !== undefined) return { success: true, data: parsed.card };
    return { success: false, error: { issues: parsed.issues } };
  },
};

/** What the model is told after the card is admitted. */
export const CARD_INVITATION = 'The user can run the card action or dismiss the card here; do not restate the card.';

export const CARD_SKILL_DESCRIPTION = 'Place one small card under the answer (title, labelled rows, note) with an optional action the user can press.';


export const CARD_SKILL_CONTENT = `# Small cards

Use this skill when the user wants **a small card kept in the conversation**: a status card,
a "should this loop continue" control card, a compact panel with one button. The card renders
below your answer, never covers the composer, and its button really runs on the host.

## How to place one

1. Load this skill, then call \`propose_action\` once in the same turn:
   - \`action\`: always \`deep-ptc-card\`
   - \`title\`: short card title in the user's language
   - \`brief\`: one or two sentences on what this card is
   - \`details\`: the fields below
2. One card per turn. A second call in the same turn is refused; place a new card in a later turn.
3. After the call, do not restate the card's content in the answer.

## details

- \`subtitle\` (optional): one small line under the title
- \`lines\` (optional): up to 12 \`{ label, value }\` rows
- \`note\` (optional): footnote, up to 400 characters
- \`tone\` (optional): \`info\` or \`warn\`
- \`stop\` (optional): the card's one action, shown as its button. Pressing it:
  - \`schedules\`: ids of scheduled tasks to delete (up to 8)
  - \`command\`: a command to run on the host (30 second timeout)
  - \`label\`: button text (optional, defaults to "停止")

## Rules

- The action really runs. Say in \`brief\` what pressing it does.
- Give \`stop\` only when the card needs a stop or tidy-up action; a purely
  informational card has just the dismiss button.
- Keep the card short: it is a glanceable control, not a report.
`;

/** The registration the host skill service expects for this skill. */
export const CARD_SKILL_REGISTRATION = {
  name: CARD_SKILL, description: CARD_SKILL_DESCRIPTION, content: CARD_SKILL_CONTENT, source: 'runtime',
};
