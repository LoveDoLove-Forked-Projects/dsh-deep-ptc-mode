// Drive a running virtual DSH through its own Web API, the same calls its browser client makes:
// create a session, send a message, wait for the turn, read what happened. Conversations created
// here appear in the virtual DSH's UI, so the user sees the test as it runs in the sidebar.
//
// Wire format (dsh-client-connection): POST <origin>/api/<endpoint> with
// { type: 'client-request', rpcId, method: endpoint, payload: { args: { <named parameters> } } },
// authenticated by the cookie the tokenized URL sets.
import { randomUUID } from 'node:crypto';

const MAX_TEXT = 4000;
const clip = (text, max = MAX_TEXT) => typeof text === 'string' && text.length > max ? `${text.slice(0, max)}…` : text;

/**
 * Connect with the tokenized URL from the virtual DSH's state.
 * @returns `{ call(method, args), origin }`.
 */
export async function connect(url, { fetchImpl = globalThis.fetch } = {}) {
  const address = new URL(url);
  const origin = `${address.protocol}//${address.host}`;
  const first = await fetchImpl(address, { redirect: 'manual' });
  const cookies = typeof first.headers.getSetCookie === 'function' ? first.headers.getSetCookie() : [first.headers.get('set-cookie')].filter(Boolean);
  const cookie = cookies.map(value => value.split(';')[0]).join('; ');
  if (!cookie) throw new Error('The virtual DSH did not accept its access token. Restart it and try again.');
  async function call(method, args, signal) {
    const rpcId = randomUUID();
    const response = await fetchImpl(`${origin}/api/${method}`, { method: 'POST', signal,
      headers: { 'content-type': 'application/json', cookie, origin },
      body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args } }) });
    if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
    const body = await response.json();
    const result = body?.result;
    if (!result?.ok) throw new Error(`${method}: ${result?.error?.code ?? 'error'}: ${result?.error?.message ?? 'no detail'}`);
    return result.value;
  }
  return { call, origin, cookie };
}

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

const textOf = message => (Array.isArray(message?.content) ? message.content : [])
  .filter(block => block?.type === 'text' && typeof block.text === 'string').map(block => block.text).join('\n');

/**
 * The events of a turn, reduced to what a tester reads: what the user and the agent said, which
 * tools it called with which arguments, what came back, and errors. Presentation and internal
 * bookkeeping are left out.
 */
export function summarize(records, { afterSeq = -1 } = {}) {
  const lines = [];
  for (const record of records ?? []) {
    const event = record?.event ?? record;
    if (!event || event.seq <= afterSeq) continue;
    const data = event.data ?? {};
    switch (event.type) {
      case 'user/message':
        if (event.surfaceOp === undefined || event.surfaceOp === 'append') {
          const kind = data.source?.kind;
          const text = textOf(data);
          if (text && (kind === 'user' || kind === undefined)) lines.push(`[user] ${clip(text, 1500)}`);
          else if (text && kind && !/runtime-context|time-context|agent-instructions|skill-catalog/u.test(kind)) lines.push(`[${kind}] ${clip(text, 600)}`);
        }
        break;
      case 'assistant/message': {
        const blocks = Array.isArray(data.message?.content) ? data.message.content : [];
        const text = blocks.filter(block => block.type === 'text').map(block => block.text).join('\n').trim();
        if (text) lines.push(`[assistant] ${clip(text)}`);
        for (const block of blocks.filter(item => item.type === 'tool-call')) {
          let args = block.arguments ?? block.input ?? block.args;
          if (typeof args !== 'string') args = JSON.stringify(args ?? {});
          lines.push(`[tool call] ${block.name ?? block.toolName} ${clip(args, 600)}`);
        }
        break;
      }
      case 'tool/ptc-dispatch':
        lines.push(`[sdk call] ${data.name} ${clip(typeof data.arguments === 'string' ? data.arguments : JSON.stringify(data.arguments ?? {}), 400)}${data.isError || data.error ? ' → error' : ''}`);
        break;
      case 'tool/result': {
        const text = textOf(data.message);
        lines.push(`[tool result${data.message?.isError || data.isError ? ' error' : ''}] ${clip(text, 800)}`);
        break;
      }
      case 'turn/end': {
        const why = data.reason?.message ?? data.reason?.error?.message ?? data.reason?.failure?.message;
        if (data.reason?.kind && data.reason.kind !== 'completed') lines.push(`[turn ended: ${data.reason.kind}${why ? ` ${clip(why, 400)}` : ''}]`);
        break;
      }
      case 'assistant/attempt': {
        // A failed model request: the provider's own words say why (no sign-in, quota, network).
        const failure = data.failure ?? data.error;
        if (failure) lines.push(`[model request failed] ${clip(failure.message ?? failure.code ?? JSON.stringify(failure), 400)}`);
        break;
      }
      default:
        if (/error|failed/u.test(event.type)) lines.push(`[${event.type}] ${clip(JSON.stringify(data), 400)}`);
    }
  }
  return lines;
}

/** Wait until the session is idle or needs input, in the host's 30-second steps. */
export async function waitIdle(client, sessionId, timeoutMs) {
  const until = Date.now() + timeoutMs;
  let last;
  for (;;) {
    const remaining = until - Date.now();
    last = await client.call('session/wait', { request: { sessionId, timeoutMs: Math.max(1000, Math.min(30_000, remaining)) } });
    if (last.reason !== 'timeout' || Date.now() >= until) return last;
  }
}

/**
 * Send a message to a session of the virtual DSH (a new one unless `session` is given), wait for
 * the turn and return what happened in it.
 */
export async function chat(client, { message, session, preset, cwd, waitSeconds = 300 }) {
  if (typeof message !== 'string' || message.trim() === '') throw new Error('message: what to send to the virtual DSH');
  let sessionId = session;
  if (!sessionId) {
    const created = await client.call('session/create', { request: { ...cwd ? { cwd } : {}, ...preset ? { agentPreset: preset } : {} } });
    sessionId = created.sessionId;
  }
  const before = await client.call('session/state', { request: { sessionId } });
  await client.call('session/prompt', { request: { requestId: randomUUID(), sessionId, mode: before.running ? 'steer' : 'queue', content: [{ type: 'text', text: message }] } });
  const seconds = Number.isFinite(waitSeconds) ? Math.min(Math.max(waitSeconds, 0), 1800) : 300;
  const waited = seconds > 0 ? await waitIdle(client, sessionId, seconds * 1000) : { reason: 'timeout', state: before };
  const page = await client.call('session/events', { request: { address: { kind: 'session', sessionId }, maxMessages: 200 } });
  return { session: sessionId, outcome: waited.reason, running: waited.state?.running ?? null,
    turn: summarize(page.records, { afterSeq: before.cursor ?? -1 }) };
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

/** The whole conversation of a session, summarized (the last `limit` lines). */
export async function transcript(client, sessionId, limit = 120) {
  const page = await client.call('session/events', { request: { address: { kind: 'session', sessionId }, maxMessages: 400 } });
  const lines = summarize(page.records);
  return { session: sessionId, lines: lines.slice(-Math.min(Math.max(limit, 1), 400)), truncated: lines.length > limit };
}

export async function sessions(client) {
  const list = await client.call('session/list', { _request: {} });
  return (list.items ?? []).map(row => ({ session: row.sessionId ?? row.id, title: row.title ?? '', running: row.running ?? false, preset: row.agentPreset ?? null }));
}

export async function cancel(client, sessionId) {
  await client.call('session/cancel', { request: { sessionId } });
  return { session: sessionId, cancelled: true };
}
