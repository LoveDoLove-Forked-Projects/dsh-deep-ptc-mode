// Desktop notices: a sound when a card starts waiting or a task ends, and a notice at the bottom right
// of the screen that takes the answer in place.
//
// The notice is drawn by a small Windows PowerShell process (lib/notify/popup.ps1) that starts with the
// first notice and exits when it has been idle for a while. It runs only under the DSH desktop app on
// Windows, where host and screen are the same machine; elsewhere the web client plays the sounds
// (src/client/notify.js) and the cards stay in the chat.

import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { hostLanguage } from './decisions.mjs';
import { isDeepPtcSession } from './session-preset.mjs';
import { userIsElsewhere } from './subagent-direct.mjs';
import { MIRROR_PREFIX } from './mobile-mirror.mjs';

const SCRIPT = fileURLToPath(new URL('./notify/popup.ps1', import.meta.url));
const SOUND = name => fileURLToPath(new URL(`./notify/${name}.wav`, import.meta.url));
const IDLE_MS = 180_000;
// An approval the host settles by itself (a rule, an automatic review) needs no notice.
const APPROVAL_MS = 1200;
const MAX_CHIMES_MS = 600;

const WORDS = {
  zh: { app: '深度 PTC', open: '去 DSH 处理', previous: '上一个', next: '下一个', nextQuestion: '下一题', hide: '收起提示（卡片仍在 DSH 里）', optional: '可不填', other: '其他', otherHint: '写下你的想法',
    time: 'HH:MM，例如 09:30', date: 'YYYY-MM-DD', number: '数字', approval: '等待你批准', question: '等待你的回答' },
  en: { app: 'Deep PTC', open: 'Continue in DSH', previous: 'Previous', next: 'Next', nextQuestion: 'Next', hide: 'Hide this notice (the card stays in DSH)', optional: 'optional', other: 'Other', otherHint: 'Write your own answer',
    time: 'HH:MM, e.g. 09:30', date: 'YYYY-MM-DD', number: 'a number', approval: 'Waiting for your approval', question: 'Waiting for your answer' },
};

/** Whether this host shares the screen with the user: the desktop app on Windows, not a virtual DSH. */
export function nativeNotices(env = process.env, argv = process.argv, platform = process.platform, versions = process.versions) {
  if (env.DEEP_PTC_NOTICES) return platform === 'win32' && env.DEEP_PTC_NOTICES === 'native';
  return platform === 'win32' && versions.electron !== undefined && env.DEEP_PTC_VIRTUAL_DSH === undefined
    && /dsh-desktop-host[\\/]/u.test(argv[1] ?? '');
}

/** Card blocks in the few shapes the notice draws; charts become labelled bars. */
export function noticeBlocks(blocks) {
  const list = value => Array.isArray(value) ? value : [];
  const withUnit = (value, unit) => unit ? `${value}${/^[%°]/u.test(unit) ? '' : ' '}${unit}` : String(value);
  return list(blocks).map(block => {
    const items = list(block.items);
    if (block.type === 'progress') return { type: 'meters', items: items.map(item => ({ label: item.label, share: item.value / (item.max ?? 100),
      value: item.max === undefined ? `${item.value}%` : `${item.value} / ${item.max}`, tone: item.tone })) };
    if (block.type === 'bars' || block.type === 'donut') {
      const top = block.type === 'donut' ? items.reduce((sum, item) => sum + item.value, 0) : Math.max(...items.map(item => item.value));
      return { type: 'meters', title: block.title, items: items.map(item => ({ label: item.label, share: top > 0 ? item.value / top : 0, value: withUnit(item.value, block.unit), tone: item.tone })) };
    }
    if (block.type === 'line') {
      const points = list(block.points);
      return { type: 'rows', title: block.title, items: [{ label: 'min – max', value: `${withUnit(Math.min(...points), block.unit)} – ${withUnit(Math.max(...points), block.unit)}` },
        { label: block.labels?.at(-1) ?? '→', value: withUnit(points.at(-1), block.unit) }] };
    }
    return block;
  });
}

/** The notice for one decision, as the script reads it. */
export function noticeFor(entry, language) {
  const w = WORDS[language] ?? WORDS.en;
  const { decision } = entry;
  return { op: 'show', id: entry.id, kicker: [decision.kicker, entry.place].filter(Boolean).join(' · '), title: decision.title, subtitle: decision.subtitle, tone: decision.tone ?? 'info',
    blocks: noticeBlocks(decision.blocks), note: decision.note, labels: w,
    fields: decision.fields.map(field => ({ id: field.id, prompt: field.prompt === decision.title ? '' : field.prompt, type: field.type, value: field.value ?? '', optional: field.optional,
      custom: field.custom === true, placeholder: field.placeholder ?? '', options: field.options.map(option => ({ value: option.value, label: option.label, hint: option.hint ?? '' })) })),
    buttons: decision.buttons.map(button => ({ id: button.id, label: button.label, style: button.style })) };
}

