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
    const hooks = () => child.events?._hooks ?? {};
    const before = new Map(Object.keys(hooks()).map(key => [key, Array.isArray(hooks()[key]) ? hooks()[key].length : 0]));
    const dispose = child.remote.$on(event, listener);
    try {
      const all = hooks();
      const candidates = Object.keys(all).filter(key => key.startsWith('internal/') && key.endsWith('/' + event)
        && (Array.isArray(all[key]) ? all[key].length : 0) > (before.get(key) ?? 0));
      // The deepest matching key is the forwarded event we just joined; a shorter prefix belongs to another client.
      const key = candidates.sort((a, b) => b.length - a.length)[0];
      if (key !== undefined) {
        dispose();
        return child.on(key, listener, { prepend: true });
      }
    } catch { /* keep the plain registration */ }
    try { console.warn('[deep-ptc] could not take the front seat for ' + event + '; a mirrored native question may be drawn twice.'); } catch { /* no console */ }
    return dispose;
  }

  // Struck-bell tones, the same as lib/notify/*.wav, or a saved clip from the host route.
  const NOTES = { ask: [[0, 659.25], [0.13, 987.77]], done: [[0, 523.25], [0.11, 659.25], [0.22, 783.99]] };
  let audio;
  let library;
  let libraryAt = 0;
  const volumeOf = value => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, number)) / 100 : 0.7;
  };
  function synth(name, volume) {
    const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!Context) return;
    audio ??= new Context();
    void audio.resume?.();
    for (const [start, frequency] of NOTES[name]) {
      for (const [ratio, base, seconds] of [[1, 0.16, 0.8], [2, 0.045, 0.5]]) {
        const at = audio.currentTime + 0.02 + start;
        const gain = audio.createGain();
        const tone = audio.createOscillator();
        tone.frequency.value = frequency * ratio;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, base * volume), at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
        tone.connect(gain).connect(audio.destination);
        tone.start(at);
        tone.stop(at + seconds + 0.05);
      }
    }
  }
  async function saved(id) {
    if (typeof fetch !== 'function') return undefined;
    if (library === undefined || Date.now() - libraryAt > 30000) {
      const response = await fetch('/deep-ptc/sounds/list');
      if (!response.ok) return undefined;
      const body = await response.json();
      library = Array.isArray(body?.sounds) ? body.sounds : [];
      libraryAt = Date.now();
    }
    return library.find(row => row.id === id);
  }
  function playClip(row, volume) {
    if (typeof Audio !== 'function') return false;
    const element = new Audio('/deep-ptc/sounds/clip/' + encodeURIComponent(row.id));
    element.volume = volume;
    element.addEventListener('loadedmetadata', () => {
      try { element.currentTime = Math.max(0, Number(row.start) || 0); } catch { /* keep from the start */ }
      void element.play?.()?.catch?.(() => {});
    }, { once: true });
    const span = Math.max(0.2, (Number(row.end) || 0) - (Number(row.start) || 0));
    setTimeout(() => { try { element.pause(); element.removeAttribute('src'); } catch { /* gone */ } }, span * 1000 + 120);
    return true;
  }
  function chime(name, setting) {
    try {
      // Two windows of the same DSH ring once.
      const last = Number(globalThis.localStorage?.getItem('dpt-chime') ?? 0);
      if (Date.now() - last < 700) return;
      globalThis.localStorage?.setItem('dpt-chime', String(Date.now()));
      const volume = volumeOf(typeof setting === 'function' ? setting('notifyVolume') : 70);
      const id = typeof setting === 'function' ? setting(name === 'ask' ? 'notifyCardSound' : 'notifyDoneSound') : undefined;
      if (typeof id === 'string' && id !== '' && id !== 'default') {
        void saved(id).then(row => { if (row === undefined || !playClip(row, volume)) synth(name, volume); }).catch(() => synth(name, volume));
        return;
      }
      synth(name, volume);
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
        if (rings('notifySound')) chime('ask', setting);
      }
      return hold(request.signal);
    };
    child.effect(() => listenFirst(child, QUESTION_EVENT, question), 'deep-ptc: mirrored questions');
    const timers = new Map();
    const status = (id, running) => {
      clearTimeout(timers.get(id));
      timers.delete(id);
      if (running || !deep(id) || !rings('notifyDone')) return;
      timers.set(id, setTimeout(() => { timers.delete(id); chime('done', setting); }, 700));
    };
    child.effect(() => {
      const dispose = child.remote.$on('api-session/status', status);
      return () => { for (const timer of timers.values()) clearTimeout(timer); dispose(); };
    }, 'deep-ptc: task end sound');
  }

  return { installNotices, isMirror, listenFirst };
}
