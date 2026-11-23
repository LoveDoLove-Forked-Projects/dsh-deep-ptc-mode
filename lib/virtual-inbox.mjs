// What waits for a person in the virtual DSH, and answering it.
import { randomUUID } from 'node:crypto';
import { summarize, waitIdle } from './virtual-client.mjs';

const clip = (text, max) => typeof text === 'string' && text.length > max ? `${text.slice(0, max)}…` : text;

/**
 * The questions and approvals that wait for a person in the virtual DSH. It listens as one more client
 * of the same event stream its browser uses, so what waits is delivered to it, and it can answer.
 */
export function openInbox(client, { WebSocketImpl = globalThis.WebSocket } = {}) {
  const pending = new Map();
  let clientId;
  let closed = false;
  let failure;
  const opened = Promise.withResolvers();
  opened.promise.catch(() => {});
  const socket = new WebSocketImpl(`${client.origin.replace(/^http/u, 'ws')}/api/remote.mux`, { headers: { cookie: client.cookie, origin: client.origin } });
  socket.onopen = () => socket.send(JSON.stringify({ type: 'open', streamId: randomUUID(), endpoint: '$events', payload: { args: {} } }));
  socket.onmessage = ({ data }) => {
    let frame;
    try { frame = JSON.parse(data).value; } catch { return; }
    if (frame?.type === 'ready') { clientId = frame.clientId; opened.resolve(); }
    else if (frame?.type === 'waterfall') pending.set(frame.eventId, { event: frame.event, session: frame.agentId, request: frame.request ?? {} });
    else if (frame?.type === 'cancel') pending.delete(frame.eventId);
  };
  socket.onerror = () => { failure = new Error('The virtual DSH closed its event stream.'); };
  socket.onclose = () => { closed = true; pending.clear(); opened.reject(failure ?? new Error('The virtual DSH closed its event stream.')); };
  return {
    get closed() { return closed; },
    ready: opened.promise,
    /** What waits in one session, oldest first. */
    list: sessionId => [...pending].filter(([, row]) => row.session === sessionId).map(([id, row]) => ({ id, ...row })),
    async settle(id, outcome) {
      await client.call('$events/result', { clientId, eventId: id, outcome });
      pending.delete(id);
    },
    close() { try { socket.close(); } catch { /* gone */ } },
  };
}

/** One waiting item as a tester reads it. */
export function describePending(row) {
  if (row.event === 'approval/request') {
    return { kind: 'approval', tool: row.request.toolName ?? '', reason: row.request.displayReason?.en ?? row.request.reason ?? '', answerWith: 'decision: allow or reject' };
  }
  return { kind: 'question', questions: (row.request.questions ?? []).map(question => ({ id: question.id, question: question.question ?? '', ...question.header ? { header: question.header } : {},
    ...question.detail ? { detail: clip(question.detail, 800) } : {}, options: (question.options ?? []).map(option => option.label), ...question.multiSelect ? { several: true } : {} })),
  answerWith: 'answers: one entry per question, {choose: [option label]} or {text}' };
}

/** The wire outcome for one waiting item, or a thrown explanation of what is missing. */
export function outcomeFor(row, { decision, answers }) {
  if (row.event === 'approval/request') {
    if (decision !== 'allow' && decision !== 'reject') throw new Error('An approval waits: pass decision allow or reject.');
    return { kind: 'result', value: decision === 'allow' ? 'allowed-once' : 'rejected' };
  }
  const given = Array.isArray(answers) ? answers : [];
  const list = (row.request.questions ?? []).map((question, index) => {
    const entry = given.find(item => item?.question === question.id) ?? given[index];
    const chosen = Array.isArray(entry?.choose) ? entry.choose : typeof entry?.choose === 'string' ? [entry.choose] : [];
    const options = (question.options ?? []).map(option => option.label);
    const unknown = chosen.filter(label => !options.includes(label));
    if (unknown.length) throw new Error(`«${question.question}» has no option ${unknown.join(', ')}. Options: ${options.join(' / ')}`);
    const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
    if (chosen.length === 0 && !text) throw new Error(`«${question.question}» needs an answer. Options: ${options.join(' / ') || 'write text'}`);
    return { id: question.id, selected: chosen, ...text ? { custom: text } : {} };
  });
  return { kind: 'result', value: { answers: list } };
}

/** Answer what waits in a session, then wait for the turn as chat does. */
export async function answer(client, inbox, { session: sessionId, decision, answers, waitSeconds = 300 }) {
  await inbox.ready;
  // What waited before this client connected is delivered right after it is ready.
  let [row] = inbox.list(sessionId);
  for (let attempt = 0; row === undefined && attempt < 15; attempt++) {
    await new Promise(done => setTimeout(done, 200));
    [row] = inbox.list(sessionId);
  }
  if (row === undefined) throw new Error('Nothing waits for an answer in this session. Read it with transcript.');
  const outcome = outcomeFor(row, { decision, answers });
  const before = await client.call('session/state', { request: { sessionId } });
  await inbox.settle(row.id, outcome);
  // The turn needs a moment to take the answer; until then it still reads as waiting for input.
  await new Promise(done => setTimeout(done, 700));
  const seconds = Math.min(Math.max(Number.isFinite(waitSeconds) ? waitSeconds : 300, 0), 1800);
  const waited = seconds > 0 ? await waitIdle(client, sessionId, seconds * 1000) : { reason: 'timeout', state: before };
  const page = await client.call('session/events', { request: { address: { kind: 'session', sessionId }, maxMessages: 200 } });
  return { session: sessionId, outcome: waited.reason, running: waited.state?.running ?? null, turn: summarize(page.records, { afterSeq: before.cursor ?? -1 }) };
}
