const DEFAULTS = {
  runPrefix: 'Run ',
  callText: 'Call',
  triggerTexts: 'CustomerInCall',
  optionTexts: 'StartTranscription',
  uploadingTexts: 'Sending the agent recording, Collecting the agent',
  readyTexts: 'ready for transcription',
  noStepSeconds: '10',
  // failed call: only when the page shows one of these...
  failTexts: 'call was not saved, Call ended: failed',
  // ...click whichever of these is showing (checked in this order), then call again
  recoverTexts: 'Discard audio, End without saving audio, Return to calls'
};

const TEACH_PROMPTS = {
  dropdown: 'TEACH 1/2: click the STATUS DROPDOWN at the top right (e.g. "CustomerInCall")',
  option: 'TEACH 2/2: now click the OPTION that moves to the next item',
  endcall: 'TEACH: click the red END CALL button'
};

const TICK_MS = 1000;
const END_CONFIRM_TICKS = 3;  // "all done" must hold this many ticks in a row before ending the call
const CALL_RETRY_MS = 45000;  // re-click Call if nobody picked up after this long

let busy = false;
let teach = null;       // { tabId, slots: [...] }
let confirmEnd = null;  // manual mode: { tabId, until }

// auto mode state
const auto = { on: false, tabId: null, phase: 'start', doneTicks: 0, noEndTicks: 0, lastActionAt: 0, inCallSince: 0, ranThisCall: false, timer: null, lastBadge: '' };

const getCfg = () => chrome.storage.sync.get(DEFAULTS);
const getLocalTaught = async () => (await chrome.storage.local.get({ taught: {} })).taught;
async function getTaught() {
  let shared = {};
  try { shared = await (await fetch(chrome.runtime.getURL('mappings.json'))).json(); } catch (e) {}
  return { ...shared, ...(await getLocalTaught()) };
}

async function inject(tabId) {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['lib.js'] });
}
async function run(tabId, frameIds, func, args) {
  const target = frameIds === 'all' ? { tabId, allFrames: true } : { tabId, frameIds };
  return chrome.scripting.executeScript({ target, func, args });
}
async function toast(tabId, msg, kind) {
  try { await run(tabId, [0], (m, k) => HV.toast(m, k), [msg, kind]); } catch (e) { /* not scriptable */ }
}
async function badge(tabId, text, kind) {
  try { await run(tabId, [0], (t, k) => window.HV && HV.badge(t, k), [text, kind]); } catch (e) {}
}

// Look at every frame and boil it down to what matters.
async function look(tabId) {
  const cfg = await getCfg();
  const taught = await getTaught();
  await inject(tabId);
  const scans = (await run(tabId, 'all', (c, t) => HV.scan(c, t), [cfg, taught])).filter(s => s.result);
  const has = key => scans.find(s => s.result[key]);
  const progF = has('progress');
  const prog = progF ? progF.result.progress : null;
  const stepsF = scans.find(s => s.result.steps && s.result.steps.count > 0);
  const steps = stepsF ? stepsF.result.steps : null;
  const out = {
    cfg, taught, prog, steps,
    runF: has('run'),
    recoverF: has('recover'),
    readyF: has('ready'),
    uploading: !!has('uploading'),
    endF: has('endCall'),
    advF: has('optionVisible') || has('dropdown'),
    callF: scans.find(s => s.result.call && s.result.call.enabled),
    noCustomerSteps: !!has('noCustomerSteps'),
    // no steps for me: no Run button, no customer step card, and either no counter, a 0 counter,
    // "customer 0 of 0" or "No customer steps". The agent's progress isn't visible, so use the timer.
    zeroSteps: !has('run') && !(steps && steps.customer > 0) &&
      (!prog || prog.total === 0 || !!scans.find(x => x.result.custTotal === 0) || !!has('noCustomerSteps') || !!has('zeroSteps')),
    // all tool steps finished: counter says N of N, or step cards exist and none is highlighted
    allDone: false // set below
  };
  out.allDone = !out.zeroSteps && !!((prog && prog.total > 0 && prog.done >= prog.total) || (steps && steps.active === 0));
  return out;
}

async function clickIn(tabId, s, frameId, what) {
  const [r] = await run(tabId, [frameId], (c, t, w) => HV.click(c, t, w), [s.cfg, s.taught, what]);
  return r.result;
}
async function advanceIn(tabId, s) {
  const [r] = await run(tabId, [s.advF.frameId], (c, t) => HV.advance(c, t), [s.cfg, s.taught]);
  return r.result;
}

