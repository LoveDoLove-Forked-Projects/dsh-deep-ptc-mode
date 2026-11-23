// Synthesize the notice sounds (lib/notify/*.wav). Original tones: struck-bell partials with a soft
// attack and an exponential decay. Run with: node scripts/make-sounds.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const RATE = 22050;
const SOUNDS = {
  // A card waits: two rising notes, an open question.
  ask: { seconds: 0.95, notes: [[0, 659.25, 0.5], [0.13, 987.77, 0.55]] },
  // The task ended: three notes settling on the chord.
  done: { seconds: 1.25, notes: [[0, 523.25, 0.42], [0.11, 659.25, 0.42], [0.22, 783.99, 0.5]] },
};
const PARTIALS = [[1, 1, 5.2], [2.0, 0.28, 7.5], [3.01, 0.1, 11]];

function render({ seconds, notes }) {
  const samples = new Float64Array(Math.round(seconds * RATE));
  for (const [start, frequency, gain] of notes) {
    for (let i = Math.round(start * RATE); i < samples.length; i++) {
      const t = i / RATE - start;
      const attack = Math.min(1, t / 0.006);
      for (const [ratio, level, decay] of PARTIALS) samples[i] += gain * level * attack * Math.exp(-decay * t) * Math.sin(2 * Math.PI * frequency * ratio * t);
    }
  }
  const fade = Math.round(0.08 * RATE);
  for (let i = 0; i < fade; i++) samples[samples.length - 1 - i] *= i / fade;
  const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0); data.writeUInt32LE(36 + samples.length * 2, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(RATE, 24); data.writeUInt32LE(RATE * 2, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, i) => data.writeInt16LE(Math.round((value / peak) * 0.5 * 32767), 44 + i * 2));
  return data;
}

const root = new URL('../lib/notify/', import.meta.url);
mkdirSync(root, { recursive: true });
for (const [name, sound] of Object.entries(SOUNDS)) writeFileSync(new URL(`${name}.wav`, root), render(sound));
