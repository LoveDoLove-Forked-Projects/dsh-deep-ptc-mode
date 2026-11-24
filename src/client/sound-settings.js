// The sound settings: a volume that is heard while it moves, two sources (card and turn end), a
// library saved on the host, and an upload with a real progress bar plus a waveform trim.
//
// Audio lives under $DSH_HOME/storages/deep-ptc-sounds/ (lib/sound-store.mjs) and is reached over the
// plugin route /deep-ptc/sounds (lib/sound-routes.mjs). The desktop host plays it itself; this panel
// previews with the same files.

export function createSoundSettings({ React, h, tf, useFormValue }) {
  const API = '/deep-ptc/sounds';
  const FALLBACK = { maxBytes: 30 * 1024 * 1024, extensions: ['.mp3', '.wav', '.m4a'], maxClipSeconds: 30, minClipSeconds: 0.2 };

  const seconds = value => {
    const number = Math.max(0, Number(value) || 0);
    return number >= 10 ? number.toFixed(1) : number.toFixed(2);
  };
  const bytes = value => {
    const number = Number(value) || 0;
    return number >= 1024 * 1024 ? (number / 1024 / 1024).toFixed(1) + ' MB' : Math.round(number / 1024) + ' KB';
  };
  const peaksOf = (buffer, count) => {
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / count));
    const peaks = [];
    for (let index = 0; index < count; index++) {
      let peak = 0;
      const start = index * step;
      for (let cursor = 0; cursor < step && start + cursor < data.length; cursor++) peak = Math.max(peak, Math.abs(data[start + cursor]));
      peaks.push(peak);
    }
    return peaks;
  };

  function SoundSettings({ form, t }) {
    const storedVolume = useFormValue(form, 'notifyVolume');
    const storedCard = useFormValue(form, 'notifyCardSound');
    const storedDone = useFormValue(form, 'notifyDoneSound');
    const [volume, setVolume] = React.useState(typeof storedVolume === 'number' ? storedVolume : 70);
    const [library, setLibrary] = React.useState({ sounds: [], limits: FALLBACK, unavailable: false });
    const [draft, setDraft] = React.useState();
    const [upload, setUpload] = React.useState();
    const [status, setStatus] = React.useState();
    const [confirming, setConfirming] = React.useState();
    const context = React.useRef();
    const throttle = React.useRef(0);
    const persist = React.useRef();

    const writable = form?.getSnapshot?.()?.writable !== false && form !== undefined;
    const limits = library.limits ?? FALLBACK;
    const cardSound = typeof storedCard === 'string' && storedCard !== '' ? storedCard : 'default';
    const doneSound = typeof storedDone === 'string' && storedDone !== '' ? storedDone : 'default';

    React.useEffect(() => { if (typeof storedVolume === 'number') setVolume(storedVolume); }, [storedVolume]);

    function save(key, value) {
      try {
        const revision = form.getSnapshot().revision;
        void form.mutate([{ op: 'set', path: [key], value }], revision).then(ok => { if (!ok) setStatus(t('soundFailed')); });
      } catch { setStatus(t('soundFailed')); }
    }

    async function load() {
      try {
        const response = await fetch(API + '/list');
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? 'list failed');
        setLibrary({ sounds: Array.isArray(body.sounds) ? body.sounds : [], limits: { ...FALLBACK, ...(body.limits ?? {}) }, unavailable: false });
      } catch { setLibrary(current => ({ ...current, unavailable: true })); }
    }
    React.useEffect(() => { void load(); }, []);

    function audioContext() {
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      if (!Context) return undefined;
      context.current ??= new Context();
      void context.current.resume?.();
      return context.current;
    }

    function tone(percent) {
      const ctx = audioContext();
      if (ctx === undefined) return;
      const level = Math.max(0, Math.min(100, Number(percent) || 0)) / 100;
      for (const [start, frequency] of [[0, 659.25], [0.13, 987.77]]) {
        for (const [ratio, base, length] of [[1, 0.16, 0.5], [2, 0.045, 0.35]]) {
          const at = ctx.currentTime + 0.02 + start;
          const gain = ctx.createGain();
          const oscillator = ctx.createOscillator();
          oscillator.frequency.value = frequency * ratio;
          gain.gain.setValueAtTime(0.0001, at);
          gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, base * level), at + 0.008);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
          oscillator.connect(gain).connect(ctx.destination);
          oscillator.start(at);
          oscillator.stop(at + length + 0.05);
        }
      }
    }

    function playRow(row, percent, span) {
      if (row === undefined) return;
      try {
        const element = new Audio(API + '/clip/' + encodeURIComponent(row.id));
        element.volume = Math.max(0, Math.min(1, (Number(percent) || 0) / 100));
        element.addEventListener('loadedmetadata', () => {
          try { element.currentTime = Math.max(0, Number(row.start) || 0); } catch { /* start from zero */ }
          void element.play?.()?.catch?.(() => {});
        }, { once: true });
        const length = Math.max(0.2, (Number(row.end) || 0) - (Number(row.start) || 0));
        setTimeout(() => { try { element.pause(); } catch { /* already gone */ } }, Math.min(length, span ?? length) * 1000 + 100);
      } catch { /* a browser that blocks sound stays silent */ }
    }

    function preview(percent) {
      if (cardSound === 'default') { tone(percent); return; }
      const row = library.sounds.find(item => item.id === cardSound);
      if (row === undefined) tone(percent); else playRow(row, percent, 1.6);
    }

    function moved(next) {
      setVolume(next);
      const now = Date.now();
      if (now - throttle.current >= 140) { throttle.current = now; preview(next); }
      clearTimeout(persist.current);
      persist.current = setTimeout(() => save('notifyVolume', next), 350);
    }

    function choose(event) {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file === undefined) return;
      const name = String(file.name ?? 'sound');
      const extension = '.' + (name.split('.').pop() ?? '').toLowerCase();
      if (!limits.extensions.includes(extension)) { setStatus(t('soundFormat')); return; }
      if (file.size > limits.maxBytes) { setStatus(t('soundTooBig')); return; }
      const request = new XMLHttpRequest();
      request.open('POST', API + '/upload?ext=' + encodeURIComponent(extension));
      request.upload.onprogress = event => {
        if (event.lengthComputable) setUpload({ name, progress: Math.min(99, Math.round(event.loaded / event.total * 100)) });
      };
      request.onerror = () => { setUpload(undefined); setStatus(t('soundFailed')); };
      request.onload = () => {
        setUpload({ name, progress: 100 });
        let body;
        try { body = JSON.parse(request.responseText); } catch { body = {}; }
        if (request.status !== 200 || typeof body.id !== 'string') { setUpload(undefined); setStatus(body.error ?? t('soundFailed')); return; }
        const id = body.id;
        const objectUrl = URL.createObjectURL(file);
        void file.arrayBuffer().then(buffer => {
          const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
          if (Context === undefined) throw new Error('no audio context');
          context.current ??= new Context();
          return context.current.decodeAudioData(buffer);
        }).then(buffer => {
          const duration = Math.max(0, buffer.duration);
          const end = Math.min(duration, Math.max(limits.minClipSeconds, 3));
          setDraft({ id, extension, name: name.replace(/\.[^.]+$/u, ''), duration, objectUrl,
            peaks: peaksOf(buffer, 220), start: 0, end, playing: false });
          setUpload(undefined);
          setStatus(undefined);
        }).catch(() => { setDraft({ id, extension, name: name.replace(/\.[^.]+$/u, ''), duration: 0, objectUrl, peaks: [], start: 0, end: 3, playing: false }); setUpload(undefined); });
      };
      setUpload({ name, progress: 0 });
      request.send(file);
    }

    function previewDraft() {
      if (draft === undefined) return;
      try {
        const element = new Audio(draft.objectUrl);
        element.volume = Math.max(0, Math.min(1, volume / 100));
        element.addEventListener('loadedmetadata', () => {
          try { element.currentTime = draft.start; } catch { /* from zero */ }
          void element.play?.()?.catch?.(() => {});
        }, { once: true });
        const length = Math.max(0.2, draft.end - draft.start);
        setTimeout(() => { try { element.pause(); } catch { /* gone */ } }, length * 1000 + 120);
      } catch { /* silent */ }
    }

    async function saveDraft() {
      if (draft === undefined) return;
      try {
        const response = await fetch(API + '/save', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: draft.id, extension: draft.extension, name: draft.name, start: draft.start, end: draft.end, duration: draft.duration }) });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? 'save failed');
        setDraft(undefined);
        setStatus(t('soundSaved'));
        await load();
      } catch (error) { setStatus(String(error?.message ?? t('soundFailed'))); }
    }

    async function discard() {
      if (draft === undefined) return;
      try { URL.revokeObjectURL(draft.objectUrl); } catch { /* gone */ }
      try { await fetch(API + '/discard', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: draft.id, extension: draft.extension }) }); } catch { /* best effort */ }
      setDraft(undefined);
    }

    async function remove(id) {
      try {
        const response = await fetch(API + '/item/' + encodeURIComponent(id), { method: 'DELETE' });
        if (!response.ok) throw new Error('delete failed');
        setConfirming(undefined);
        if (cardSound === id) save('notifyCardSound', 'default');
        if (doneSound === id) save('notifyDoneSound', 'default');
        await load();
      } catch { setStatus(t('soundFailed')); }
    }

    const sourceRow = (label, key, value) => h('div', { className: 'dpt-sound-source' },
      h('span', { className: 'dpt-side-label' }, label),
      h('div', { className: 'dpt-sound-source-row' },
        h('select', { className: 'dpt-sound-select', value, disabled: !writable, 'aria-label': label,
          onChange: event => save(key, event.target.value) },
          h('option', { value: 'default' }, t('soundDefault')),
          ...library.sounds.map(row => h('option', { key: row.id, value: row.id }, row.name))),
        h('button', { type: 'button', className: 'dpt-btn', disabled: !writable,
          onClick: () => { const row = library.sounds.find(item => item.id === value); if (row === undefined) tone(volume); else playRow(row, volume); } },
          t('soundPreview'))));

    const draftView = draft === undefined ? null : h('div', { className: 'dpt-sound-draft' },
      h('div', { className: 'dpt-sound-draft-head' }, h('strong', null, t('soundTrim')),
        h('span', { className: 'dpt-side-note' }, tf(t, 'soundTrimHint', { max: limits.maxClipSeconds }))),
      h('div', { className: 'dpt-wave' },
        draft.peaks.map((peak, index) => h('span', { key: index, className: 'dpt-wave-bar', style: { height: Math.round(Math.max(4, peak * 100)) + '%' } })),
        h('span', { className: 'dpt-wave-sel', style: { left: (draft.start / Math.max(0.001, draft.duration) * 100) + '%',
          width: ((draft.end - draft.start) / Math.max(0.001, draft.duration) * 100) + '%' } })),
      h('label', { className: 'dpt-sound-field' }, t('soundStart'),
        h('input', { type: 'range', min: 0, max: Math.max(0.001, draft.end - limits.minClipSeconds), step: 0.05, value: draft.start,
          onChange: event => setDraft(current => current && ({ ...current, start: Math.min(Number(event.target.value), current.end - limits.minClipSeconds) })) }),
        h('span', { className: 'dpt-side-note' }, seconds(draft.start) + ' s')),
      h('label', { className: 'dpt-sound-field' }, t('soundEnd'),
        h('input', { type: 'range', min: Math.min(draft.duration, draft.start + limits.minClipSeconds), max: Math.min(draft.duration, draft.start + limits.maxClipSeconds), step: 0.05, value: draft.end,
          onChange: event => setDraft(current => current && ({ ...current, end: Math.max(Number(event.target.value), current.start + limits.minClipSeconds) })) }),
        h('span', { className: 'dpt-side-note' }, seconds(draft.end) + ' s')),
      h('p', { className: 'dpt-side-note' }, tf(t, 'soundLength', { length: seconds(draft.end - draft.start) })),
      h('label', { className: 'dpt-sound-field' }, t('soundName'),
        h('input', { type: 'text', className: 'dpt-sound-input', value: draft.name, maxLength: 80,
          onChange: event => setDraft(current => current && ({ ...current, name: event.target.value })) })),
      h('div', { className: 'dpt-sound-actions' },
        h('button', { type: 'button', className: 'dpt-btn', onClick: previewDraft }, t('soundPlaySelection')),
        h('button', { type: 'button', className: 'dpt-btn dpt-btn-primary', disabled: !writable, onClick: () => { void saveDraft(); } }, t('soundSave')),
        h('button', { type: 'button', className: 'dpt-btn', onClick: () => { void discard(); } }, t('soundCancel'))));

    return h('div', { className: 'dpt-sound-settings' },
      h('div', { className: 'dpt-side-section' },
        h('div', { className: 'dpt-side-label' }, h('span', null, t('soundVolume')), h('span', { className: 'dpt-side-note' }, volume + '%')),
        h('input', { type: 'range', className: 'dpt-range', min: 0, max: 100, step: 1, value: volume, disabled: !writable,
          'aria-label': t('soundVolume'), onChange: event => moved(Number(event.target.value)) }),
        h('p', { className: 'dpt-side-note' }, t('soundVolumeHint'))),
      sourceRow(t('soundCardSource'), 'notifyCardSound', cardSound),
      sourceRow(t('soundDoneSource'), 'notifyDoneSound', doneSound),
      library.unavailable ? h('p', { className: 'dpt-side-note' }, t('soundUnavailable')) : null,
      h('div', { className: 'dpt-side-section' },
        h('div', { className: 'dpt-side-label' }, h('span', null, t('soundLibrary'))),
        library.sounds.length === 0 ? h('p', { className: 'dpt-side-note' }, t('soundEmpty'))
          : h('ul', { className: 'dpt-sound-list' }, ...library.sounds.map(row => h('li', { key: row.id, className: 'dpt-sound-item' },
            h('span', { className: 'dpt-sound-name' }, row.name),
            h('span', { className: 'dpt-side-note' }, seconds(row.end - row.start) + ' s · ' + bytes(row.size)),
            h('button', { type: 'button', className: 'dpt-btn', onClick: () => playRow(row, volume) }, t('soundPreview')),
            confirming === row.id
              ? h('button', { type: 'button', className: 'dpt-btn dpt-btn-danger', onClick: () => { void remove(row.id); } }, t('soundConfirmDelete'))
              : h('button', { type: 'button', className: 'dpt-btn', onClick: () => setConfirming(row.id) }, t('soundDelete'))))),
        h('div', { className: 'dpt-sound-upload' },
          h('label', { className: 'dpt-btn' }, t('soundUpload'),
            h('input', { type: 'file', accept: limits.extensions.join(','), style: { display: 'none' }, disabled: !writable, onChange: choose })),
          h('p', { className: 'dpt-side-note' }, tf(t, 'soundUploadHint', { max: Math.round(limits.maxBytes / 1024 / 1024) }))),
        upload === undefined ? null : h('div', { className: 'dpt-sound-progress' },
          h('div', { className: 'dpt-sound-progress-track' }, h('div', { className: 'dpt-sound-progress-fill', style: { width: upload.progress + '%' } })),
          h('span', { className: 'dpt-side-note' }, tf(t, 'soundUploading', { name: upload.name, progress: upload.progress }))),
        draftView),
      status === undefined ? null : h('p', { className: 'dpt-side-note', role: 'status' }, status));
  }

  return { SoundSettings };
}