/** The notice process: started on demand, restarted after a failure, stopped when idle. */
export function createPopup({ logger, start = startProcess, onEvent, idleMs = IDLE_MS }) {
  let child;
  let idle;
  let failures = 0;
  const shown = new Set();
  const stop = () => { clearTimeout(idle); const old = child; child = undefined; shown.clear(); try { old?.stdin.end(); } catch { /* already gone */ } };
  const rest = () => { clearTimeout(idle); if (child !== undefined && shown.size === 0) { idle = setTimeout(stop, idleMs); idle.unref?.(); } };
  function ensure() {
    if (child !== undefined) return child;
    if (failures >= 3) return undefined;
    const started = start();
    child = started;
    started.on('error', error => { failures += 1; logger?.warn?.('Deep PTC: desktop notices unavailable (%s)', error.message); if (child === started) child = undefined; });
    started.on('exit', code => { if (child !== started) return; child = undefined; if (code) failures += 1; for (const id of [...shown]) { shown.delete(id); onEvent({ event: 'hide', id }); } });
    started.stdin.on('error', () => {});
    let complained = 0;
    started.stderr?.on('data', data => { if (complained++ < 5) logger?.warn?.('Deep PTC: notice: %s', String(data).trim().slice(0, 300)); });
    createInterface({ input: started.stdout }).on('line', line => {
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.event === 'ready') failures = 0;
      if (message.event === 'hide') { shown.delete(message.id); rest(); }
      if (message.event !== 'ready') onEvent(message);
    });
    return child;
  }
  const send = message => {
    try { ensure()?.stdin.write(`${JSON.stringify(message)}\n`); } catch (error) { logger?.warn?.('Deep PTC: notice not shown (%s)', error.message); }
    rest();
  };
  return {
    show(notice) { shown.add(notice.id); send(notice); },
    close(id) { if (shown.delete(id)) send({ op: 'close', id }); },
    error(id, text) { if (shown.has(id)) send({ op: 'error', id, text }); },
    sound(payload) { send({ op: 'sound', ...payload }); },
    shown: id => shown.has(id),
    stop,
  };
}

function startProcess() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  return spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, env });
}

// A second launch of the desktop app brings its window to the front, also from the tray.
function openDesktop(logger) {
  const env = { ...process.env };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'DSH_DESKTOP_NODE_EXECUTABLE']) delete env[key];
  try {
    const child = spawn(process.execPath, [], { detached: true, stdio: 'ignore', env });
    child.on('error', error => logger?.warn?.('Deep PTC: could not open DSH (%s)', error.message));
    child.unref();
  } catch (error) { logger?.warn?.('Deep PTC: could not open DSH (%s)', error.message); }
}

/**
 * @param options - `{ popup: () => 'always'|'away'|'off', sound: () => boolean, done: () => boolean }`.
 */
export function installNotices(ctx, attention, options = {}) {
  if (!(options.native ?? nativeNotices())) return undefined;
  const language = options.language ?? hostLanguage();
  const w = WORDS[language] ?? WORDS.en;
  const app = basename(process.execPath).replace(/\.exe$/iu, '');
  const read = (fn, fallback) => { try { return fn?.() ?? fallback; } catch { return fallback; } };
  const mode = () => read(options.popup, 'always');
  const volume = () => {
    const value = Number(read(options.volume, 70));
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 70;
  };
  const clipFor = name => { try { return options.clip?.(name); } catch { return undefined; } };
  let chimed = 0;
  const chime = name => {
    if (read(name === 'ask' ? options.sound : options.done, true) === false) return;
    // Several cards at once ring once.
    if (Date.now() - chimed < MAX_CHIMES_MS) return;
    chimed = Date.now();
    const clip = clipFor(name);
    popup.sound(clip === undefined
      ? { path: SOUND(name), volume: volume() }
      : { path: clip.path, start: clip.start, end: clip.end, volume: volume() });
  };
  const popup = (options.createPopup ?? createPopup)({ logger: ctx.logger, onEvent: message => {
    if (message.event === 'open') { (options.openDesktop ?? openDesktop)(ctx.logger); popup.close(message.id); return; }
    if (message.event !== 'submit') return;
    void attention.submit(message.id, message.button, message.values, 'notice').then(result => {
      if (result?.error) popup.error(message.id, result.error);
      else popup.close(message.id);
    });
  } });
  const show = notice => popup.show(mode() === 'away' ? { ...notice, unless: app } : notice);
  const offs = [
    attention.onOpen(entry => {
      if (!entry.fresh) return;
      // The user is answering this review somewhere: the next item follows them there without a chime.
      if (entry.follows === undefined) chime('ask');
      if (mode() !== 'off' && (entry.follows === undefined || entry.follows === 'notice')) show(noticeFor(entry, language));
    }),
    attention.onClose(entry => popup.close(entry.id)),
    attention.onDone(() => chime('done')),
  ];
  // Host prompts of a Deep PTC conversation are announced here and answered in DSH, where the full
  // request is visible.
  let prompts = 0;
  const announce = (request, next, kicker, title, detail) => {
    const session = request?.agent?.session;
    if (!session || userIsElsewhere(session) || !isDeepPtcSession(ctx, session)) return next();
    const id = `prompt|${++prompts}`;
    const timer = setTimeout(() => {
      chime('ask');
      if (mode() !== 'off') show({ op: 'show', id, kicker: [kicker, basename(session.header?.cwd ?? '')].filter(Boolean).join(' · '), title, subtitle: detail, tone: 'warn', blocks: [], note: '', fields: [], buttons: [], labels: w });
    }, APPROVAL_MS);
    const finish = () => { clearTimeout(timer); popup.close(id); };
    let result;
    try { result = Promise.resolve(next()); } catch (error) { finish(); throw error; }
    return result.finally(finish);
  };
  ctx.on('approval/request', (request, next) => announce(request, next, w.approval, String(request?.toolName ?? ''),
    String(request?.displayReason?.[language] ?? request?.displayReason?.en ?? request?.reason ?? '').slice(0, 400)), { prepend: true });
  ctx.on('user-questions/request', (request, next) => request?.questions?.every(question => String(question?.id).startsWith(MIRROR_PREFIX)) ? next()
    : announce(request, next, w.question, String(request?.questions?.[0]?.question ?? ''), ''), { prepend: true });
  ctx.effect(() => () => { for (const off of offs) off(); popup.stop(); }, 'Deep PTC: desktop notices');
  return popup;
}
