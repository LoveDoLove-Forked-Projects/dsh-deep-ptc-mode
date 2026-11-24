// The plugin's own HTTP route for alert sounds: /deep-ptc/sounds/…
//
// The settings page (a web view in the desktop app as well) picks a file, uploads the bytes with a
// real progress bar, previews the clip and saves the trim. Files land in the host store; the desktop
// host plays them itself, and the web client reads them back from here.

import { createReadStream, createWriteStream, unlinkSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { MAX_CLIP_SECONDS, MAX_SOUND_BYTES, MIN_CLIP_SECONDS, SOUND_EXTENSIONS } from './sound-store.mjs';

const PREFIX = '/deep-ptc/sounds';
const MIME = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4' };
const MAX_JSON = 64 * 1024;

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_JSON) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (error) { reject(error); } });
    req.on('error', reject);
  });
}

async function streamFile(store, id, req, res) {
  const row = store.fileOf(id);
  if (row === undefined) return json(res, 404, { error: 'unknown sound' });
  const { size } = await stat(row.path);
  const type = MIME[row.file.slice(row.file.lastIndexOf('.'))] ?? 'application/octet-stream';
  const range = typeof req.headers.range === 'string' ? /^bytes=(\d*)-(\d*)$/u.exec(req.headers.range) : null;
  if (range !== null) {
    const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
    const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
    if (!(start <= end && start < size)) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + size });
      return res.end();
    }
    res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Accept-Ranges': 'bytes' });
    return createReadStream(row.path, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes' });
  return createReadStream(row.path).pipe(res);
}

async function upload(store, req, res, url) {
  const ext = String(url.searchParams.get('ext') ?? '').toLowerCase();
  if (!SOUND_EXTENSIONS.includes(ext)) return json(res, 415, { error: 'unsupported format' });
  const id = randomUUID();
  const path = store.tempPath(id, ext);
  const out = createWriteStream(path);
  let size = 0;
  let refused;
  try {
    await new Promise((resolve, reject) => {
      req.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_SOUND_BYTES) { refused = 'file too large'; req.unpipe(out); out.destroy(); req.destroy(); resolve(); }
      });
      out.on('error', reject);
      req.on('error', reject);
      out.on('finish', resolve);
      req.pipe(out);
    });
  } catch (error) {
    try { out.destroy(); unlinkSync(path); } catch { /* nothing written */ }
    return json(res, 400, { error: error.message });
  }
  if (refused !== undefined) {
    try { unlinkSync(path); } catch { /* nothing written */ }
    return json(res, 413, { error: refused });
  }
  return json(res, 200, { id, ext, size });
}

async function save(store, req, res) {
  let body;
  try { body = await readJson(req); } catch (error) { return json(res, 400, { error: error.message }); }
  try {
    const entry = store.save(body);
    return json(res, 200, { sound: entry });
  } catch (error) { return json(res, error.code === 'ENOENT' ? 404 : 400, { error: error.message }); }
}

async function serve(store, req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const suffix = url.pathname.startsWith(PREFIX) ? url.pathname.slice(PREFIX.length) || '/' : url.pathname;
  const method = req.method ?? 'GET';
  if (method === 'GET' && suffix === '/list') {
    return json(res, 200, { sounds: store.list().map(({ path: _path, ...row }) => row),
      limits: { maxBytes: MAX_SOUND_BYTES, extensions: SOUND_EXTENSIONS, maxClipSeconds: MAX_CLIP_SECONDS, minClipSeconds: MIN_CLIP_SECONDS } });
  }
  if (method === 'GET' && suffix.startsWith('/clip/')) return streamFile(store, suffix.slice('/clip/'.length), req, res);
  if (method === 'GET' && suffix.startsWith('/source/')) return streamFile(store, suffix.slice('/source/'.length), req, res);
  if (method === 'POST' && suffix === '/upload') return upload(store, req, res, url);
  if (method === 'POST' && suffix === '/save') return save(store, req, res);
  if (method === 'POST' && suffix === '/rename') {
    let body;
    try { body = await readJson(req); } catch (error) { return json(res, 400, { error: error.message }); }
    const row = store.rename(body.id, body.name);
    return row === undefined ? json(res, 404, { error: 'unknown sound' }) : json(res, 200, { sound: row });
  }
  if (method === 'POST' && suffix === '/trim') {
    let body;
    try { body = await readJson(req); } catch (error) { return json(res, 400, { error: error.message }); }
    try {
      const row = store.trim(body.id, body.start, body.end);
      return row === undefined ? json(res, 404, { error: 'unknown sound' }) : json(res, 200, { sound: row });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && suffix === '/discard') {
    let body;
    try { body = await readJson(req); } catch (error) { return json(res, 400, { error: error.message }); }
    return json(res, 200, { removed: store.discard(String(body.id ?? ''), String(body.extension ?? '')) });
  }
  if (method === 'DELETE' && suffix.startsWith('/item/')) {
    return store.remove(suffix.slice('/item/'.length)) ? json(res, 200, { removed: true }) : json(res, 404, { error: 'unknown sound' });
  }
  return json(res, 404, { error: 'not found' });
}

/** Register the route when the web server exists; other transports simply keep the sounds on disk. */
export function installSoundRoutes(ctx, store, { logger = ctx.logger } = {}) {
  const server = ctx.get?.('webServer');
  if (typeof server?.register !== 'function') return () => {};
  const handler = (req, res) => { serve(store, req, res).catch(error => {
    logger?.warn?.('Deep PTC: sound route failed (%s)', error.message);
    if (!res.headersSent) json(res, 500, { error: 'sound route failed' });
    else res.destroy();
  }); };
  return server.register({ kind: 'prefix', path: PREFIX, handler });
}

export { PREFIX as SOUND_ROUTE_PREFIX };
