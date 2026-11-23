// Operate the virtual DSH's web interface the way a user does: open it, read what is on screen, click,
// type, take a screenshot. A headless Edge, Chrome or Chromium already on the machine is driven over the
// DevTools protocol, so nothing has to be installed. Its profile lives in the virtual DSH's own directory
// and goes away with it.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { killTree } from './preview.mjs';

const ORIGIN = 'http://127.0.0.1';
const VIEW = { width: 1280, height: 860 };
const MAX_TEXT = 5000;
const pause = ms => new Promise(done => setTimeout(done, ms));

/** A Chromium-family browser on this machine, or undefined. */
export function findBrowser({ env = process.env, platform = process.platform, exists = existsSync } = {}) {
  const candidates = [env.DEEP_PTC_BROWSER];
  if (platform === 'win32') {
    for (const base of [env['ProgramFiles(x86)'], env.ProgramFiles, env.LOCALAPPDATA].filter(Boolean)) {
      candidates.push(join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    }
  } else if (platform === 'darwin') {
    for (const name of ['Google Chrome', 'Microsoft Edge', 'Chromium']) candidates.push(`/Applications/${name}.app/Contents/MacOS/${name}`);
  } else {
    for (const dir of (env.PATH ?? '').split(delimiter).filter(Boolean)) for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) candidates.push(join(dir, name));
  }
  return candidates.find(file => file && exists(file));
}

// ---- DevTools protocol ------------------------------------------------------------------------

function session(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { origin: ORIGIN } });
    const calls = new Map();
    let next = 0;
    const closed = new Set();
    socket.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((done, fail) => {
          const id = ++next;
          const timer = setTimeout(() => { calls.delete(id); fail(new Error(`${method} timed out`)); }, 20_000);
          calls.set(id, { done: value => { clearTimeout(timer); done(value); }, fail: error => { clearTimeout(timer); fail(error); } });
          socket.send(JSON.stringify({ id, method, params }));
        });
      },
      onClose: listener => closed.add(listener),
      close() { try { socket.close(); } catch { /* gone */ } },
    });
    socket.onerror = () => reject(new Error('The browser refused the DevTools connection'));
    socket.onclose = () => {
      for (const call of calls.values()) call.fail(new Error('The browser closed'));
      calls.clear();
      for (const listener of closed) listener();
    };
    socket.onmessage = ({ data }) => {
      let message;
      try { message = JSON.parse(data); } catch { return; }
      const call = calls.get(message.id);
      if (call === undefined) return;
      calls.delete(message.id);
      if (message.error) call.fail(new Error(message.error.message)); else call.done(message.result);
    };
  });
}

// ---- In the page ------------------------------------------------------------------------------

