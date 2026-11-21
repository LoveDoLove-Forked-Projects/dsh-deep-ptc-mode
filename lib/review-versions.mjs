// The model supplies the wording and candidate content. Only the server assigns choice IDs.
export function versionFields(content, required) {
  return {
    question: { type: 'string', description: 'A specific question in the user’s language about this decision, e.g. Which records should the export include?' },
    versions: { type: 'array', description: 'One to eight candidate versions of this same card. Include every meaningful alternative, each with its actual content. Only the chosen version will be applied.',
      items: { type: 'object', additionalProperties: false, required: ['label', ...required], properties: {
        label: { type: 'string', description: 'A distinct, concrete choice label.' },
        hint: { type: 'string', description: 'When to choose this version or what changes.' },
        ...content,
      } } },
  };
}

function wording(value, max, field) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(field + ': expected 1–' + max + ' characters');
  return value.trim();
}

export function readReview(input, prepare) {
  if (input.question === undefined && input.versions === undefined) return undefined;
  const question = wording(input.question, 300, 'question');
  if (input.versions === undefined) return { question };
  if (!Array.isArray(input.versions) || input.versions.length < 1 || input.versions.length > 8) throw new Error('versions: offer 1–8 candidates');
  const labels = new Set(), contents = new Set();
  const options = input.versions.map((row, i) => {
    const label = wording(row?.label, 80, 'versions.label');
    const hint = row.hint === undefined ? undefined : wording(row.hint, 200, 'versions.hint');
    const draft = prepare(row);
    const identity = JSON.stringify([draft.title, draft.category, draft.preview ?? draft.text]);
    if (labels.has(label) || contents.has(identity)) throw new Error('versions: use distinct labels and distinct card contents');
    labels.add(label);
    contents.add(identity);
    return { value: 'v' + (i + 1), label, ...(hint ? { hint } : {}), ...draft };
  });
  return { question, options };
}