// ---------------- hotkeys ----------------
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  if (command === 'toggle-auto') return auto.on ? stopAuto('Stopped') : startAuto(tab.id);
  if (command !== 'next-step' || busy) return;
  if (auto.on) return toast(tab.id, 'Auto mode is running - press Alt+W to stop it first', 'warn');
  busy = true;
  try { await nextStep(tab.id); } catch (e) { console.error(e); }
  finally { setTimeout(() => { busy = false; }, 700); } // a double-press can't fire the same step twice
});

// ---------------- manual: one step per press ----------------
async function nextStep(tabId) {
  const s = await look(tabId);
  const done = r => toast(tabId, r.msg, r.ok ? 'ok' : 'err');

  if (s.recoverF) return done(await clickIn(tabId, s, s.recoverF.frameId, 'recover'));
  if (s.runF) return done(await clickIn(tabId, s, s.runF.frameId, 'run'));
  if (s.readyF) {
    if (!s.advF) return toast(tabId, 'Upload finished, but the status dropdown was not found. Use "Teach status change" in the popup.', 'err');
    return done(await advanceIn(tabId, s));
  }
  if (s.uploading) return toast(tabId, 'Recording is uploading - press again when it says ready for transcription', 'warn');
  if (s.allDone && s.endF) return done(await clickIn(tabId, s, s.endF.frameId, 'end'));
  if (s.allDone) return toast(tabId, 'All steps done, but the End call button was not found. Use "Teach End call" in the popup.', 'err');
  if (s.callF && !s.prog && !s.endF) return done(await clickIn(tabId, s, s.callF.frameId, 'call'));

  // in a call with no way to tell when the agent is finished: second press ends it
  if (!s.prog && !s.steps && s.endF) {
    if (confirmEnd && confirmEnd.tabId === tabId && Date.now() < confirmEnd.until) {
      confirmEnd = null;
      return done(await clickIn(tabId, s, s.endF.frameId, 'end'));
    }
    confirmEnd = { tabId, until: Date.now() + 3000 };
    return toast(tabId, 'Can\'t see the steps on this item. Once the agent has finished, press again within 3 s to END CALL.', 'warn');
  }
  if (s.prog) return toast(tabId, `Not your turn - waiting for the other side (${s.prog.done}/${s.prog.total} done)`, 'warn');
  if (s.steps) return toast(tabId, 'Not your turn - the other side is on a step', 'warn');
  return toast(tabId, 'Nothing to click right now (waiting for the call to connect?)', 'warn');
}

// ---------------- auto mode ----------------
async function startAuto(tabId) {
  Object.assign(auto, { on: true, tabId, phase: 'start', doneTicks: 0, noEndTicks: 0, lastActionAt: 0, inCallSince: 0, ranThisCall: false, lastBadge: '' });
  await chrome.storage.session.set({ auto: { on: true, tabId } });
  chrome.action.setBadgeText({ text: 'ON' });
  chrome.action.setBadgeBackgroundColor({ color: '#6639ba' });
  chrome.alarms.create('auto-keepalive', { periodInMinutes: 0.5 });
  await badge(tabId, 'Started');
  schedule(0);
}

async function stopAuto(reason, kind) {
  const tabId = auto.tabId;
  auto.on = false;
  clearTimeout(auto.timer);
  await chrome.storage.session.set({ auto: { on: false } });
  chrome.action.setBadgeText({ text: '' });
  chrome.alarms.clear('auto-keepalive');
  if (tabId != null) {
    await badge(tabId, null);
    await toast(tabId, 'Auto mode off: ' + reason, kind || 'warn');
  }
}

function schedule(ms) {
  clearTimeout(auto.timer);
  if (auto.on) auto.timer = setTimeout(tick, ms);
}

async function status(text, kind) {
  if (text === auto.lastBadge) return;
  auto.lastBadge = text;
  await badge(auto.tabId, text, kind);
}