// Visible controls get a reference that stays until the next read, and the text of the main area is
// read from its end, where a conversation's newest content is.
/* c8 ignore start -- runs in the browser */
function pageRead(limit) {
  const shown = element => { const box = element.getBoundingClientRect(); const style = getComputedStyle(element); return box.width > 1 && box.height > 1 && style.visibility !== 'hidden' && style.display !== 'none'; };
  const nameOf = element => (element.getAttribute('aria-label') || element.labels?.[0]?.innerText || element.innerText || element.placeholder || element.title || '').replace(/\s+/gu, ' ').trim().slice(0, 90);
  document.querySelectorAll('[data-dpt-ref]').forEach(element => element.removeAttribute('data-dpt-ref'));
  const elements = [];
  for (const element of document.querySelectorAll('button,a[href],input,textarea,select,[role=button],[role=tab],[role=menuitem],[role=treeitem],[role=switch],[role=checkbox],[role=radio],[contenteditable=true],[role=textbox]')) {
    if (elements.length >= 120) break;
    if (!shown(element) || element.closest('[aria-hidden=true]')) continue;
    const ref = 'e' + (elements.length + 1);
    element.setAttribute('data-dpt-ref', ref);
    const state = [element.disabled || element.getAttribute('aria-disabled') === 'true' ? 'disabled' : '',
      ['true', 'mixed'].includes(element.getAttribute('aria-checked')) || element.checked ? 'checked' : '',
      element.getAttribute('aria-selected') === 'true' ? 'selected' : '', element.getAttribute('aria-expanded') === 'true' ? 'expanded' : ''].filter(Boolean).join(' ');
    const value = typeof element.value === 'string' && element.tagName !== 'BUTTON' ? element.value.slice(0, 80) : '';
    elements.push([ref, element.getAttribute('role') || element.tagName.toLowerCase(), nameOf(element), state, value].filter((part, index) => index < 3 || part).join(' | '));
  }
  const main = document.querySelector('[data-slot="main.conversation"]') || document.querySelector('main') || document.body;
  const dialog = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].filter(shown).map(element => element.innerText.trim()).join('\n').slice(0, 1500);
  const text = main.innerText.replace(/\n{3,}/gu, '\n\n').trim();
  return { title: document.title, ...dialog ? { dialog } : {}, text: text.length > limit ? '…' + text.slice(-limit) : text, elements };
}
function pagePoint({ ref, text }) {
  const shown = element => { const box = element.getBoundingClientRect(); return box.width > 1 && box.height > 1; };
  let element = ref ? document.querySelector(`[data-dpt-ref="${CSS.escape(ref)}"]`) : undefined;
  if (!element && text) {
    const want = text.replace(/\s+/gu, ' ').trim();
    const rows = [...document.querySelectorAll('button,a,input,textarea,select,[role],label,summary,[contenteditable=true]')].filter(shown)
      .map(node => ({ node, name: (node.getAttribute('aria-label') || node.innerText || node.placeholder || '').replace(/\s+/gu, ' ').trim() }));
    element = (rows.find(row => row.name === want) ?? rows.filter(row => row.name.includes(want)).sort((a, b) => a.name.length - b.name.length)[0])?.node;
  }
  if (!element) return null;
  element.scrollIntoView({ block: 'center', inline: 'center' });
  const box = element.getBoundingClientRect();
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, tag: element.tagName, editable: element.isContentEditable || /^(INPUT|TEXTAREA)$/u.test(element.tagName) };
}
async function pageOpenSession(id) {
  const wait = ms => new Promise(done => setTimeout(done, ms));
  // A fresh home shows a first-run notice over the page.
  for (const dialog of document.querySelectorAll('[role=dialog],[role=alertdialog]')) { const buttons = dialog.querySelectorAll('button'); if (buttons.length === 1) buttons[0].click(); }
  if (!id) return true;
  for (let attempt = 0; attempt < 12; attempt++) {
    const row = document.querySelector(`[data-row-key="session:${CSS.escape(id)}"]`);
    if (row) { row.click(); await wait(600); return true; }
    for (const group of document.querySelectorAll('[role=treeitem][data-row-key^="workspace:"][aria-expanded=false]')) group.click();
    await wait(350);
  }
  return false;
}
/* c8 ignore stop */

const KEYS = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Space: 32 };

/**
 * The interface of the running virtual DSH.
 * @param current - returns `{ url, root }` of the running virtual DSH, or throws.
 */
