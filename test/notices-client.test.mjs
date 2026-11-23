import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotices } from '../src/client/notices.js';

// The client event service as the host builds it: `$on` registers under a private key, in order.
function client() {
  const hooks = {};
  const key = event => 'internal/api-gateway/remote-event/uuid/' + event;
  const on = (name, callback, options = {}) => {
    const list = hooks[name] ??= [];
    const hook = { callback };
    list[options.prepend ? 'unshift' : 'push'](hook);
    return () => list.splice(list.indexOf(hook), 1);
  };
  const child = { events: { _hooks: hooks }, on, effect: fn => fn(), remote: { $on: (event, listener) => on(key(event), listener) } };
  const dispatch = request => {
    const list = [...hooks[key('user-questions/request')]];
    const next = () => { const hook = list.shift(); return hook ? hook.callback.call({}, request, next) : Promise.resolve('next'); };
    return next();
  };
  return { child, dispatch };
}

test('a mirrored question stays open without reaching the host’s question box; any other question does', async () => {
  const { child, dispatch } = client();
  let drawn = 0;
  child.remote.$on('user-questions/request', async () => { drawn += 1; return 'answered'; });
  createNotices().installNotices(child, { setting: key => key === 'notifyHost' ? 'native' : true, deep: () => true });
  assert.equal(await dispatch({ questions: [{ id: 'plan' }] }), 'answered');
  assert.equal(drawn, 1);
  const controller = new AbortController();
  const held = dispatch({ questions: [{ id: 'dpt:card:a:1:0:plan' }], signal: controller.signal });
  assert.equal(await Promise.race([held, Promise.resolve('open')]), 'open');
  assert.equal(drawn, 1);
  controller.abort();
  await assert.rejects(held, { code: 'ASK_ABORTED' });
});