async function tick() {
  if (!auto.on) return;
  const tabId = auto.tabId;
  const now = Date.now();
  try {
    const s = await look(tabId);
    auto.lastBadge = ''; // page may have reloaded; redraw badge
    const fail = msg => stopAuto(msg, 'err');
    // remember when this call connected (End call button appeared)
    if (s.endF && !auto.inCallSince && auto.phase !== 'ended' && auto.phase !== 'advanced') auto.inCallSince = now;

    // 0. failed call (audio not saved): end without saving, discard, return to calls, then call again
    if (s.recoverF) {
      const r = await clickIn(tabId, s, s.recoverF.frameId, 'recover');
      Object.assign(auto, { phase: 'start', inCallSince: 0, ranThisCall: false, doneTicks: 0 });
      await status(r.msg + ' (call failed - redoing it)', r.ok ? 'ok' : 'err');
      return schedule(1500);
    }

    // 1. my turn
    if (s.runF) {
      auto.doneTicks = 0;
      const r = await clickIn(tabId, s, s.runF.frameId, 'run');
      auto.phase = 'inCall';
      auto.ranThisCall = true;
      await status(r.msg, r.ok ? 'ok' : 'err');
      return schedule(1500);
    }

    // 2. upload finished -> change status (only once per item)
    if (s.readyF && auto.phase !== 'advanced') {
      if (!s.advF) return fail('upload finished but the status dropdown was not found. Use "Teach status change" in the popup.');
      const r = await advanceIn(tabId, s);
      if (!r.ok) return fail(r.msg);
      auto.phase = 'advanced';
      auto.lastActionAt = now;
      auto.inCallSince = 0;
      await status(r.msg + ' - waiting for next item', 'ok');
      return schedule(3000);
    }

    // 3. uploading
    if (s.uploading) { await status('Recording uploading…'); return schedule(TICK_MS); }

    // 4. all steps done -> end the call (after it holds for a few ticks)
    if (s.allDone && auto.phase !== 'ended' && auto.phase !== 'advanced') {
      if (!s.endF) {
        if (++auto.noEndTicks >= 10) return fail('all steps done but the End call button was not found. Use "Teach End call" in the popup.');
        await status('All steps done - looking for End call button…');
        return schedule(TICK_MS);
      }
      auto.noEndTicks = 0;
      if (++auto.doneTicks < END_CONFIRM_TICKS) {
        await status(`All steps done - ending call in ${END_CONFIRM_TICKS - auto.doneTicks}s`);
        return schedule(TICK_MS);
      }
      auto.doneTicks = 0;
      const r = await clickIn(tabId, s, s.endF.frameId, 'end');
      auto.phase = 'ended';
      auto.lastActionAt = now;
      auto.inCallSince = 0;
      await status(r.msg + ' - waiting for upload', r.ok ? 'ok' : 'err');
      return schedule(2000);
    }
    auto.doneTicks = 0;
    auto.noEndTicks = 0;

    // 4b. call with no tool steps at all: end it once it has lasted N seconds
    if (s.zeroSteps && !auto.ranThisCall && s.endF && auto.inCallSince && auto.phase !== 'ended' && auto.phase !== 'advanced') {
      const limit = Math.max(0, Number(s.cfg.noStepSeconds) || 0) * 1000;
      const left = Math.ceil((auto.inCallSince + limit - now) / 1000);
      if (left > 0) {
        await status(`No steps on this call - ending call in ${left}s`);
        return schedule(TICK_MS);
      }
      const r = await clickIn(tabId, s, s.endF.frameId, 'end');
      auto.phase = 'ended';
      auto.lastActionAt = now;
      await status(r.msg + ' (no-step call) - waiting for upload', r.ok ? 'ok' : 'err');
      return schedule(2000);
    }

    // 5. start the call (new item, or nobody picked up for a while)
    if (s.callF && !s.endF && !s.readyF) {
      const allowed = auto.phase === 'start' || auto.phase === 'advanced' ||
        (auto.phase === 'calling' && now - auto.lastActionAt > CALL_RETRY_MS);
      if (allowed) {
        const r = await clickIn(tabId, s, s.callF.frameId, 'call');
        auto.phase = 'calling';
        auto.lastActionAt = now;
        auto.inCallSince = 0;
        auto.ranThisCall = false;
        await status(r.msg + ' - waiting for the agent to pick up', r.ok ? 'ok' : 'err');
        return schedule(2000);
      }
    }

    // 6. waiting
    if (s.endF && auto.phase === 'calling') auto.phase = 'inCall';
    let msg;
    if (auto.phase === 'advanced') {
      msg = now - auto.lastActionAt > 60000 ? 'Still waiting for the next item - check the page' : 'Waiting for the next item / Call button…';
    } else if (auto.phase === 'ended') msg = 'Call ended - waiting for upload…';
    else if (auto.phase === 'calling') msg = 'Calling - waiting for the agent to pick up… (already connected? then the End call button was not found: use Teach End call)';
    else if (s.prog) msg = `Agent's turn (${s.prog.done}/${s.prog.total} done)`;
    else if (s.steps) msg = 'Agent is on a step - waiting…';
    else if (s.endF) msg = 'In call - waiting for steps…';
    else msg = 'Waiting…';
    await status(msg);
    schedule(TICK_MS);
  } catch (e) {
    // page reloading / navigating between items: just try again
    await status('Page busy, retrying… (' + String(e.message || e).slice(0, 60) + ')');
    schedule(2000);
  }
}