export function createUi(current, options = {}) {
  let browser;
  const start = options.spawn ?? spawn;

  async function launch(root) {
    const file = options.browser ?? findBrowser();
    if (file === undefined) throw new Error('No Edge, Chrome or Chromium was found on this machine. Test with chat instead, or set DEEP_PTC_BROWSER to a Chromium-based browser.');
    const home = join(root, 'tmp', 'browser');
    rmSync(home, { recursive: true, force: true });
    mkdirSync(home, { recursive: true });
    const child = start(file, ['--headless=new', '--remote-debugging-port=0', `--remote-allow-origins=${ORIGIN}`, `--user-data-dir=${home}`, '--no-first-run', '--no-default-browser-check',
      '--disable-extensions', '--disable-sync', '--mute-audio', `--window-size=${VIEW.width},${VIEW.height}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
    let failed;
    child.on('error', error => { failed = error; });
    for (let attempt = 0; attempt < 80; attempt++) {
      if (failed) throw new Error(`The browser did not start: ${failed.message}`);
      let port;
      try { port = Number(readFileSync(join(home, 'DevToolsActivePort'), 'utf8').split(/\r?\n/u)[0]); } catch { /* not yet */ }
      if (port) {
        try {
          const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
          const page = pages.find(row => row.type === 'page');
          if (page) {
            const cdp = await session(page.webSocketDebuggerUrl);
            await cdp.send('Page.enable');
            await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEW, deviceScaleFactor: 1, mobile: false });
            return { child, cdp, root, url: undefined };
          }
        } catch (error) { if (attempt > 60) throw error; }
      }
      await pause(150);
    }
    killTree(child.pid);
    throw new Error('The browser started but did not answer.');
  }
  async function evaluate(fn, argument) {
    const { result, exceptionDetails } = await browser.cdp.send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(argument ?? null)})`, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description?.split('\n')[0] ?? exceptionDetails.text);
    return result.value;
  }
  async function ready() {
    const { url, root } = current();
    if (browser !== undefined && browser.root !== root) close();
    if (browser === undefined) {
      const started = await launch(root);
      browser = started;
      started.cdp.onClose(() => { if (browser === started) browser = undefined; });
    }
    // A restart hands out a new address: load it again.
    if (browser.url !== url) await load(url);
  }
  async function load(url) {
    await browser.cdp.send('Page.navigate', { url });
    browser.url = url;
    for (let attempt = 0; attempt < 60; attempt++) {
      await pause(250);
      if (await evaluate('() => document.readyState === "complete" && document.body.innerText.trim().length > 40').catch(() => false)) break;
    }
    await pause(600);
    await evaluate(pageOpenSession, '');
  }
  const read = async () => { await pause(350); return evaluate(pageRead, MAX_TEXT); };
  async function pointAt(target) {
    const point = await evaluate(pagePoint, target);
    if (point === null) throw new Error(`Nothing on screen matches ${JSON.stringify(target.ref ?? target.text)}. Read the page again: references change with every read.`);
    return point;
  }
  async function click(target) {
    const point = await pointAt(target);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) {
      await browser.cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 });
    }
  }
  async function press(key) {
    const code = KEYS[key];
    if (code === undefined) throw new Error(`key: use ${Object.keys(KEYS).join(', ')}`);
    const name = key === 'Space' ? ' ' : key;
    await browser.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: key, windowsVirtualKeyCode: code, ...key === 'Enter' ? { text: '\r' } : key === 'Space' ? { text: ' ' } : {} });
    await browser.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: key, windowsVirtualKeyCode: code });
  }

  function close() {
    const old = browser;
    browser = undefined;
    if (old === undefined) return;
    old.cdp.close();
    if (old.child.pid) killTree(old.child.pid);
  }

  return {
    close,
    /** One step; every step except a screenshot answers with what is on screen afterwards. */
    async step({ do: step = 'read', session: id, ref, text, key }) {
      await ready();
      switch (step) {
        case 'open':
          if (!await evaluate(pageOpenSession, id ?? '')) throw new Error(`The conversation ${id} is not in the sidebar yet.`);
          return read();
        case 'reload': await load(current().url); return read();
        case 'read': return read();
        case 'click': await click({ ref, text }); return read();
        case 'type':
          if (typeof text !== 'string') throw new Error('text: what to type');
          if (ref) await click({ ref });
          await browser.cdp.send('Input.insertText', { text });
          if (key) await press(key);
          return read();
        case 'press': await press(key); return read();
        case 'screenshot': {
          const { data } = await browser.cdp.send('Page.captureScreenshot', { format: 'png' });
          const dir = join(current().root, 'workspace', 'screenshots');
          mkdirSync(dir, { recursive: true });
          const path = join(dir, `ui-${Date.now()}.png`);
          writeFileSync(path, Buffer.from(data, 'base64'));
          return { path, ...VIEW, note: 'Kept until the virtual DSH stops. Copy it elsewhere if the user should keep it.' };
        }
        default: throw new Error('do: open, reload, read, click, type, press or screenshot');
      }
    },
  };
}
