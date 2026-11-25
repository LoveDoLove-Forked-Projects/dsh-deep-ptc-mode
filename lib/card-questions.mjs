// Question cards: Deep PTC's replacement for the host's blocking question box.
//
// The model posts a question card and carries on (or ends its turn); the user answers on the card,
// and the answer reaches the model as an ordinary message. Answered and unanswered question cards
// stay in the conversation, so the user can always read back what was asked and what they chose.
//
// Free-text answers only ever travel to the model as message text: no command, schedule or other
// host action can read them, so they need no shell-safe grammar.

import { objects, text } from './card-blocks.mjs';

export const QUESTION_KIND = 'question';
export const QUESTION_TYPES = ['single', 'multi', 'text'];
export const MAX_QUESTIONS = 5;
export const MAX_ANSWER = 1000;
// A briefing batch (deep sleep mode) is several small cards answered together, so one card keeps its
// five questions and the batch carries the width.
export const MAX_BRIEFING_CARDS = 8;
const SERIES_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/u;
const MAX_TITLE = 120;
const MAX_SUBTITLE = 200;
const MAX_PROMPT = 300;
const MAX_OPTIONS = 8;
const QUESTION_ID = /^[A-Za-z][A-Za-z0-9_]{0,23}$/u;
const OPTION_VALUE = /^[A-Za-z0-9_.:@/+=-]{1,60}$/u;

function readOptions(value, path, issues) {
  if (!Array.isArray(value) || value.length < 2 || value.length > MAX_OPTIONS) {
    issues.push(`${path}.options: use 2-${MAX_OPTIONS} options`);
    return [];
  }
  const options = [];
  value.forEach((entry, index) => {
    const at = `${path}.options.${index}`;
    const label = text(objects(entry) ? entry.label : entry, 80);
    const raw = objects(entry) ? entry.value : undefined;
    const optionValue = raw === undefined ? `o${index + 1}` : text(raw, 60);
    if (label === '') { issues.push(`${at}: label required`); return; }
    if (!OPTION_VALUE.test(optionValue)) { issues.push(`${at}.value: use letters, digits or _ . : @ / + = -`); return; }
    const hint = text(objects(entry) ? entry.hint : undefined, 120);
    options.push({ value: optionValue, label, ...hint ? { hint } : {} });
  });
  if (new Set(options.map(option => option.value)).size !== options.length) issues.push(`${path}.options: values must be unique`);
  return options;
}

function readQuestion(value, index, issues) {
  const path = `questions.${index}`;
  if (!objects(value)) { issues.push(`${path}: expected an object`); return undefined; }
  const id = value.id === undefined ? `q${index + 1}` : text(value.id, 24);
  if (!QUESTION_ID.test(id)) issues.push(`${path}.id: use a letter then letters, digits or _`);
  const prompt = text(value.prompt, MAX_PROMPT);
  if (prompt === '') issues.push(`${path}.prompt: required`);
  const type = value.type === undefined ? (value.options === undefined ? 'text' : 'single') : value.type;
  if (!QUESTION_TYPES.includes(type)) { issues.push(`${path}.type: use single, multi or text`); return undefined; }
  const question = { id, prompt, type };
  if (type === 'text') {
    if (value.options !== undefined) issues.push(`${path}.options: a text question has no options`);
    const placeholder = text(value.placeholder, 80);
    if (placeholder) question.placeholder = placeholder;
  } else {
    question.options = readOptions(value.options, path, issues);
    // The recommended answer is preselected; the user still confirms it.
    const wanted = value.recommended === undefined ? [] : Array.isArray(value.recommended) ? value.recommended : [value.recommended];
    const picked = wanted.map(item => text(item, 60)).filter(item => question.options.some(option => option.value === item));
    if (wanted.length !== picked.length) issues.push(`${path}.recommended: use option values`);
    else if (type === 'single' && picked.length > 1) issues.push(`${path}.recommended: a single choice has one recommendation`);
    else if (picked.length > 0) question.recommended = type === 'single' ? picked[0] : picked;
  }
  if (value.optional === true) question.optional = true;
  return question;
}