// ---------------- update notice ----------------
const REPO_MANIFEST = 'https://raw.githubusercontent.com/antor1686/Call-Test-Agent/main/manifest.json';
const newer = (a, b) => { // is version a newer than b?
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
async function checkForUpdate() {
  try {
    const latest = (await (await fetch(REPO_MANIFEST + '?t=' + Date.now(), { cache: 'no-store' })).json()).version;
    if (newer(latest, chrome.runtime.getManifest().version) && !auto.on) {
      chrome.action.setBadgeText({ text: 'NEW' });
      chrome.action.setBadgeBackgroundColor({ color: '#1a7f37' });
      chrome.action.setTitle({ title: 'Update available - open the popup and click Update now' });
    }
  } catch (e) { /* offline */ }
}
chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('update-check', { periodInMinutes: 180 }); checkForUpdate(); });
chrome.runtime.onStartup.addListener(checkForUpdate);

// keep the loop alive if Chrome restarts the background worker
chrome.alarms.onAlarm.addListener(async a => {
  if (a.name === 'update-check') return checkForUpdate();
  if (a.name !== 'auto-keepalive') return;
  if (!auto.on) {
    const { auto: saved } = await chrome.storage.session.get({ auto: { on: false } });
    if (saved.on) { Object.assign(auto, { on: true, tabId: saved.tabId, phase: 'start' }); schedule(0); }
    else chrome.alarms.clear('auto-keepalive');
  }
});
chrome.tabs.onRemoved.addListener(tabId => { if (auto.on && tabId === auto.tabId) stopAuto('tab closed'); });

// ---------------- popup + teach mode ----------------
async function armNext() {
  if (!teach || !teach.slots.length) return;
  const slot = teach.slots[0];
  await inject(teach.tabId);
  await run(teach.tabId, 'all', s => HV.arm(s), [slot]);
  await toast(teach.tabId, TEACH_PROMPTS[slot], 'info');
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'auto-status') {
    sendResponse({ on: auto.on, phase: auto.phase });
    return;
  }
  if (msg.type === 'auto-toggle') {
    (auto.on ? stopAuto('Stopped') : startAuto(msg.tabId)).then(() => sendResponse({ on: auto.on }));
    return true;
  }
  if (msg.type === 'teach') {
    teach = { tabId: msg.tabId, slots: msg.slots.slice() };
    armNext().then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'taught' && teach && sender.tab && sender.tab.id === teach.tabId) {
    const slot = teach.slots.shift();
    if (!slot) return;
    (async () => {
      const taught = await getLocalTaught();
      taught[slot] = msg.desc;
      await chrome.storage.local.set({ taught });
      await run(teach.tabId, 'all', () => window.HV && HV.disarm(), []);
      if (teach.slots.length) {
        setTimeout(armNext, 150); // let the dropdown open first
      } else {
        await toast(teach.tabId, 'Learned! You can use the hotkey now.', 'ok');
        teach = null;
      }
    })();
  }
});

// ---------------- Key Mapper link: publish the current item ----------------
// The agent's Key Mapper extension reads this topic and switches to the same item when idle.
// Only the item name is sent, to https://ntfy.sh/<kmTopic>. Empty topic = off.
const lastCast = new Map(); // tabId -> last successful { topic, item, at }
const castPending = new Set();
const CAST_REFRESH_MS = 60000;
chrome.tabs.onRemoved.addListener(tabId => { lastCast.delete(tabId); });
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'itemcast' || !sender.tab ||
      typeof msg.item !== 'string' || !/^[a-z0-9]+(?:_[a-z0-9]+)*__[a-z0-9_]+$/i.test(msg.item)) return;
  const tabId = sender.tab.id;
  if (castPending.has(tabId)) return;
  castPending.add(tabId);
  (async () => {
    const { kmTopic } = await chrome.storage.sync.get({ kmTopic: '' });
    if (!kmTopic) return;
    const previous = lastCast.get(tabId);
    if (previous && previous.topic === kmTopic && previous.item === msg.item &&
        Date.now() - previous.at < CAST_REFRESH_MS) return;
    const response = await fetch('https://ntfy.sh/' + encodeURIComponent(kmTopic), {
      method: 'POST',
      body: JSON.stringify({ v: 1, item: msg.item, company: msg.item.split('__')[0], t: Date.now() }),
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) throw new Error('Item broadcast HTTP ' + response.status);
    lastCast.set(tabId, { topic: kmTopic, item: msg.item, at: Date.now() });
  })().catch(() => { /* Next content heartbeat retries; never log the private topic. */ })
    .finally(() => castPending.delete(tabId));
});
