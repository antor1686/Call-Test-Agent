const DEFAULTS = {
  runPrefix: 'Run ',
  callText: 'Call',
  triggerTexts: 'CustomerInCall',
  optionTexts: 'StartTranscription',
  uploadingTexts: 'Sending the agent recording, Collecting the agent',
  readyTexts: 'ready for transcription',
  noStepSeconds: '10'
};
const keys = Object.keys(DEFAULTS);
const $ = id => document.getElementById(id);
const readCfg = () => { const c = {}; keys.forEach(k => { c[k] = $(k).value; }); return c; };
const activeTab = async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0];

chrome.storage.sync.get(DEFAULTS).then(cfg => keys.forEach(k => { $(k).value = cfg[k]; }));

const getShared = async () => { try { return await (await fetch(chrome.runtime.getURL('mappings.json'))).json(); } catch (e) { return {}; } };
async function showLearned() {
  const { taught } = await chrome.storage.local.get({ taught: {} });
  const shared = await getShared();
  for (const s of ['dropdown', 'option', 'endcall']) {
    const el = $('l_' + s);
    const d = taught[s] || shared[s];
    el.textContent = taught[s] ? 'learned ✓' : shared[s] ? 'shared ✓' : 'not set';
    el.className = d ? 'yes' : 'no';
    if (d) el.title = JSON.stringify(d, null, 1);
  }
}

// Writes the taught buttons into mappings.json in the extension folder (via the updater helper),
// so they ship to everyone with the next push + update.
$('share').onclick = async () => {
  const { taught } = await chrome.storage.local.get({ taught: {} });
  const all = {};
  for (const [slot, d] of Object.entries({ ...(await getShared()), ...taught })) {
    if (!['dropdown', 'option', 'endcall'].includes(slot)) continue;
    const { frame, path, ...rest } = d; // keep site addresses and page structure out of the public file
    all[slot] = rest;
  }
  if (!Object.keys(all).length) return ($('shareMsg').textContent = 'Nothing taught yet.');
  try {
    const r = await chrome.runtime.sendNativeMessage('com.calltestagent.updater', { cmd: 'save-mappings', data: all });
    $('shareMsg').textContent = r && r.ok
      ? 'Saved to mappings.json. Push it to GitHub (raise the version) and everyone gets it on their next update.'
      : 'Could not save: ' + ((r && r.error) || 'no reply');
  } catch (e) {
    $('shareMsg').textContent = 'One-click updates are not turned on yet - use the button under Updates first.'; showSetup();
  }
};
showLearned();

chrome.commands.getAll().then(cmds => {
  const get = n => { const c = cmds.find(x => x.name === n); return (c && c.shortcut) || 'not set'; };
  $('key').textContent = get('next-step');
  $('keyAuto').textContent = get('toggle-auto');
});

const showAuto = on => {
  $('auto').textContent = on ? 'Stop auto mode' : 'Start auto mode';
  $('auto').classList.toggle('on', on);
};
chrome.runtime.sendMessage({ type: 'auto-status' }).then(r => showAuto(r && r.on));
$('auto').onclick = async () => {
  const tab = await activeTab();
  const r = await chrome.runtime.sendMessage({ type: 'auto-toggle', tabId: tab.id });
  showAuto(r && r.on);
  if (r && r.on) window.close();
};

$('shortcuts').onclick = e => { e.preventDefault(); chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }); };

$('noStepSeconds').onchange = () => chrome.storage.sync.set({ noStepSeconds: $('noStepSeconds').value });
chrome.storage.sync.get({ kmTopic: '' }).then(c => { $('kmTopic').value = c.kmTopic; });
$('kmTopic').onchange = () => chrome.storage.sync.set({ kmTopic: $('kmTopic').value.trim() });

$('save').onclick = async () => {
  await chrome.storage.sync.set(readCfg());
  $('saved').textContent = 'Saved.';
  setTimeout(() => { $('saved').textContent = ''; }, 1500);
};

async function startTeach(slots) {
  const tab = await activeTab();
  const r = await chrome.runtime.sendMessage({ type: 'teach', tabId: tab.id, slots });
  if (r && r.ok) window.close();
  else { $('out').hidden = false; $('out').textContent = 'Could not start teach mode: ' + (r && r.error); }
}
$('teachStatus').onclick = () => startTeach(['dropdown', 'option']);
$('teachEnd').onclick = () => startTeach(['endcall']);

$('forget').onclick = async () => { await chrome.storage.local.set({ taught: {} }); showLearned(); };

$('scan').onclick = async () => {
  const out = $('out');
  out.hidden = false;
  try {
    const tab = await activeTab();
    const { taught } = await chrome.storage.local.get({ taught: {} });
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['lib.js'] });
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: (c, t) => HV.scan(c, t),
      args: [readCfg(), taught]
    });
    out.textContent = res.filter(r => r.result)
      .map(r => `frame ${r.frameId}: ${JSON.stringify(r.result, null, 1)}`).join('\n\n');
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
};

// ---------- updates ----------
const REPO_MANIFEST = 'https://raw.githubusercontent.com/antor1686/Call-Test-Agent/main/manifest.json';
const newer = (a, b) => { // is version a newer than b?
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
const current = chrome.runtime.getManifest().version;

// One-time setup of the updater helper: copy a command the user pastes into Win+R.
const SETUP_CMD = 'powershell -ExecutionPolicy Bypass -c "iwr -useb https://raw.githubusercontent.com/antor1686/Call-Test-Agent/main/setup.ps1 | iex"';
const showSetup = () => { $('setupBox').hidden = false; };
$('copySetup').onclick = async () => {
  await navigator.clipboard.writeText(SETUP_CMD);
  $('setupHint').innerHTML = '<b>Copied.</b> Press <b>Win + R</b>, then <b>Ctrl + V</b>, then <b>Enter</b>. Reopen this popup when the window says "All set".';
};
// any reply (even "unknown command") means the helper is installed
chrome.runtime.sendNativeMessage('com.calltestagent.updater', { cmd: 'ping' }).catch(showSetup);
$('ver').textContent = current;
$('extId').textContent = chrome.runtime.id;
$('copyId').onclick = e => { e.preventDefault(); navigator.clipboard.writeText(chrome.runtime.id); $('copyId').textContent = 'copied'; };

const getLatest = async () => (await (await fetch(REPO_MANIFEST + '?t=' + Date.now(), { cache: 'no-store' })).json()).version;
getLatest().then(latest => {
  if (newer(latest, current)) {
    $('update').textContent = `Update now to ${latest}`;
    $('update').classList.add('autobtn');
    $('updMsg').textContent = 'A new version is available.';
  }
}).catch(() => {});

$('update').onclick = async () => {
  const msg = t => { $('updMsg').textContent = t; };
  try {
    msg('Checking…');
    const latest = await getLatest();
    if (!newer(latest, current)) return msg(`You have the latest version (${current}).`);
    msg(`Updating ${current} → ${latest}…`);
    const r = await chrome.runtime.sendNativeMessage('com.calltestagent.updater', { cmd: 'update' });
    if (!r || !r.ok) return msg('Update failed: ' + ((r && r.error) || 'no reply'));
    msg(`Updated to ${r.version}. Reloading…`);
    setTimeout(() => chrome.runtime.reload(), 600);
  } catch (e) {
    if (/native messaging host not found/i.test(e.message)) { showSetup(); msg('One-click updates are not turned on yet - use the button below once.'); }
    else msg('Update failed: ' + e.message);
  }
};