/** Normalise a question card body, or list what the model must fix. Reading it twice changes nothing. */
export function readQuestionInput(value) {
  if (!objects(value)) return { issues: ['expected an object'] };
  const issues = [];
  const card = { kind: QUESTION_KIND, title: text(value.title, MAX_TITLE) };
  if (value.review === 'brief' || value.review === 'project') {
    card.review = value.review;
    if (typeof value.author === 'string') card.author = value.author;
  }
  // A briefing card belongs to a batch: the cards share one series id and say where they sit in it.
  // Nothing is delivered per card; the batch is delivered once, when its last card is answered.
  // A confirmation card (deep sleep mode) shows the settings the run will follow in a few rows,
  // so the user confirms the whole plan instead of re-reading every answer.
  if (value.summary !== undefined) {
    if (!Array.isArray(value.summary) || value.summary.length === 0 || value.summary.length > 8) {
      issues.push('summary: use 1-8 rows');
    } else {
      const rows = [];
      value.summary.forEach((row, index) => {
        const label = text(objects(row) ? row.label : undefined, 40);
        const shown = text(objects(row) ? row.value : undefined, 160);
        if (label === '' || shown === '') { issues.push(`summary.${index}: a label and a value are required`); return; }
        rows.push({ label, value: shown });
      });
      if (rows.length > 0) card.summary = rows;
    }
  }
  // The confirmation card of an unattended run: answering it is what actually starts the goal, so
  // the objective and the round cap travel with the card instead of trusting the next tool call.
  if (value.sleep === true) {
    const objective = text(value.sleepObjective, 500);
    if (objective === '') issues.push('sleepObjective: required for a confirmation card');
    else {
      card.sleep = true;
      card.sleepObjective = objective;
      const rounds = value.sleepRounds;
      card.sleepRounds = Number.isSafeInteger(rounds) && rounds > 0 && rounds <= 512 ? rounds : 256;
    }
  }
  if (value.briefing === true) {
    const series = text(value.series, 48);
    const index = value.seriesIndex;
    const total = value.seriesTotal;
    if (!SERIES_ID.test(series)) issues.push('series: use a letter or digit then letters, digits, _ or -');
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index < 1 || total < 1
      || index > total || total > MAX_BRIEFING_CARDS) {
      issues.push('seriesIndex/seriesTotal: a batch card needs 1 <= index <= total <= ' + MAX_BRIEFING_CARDS);
    } else {
      card.briefing = true;
      card.series = series;
      card.seriesIndex = index;
      card.seriesTotal = total;
    }
  }
  if (card.title === '') issues.push('title: required (the decision being asked, e.g. 选择部署方案)');
  const subtitle = text(value.subtitle, MAX_SUBTITLE);
  if (subtitle) card.subtitle = subtitle;
  if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > MAX_QUESTIONS) {
    issues.push(`questions: ask 1-${MAX_QUESTIONS} questions`);
  } else {
    card.questions = value.questions.map((entry, index) => readQuestion(entry, index, issues)).filter(Boolean);
    if (new Set(card.questions.map(question => question.id)).size !== card.questions.length) issues.push('questions: ids must be unique');
  }
  return issues.length > 0 ? { issues } : { card };
}

/**
 * Check the user's answers against the card. Required questions need an answer; a choice is one of
 * the card's options or its own written "其他" answer; free text is trimmed and bounded.
 * @returns `{ answers }` (question id → string or string list) or `{ error }`.
 */
export function readAnswers(card, raw) {
  const given = objects(raw) ? raw : {};
  const answers = {};
  for (const question of card.questions ?? []) {
    const value = given[question.id];
    // Every option question keeps an "其他" answer: free text reaches the model only as this
    // message, never as a command value, so it needs no shell-safe grammar.
    if (question.type !== 'text' && objects(value) && typeof value.custom === 'string' && value.custom.trim()) {
      answers[question.id] = { custom: value.custom.trim().slice(0, MAX_ANSWER) };
      continue;
    }
    if (question.type === 'text') {
      const answer = typeof value === 'string' ? value.trim().slice(0, MAX_ANSWER) : '';
      if (answer !== '') answers[question.id] = answer;
    } else {
      const picked = (Array.isArray(value) ? value : value === undefined || value === '' ? [] : [value]).filter(item => typeof item === 'string');
      if (picked.some(item => !question.options.some(option => option.value === item))) return { error: `${question.prompt}: not one of the options` };
      if (question.type === 'single' && picked.length > 1) return { error: `${question.prompt}: choose one` };
      if (picked.length > 0) answers[question.id] = question.type === 'single' ? picked[0] : [...new Set(picked)];
    }
    if (answers[question.id] === undefined && question.optional !== true) return { error: `${question.prompt}: needs an answer` };
  }
  return { answers };
}

/** Stored answers re-read for the projection: only known questions, only string values. */
export function storedAnswers(card, value) {
  if (!objects(value)) return undefined;
  const answers = {};
  for (const question of card.questions ?? []) {
    const answer = value[question.id];
    if (objects(answer) && typeof answer.custom === 'string') answers[question.id] = { custom: answer.custom.slice(0, MAX_ANSWER) };
    else if (typeof answer === 'string') answers[question.id] = answer.slice(0, MAX_ANSWER);
    else if (Array.isArray(answer)) answers[question.id] = answer.filter(item => typeof item === 'string');
  }
  return answers;
}

/** The message an answer sends to the model: every question with the user's answer, in order. */
export function answerMessage(card, answers, labels = { skipped: '（未回答）' }) {
  const lines = (card.questions ?? []).map((question, index) => {
    const answer = answers[question.id];
    const shown = answer === undefined ? labels.skipped
      : answer?.custom ?? (question.type === 'text' ? answer
        : (Array.isArray(answer) ? answer : [answer]).map(value => question.options.find(option => option.value === value)?.label ?? value).join('、'));
    return `${index + 1}. ${question.prompt}\n   → ${shown}`;
  });
  return `【回答 · ${card.title}】\n${lines.join('\n')}`;
}
