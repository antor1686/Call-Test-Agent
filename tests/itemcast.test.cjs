const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const settle = () => new Promise(resolve => setImmediate(resolve));
function harness() {
  const listeners = [], posts = [];
  let topic = 'test-one', ok = true, now = 1000000;
  const context = vm.createContext({
    chrome: {
      tabs: { onRemoved: { addListener() {} } },
      runtime: { onMessage: { addListener: fn => listeners.push(fn) } },
      storage: { sync: { get: async () => ({ kmTopic: topic }) } }
    },
    fetch: async (url, options) => { posts.push({ url, options }); return { ok, status: ok ? 200 : 503 }; },
    Date: { now: () => now }, AbortSignal
  });
  vm.runInContext(read('background.js').split('const lastCast = new Map();')[1].replace(/^/, 'const lastCast = new Map();'), context);
  return { posts, send: () => listeners[0]({ type: 'itemcast', item: 'travel__one' }, { tab: { id: 1 } }), topic: value => topic = value, ok: value => ok = value, advance: value => now += value };
}
test('same item retries after HTTP failure and deduplicates only after success', async () => {
  const h = harness(); h.ok(false); h.send(); await settle();
  h.ok(true); h.send(); await settle(); h.send(); await settle();
  assert.equal(h.posts.length, 2);
});
test('topic change and one-minute freshness renewal republish unchanged item', async () => {
  const h = harness(); h.send(); await settle();
  h.topic('test-two'); h.send(); await settle();
  h.advance(60000); h.send(); await settle();
  assert.equal(h.posts.length, 3);
  assert.equal(h.posts[1].url, 'https://ntfy.sh/test-two');
});
test('content keeps heartbeating an unchanged item so background can retry', () => {
  let tick, calls = 0;
  vm.runInNewContext(read('itemcast.js'), {
    URL, location: { href: 'https://app.superannotate.com/editor', ancestorOrigins: [] },
    document: { body: { innerText: 'travel · travel__one' } },
    chrome: { runtime: { sendMessage: () => { calls++; return Promise.resolve(); } } },
    setInterval: fn => tick = fn
  });
  tick(); tick(); assert.equal(calls, 2);
});
