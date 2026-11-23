export function createNotices() {
  // Deep PTC also asks every decision as a native question for DSH Go (lib/mobile-mirror.mjs). This
  // client shows the card itself, so it keeps such a request open without drawing it: whoever answers
  // first settles it, and a phone that connects later still receives it.
  const MIRROR_PREFIX = 'dpt:';
  const QUESTION_EVENT = 'user-questions/request';
  const isMirror = request => Array.isArray(request?.questions) && request.questions.length > 0
    && request.questions.every(question => typeof question?.id === 'string' && question.id.startsWith(MIRROR_PREFIX));

  const hold = signal => new Promise((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error('settled on the card'), { name: 'UserQuestionError', code: 'ASK_ABORTED' }));
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });

  // The host's own question box registered before this plugin and answers without passing on, so the
  // listener has to run first. The forwarded event's private name is read from where `$on` put it.
  function listenFirst(child, event, listener) {
    const dispose = child.remote.$on(event, listener);
    try {
      const hooks = child.events?._hooks ?? {};
      const key = Object.keys(hooks).find(name => name.startsWith('internal/') && name.endsWith('/' + event)
        && Array.from(hooks[name] ?? []).some(hook => hook?.callback === listener));
      if (key !== undefined) {
        dispose();
        return child.on(key, listener, { prepend: true });
      }
    } catch { /* keep the plain registration */ }
    return dispose;
  }

  // Struck-bell tones, the same as lib/notify/*.wav.
  const NOTES = { ask: [[0, 659.25], [0.13, 987.77]], done: [[0, 523.25], [0.11, 659.25], [0.22, 783.99]] };
  let audio;
  function chime(name) {
    try {
      // Two windows of the same DSH ring once.
      const last = Number(globalThis.localStorage?.getItem('dpt-chime') ?? 0);
      if (Date.now() - last < 700) return;
      globalThis.localStorage?.setItem('dpt-chime', String(Date.now()));
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) return;
      audio ??= new Context();
      void audio.resume?.();
      for (const [start, frequency] of NOTES[name]) {
        for (const [ratio, level, seconds] of [[1, 0.16, 0.8], [2, 0.045, 0.5]]) {
          const at = audio.currentTime + 0.02 + start;
          const gain = audio.createGain();
          const tone = audio.createOscillator();
          tone.frequency.value = frequency * ratio;
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(level, at + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
          tone.connect(gain).connect(audio.destination);
          tone.start(at);
          tone.stop(at + seconds + 0.05);
        }
      }
    } catch { /* a browser that blocks sound stays silent */ }
  }

  /** @param options - `{ setting(key), deep(sessionId) }`. */
  function installNotices(child, { setting, deep }) {
    if (typeof child.remote?.$on !== 'function') return;
    const heard = new Set();
    // The desktop app's host rings and shows its own notice (lib/notify.mjs).
    const rings = key => setting('notifyHost') !== 'native' && setting(key) !== false;
    const question = function (request, next) {
      if (!isMirror(request)) return next();
      const id = request.questions[0].id;
      if (!heard.has(id)) {
        heard.add(id);
        if (rings('notifySound')) chime('ask');
      }
      return hold(request.signal);
    };
    child.effect(() => listenFirst(child, QUESTION_EVENT, question), 'deep-ptc: mirrored questions');
    const timers = new Map();
    const status = (id, running) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      if (running || !deep(id) || !rings('notifyDone')) return;
      timers.set(id, setTimeout(() => { timers.delete(id); chime('done'); }, 700));
    };
    child.effect(() => {
      const dispose = child.remote.$on('api-session/status', status);
      return () => { for (const timer of timers.values()) clearTimeout(timer); dispose(); };
    }, 'deep-ptc: task end sound');
  }

  return { installNotices, isMirror, listenFirst };
}
