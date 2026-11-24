import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSoundStore, MAX_CLIP_SECONDS } from '../lib/sound-store.mjs';
import { installSoundRoutes } from '../lib/sound-routes.mjs';

const temp = () => mkdtempSync(join(tmpdir(), 'dpt-sounds-'));

async function serverWith(store) {
  let handler;
  const ctx = { logger: { warn() {} }, get: () => ({ register(route) { handler = route.handler; return () => {}; } }) };
  const off = installSoundRoutes(ctx, store);
  const server = createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { base: 'http://127.0.0.1:' + server.address().port, stop: async () => { await new Promise(r => server.close(r)); off(); } };
}

const upload = async (base, bytes, ext = '.wav') => {
  const response = await fetch(base + '/deep-ptc/sounds/upload?ext=' + ext, { method: 'POST', body: bytes });
  return { status: response.status, body: await response.json() };
};
const save = async (base, body) => {
  const response = await fetch(base + '/deep-ptc/sounds/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};

test('the store keeps sounds on disk across reloads', () => {
  const directory = temp();
  const store = createSoundStore({ directory });
  const id = 'aaaaaaaa-1111-2222-3333-444444444444';
  const temporary = store.tempPath(id, '.wav');
  writeFileSync(temporary, Buffer.alloc(64, 3));
  const saved = store.save({ id, extension: '.wav', name: '  我的提示音 ', start: 0.5, end: 4, duration: 12 });
  assert.equal(saved.name, '我的提示音');
  assert.equal(saved.start, 0.5);
  assert.equal(createSoundStore({ directory }).list().length, 1, 'a fresh store reads the same index');
  assert.equal(store.rename(id, '铃声').name, '铃声');
  assert.equal(store.trim(id, 1, 2).end, 2);
  assert.equal(store.remove(id), true);
  assert.equal(store.list().length, 0);
  assert.deepEqual(readdirSync(join(directory, 'incoming')), [], 'no upload is left behind');
  assert.match(readFileSync(store.index, 'utf8'), /"sounds": \[\]/u);
});

test('the route uploads, saves, streams with ranges and deletes', async () => {
  const directory = temp();
  const store = createSoundStore({ directory });
  const { base, stop } = await serverWith(store);
  try {
    const listed = await (await fetch(base + '/deep-ptc/sounds/list')).json();
    assert.deepEqual(listed.sounds, []);
    assert.equal(listed.limits.maxClipSeconds, MAX_CLIP_SECONDS);

    const bytes = Buffer.alloc(2048, 9);
    const up = await upload(base, bytes);
    assert.equal(up.status, 200);
    const id = up.body.id;

    const tooLong = await save(base, { id, extension: '.wav', name: 'x', start: 0, end: MAX_CLIP_SECONDS + 5, duration: 120 });
    assert.equal(tooLong.status, 400, 'a clip longer than the limit is refused');

    const ok = await save(base, { id, extension: '.wav', name: '提示', start: 1, end: 3.5, duration: 60 });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.sound.end, 3.5);

    const full = await fetch(base + '/deep-ptc/sounds/clip/' + id);
    assert.equal(full.status, 200);
    assert.equal((await full.arrayBuffer()).byteLength, 2048);
    const part = await fetch(base + '/deep-ptc/sounds/clip/' + id, { headers: { range: 'bytes=10-19' } });
    assert.equal(part.status, 206);
    assert.equal((await part.arrayBuffer()).byteLength, 10);

    const renamed = await (await fetch(base + '/deep-ptc/sounds/rename', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, name: '新名字' }) })).json();
    assert.equal(renamed.sound.name, '新名字');

    const removed = await fetch(base + '/deep-ptc/sounds/item/' + id, { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.deepEqual((await (await fetch(base + '/deep-ptc/sounds/list')).json()).sounds, []);
  } finally { await stop(); }
});

test('unsupported formats and discarded uploads leave nothing behind', async () => {
  const directory = temp();
  const store = createSoundStore({ directory });
  const { base, stop } = await serverWith(store);
  try {
    assert.equal((await upload(base, Buffer.from('x'), '.exe')).status, 415);
    const up = await upload(base, Buffer.from('abcd'), '.mp3');
    assert.equal(up.status, 200);
    const discard = await fetch(base + '/deep-ptc/sounds/discard', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: up.body.id, extension: '.mp3' }) });
    assert.equal((await discard.json()).removed, true);
    assert.deepEqual(readdirSync(join(directory, 'incoming')), []);
  } finally { await stop(); }
});
