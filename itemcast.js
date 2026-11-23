// Item broadcast for Key Mapper (agent side): tells background.js which item this tab is on,
// so it can publish it to the shared ntfy topic. Read-only: never clicks anything.
(() => {
  const isSA = (url) => {
    try { const host = new URL(url).hostname; return host === 'superannotate.com' || host.endsWith('.superannotate.com'); }
    catch (_) { return false; }
  };
  const anc = Array.from(location.ancestorOrigins || []);
  if (!isSA(location.href) && !anc.some(isSA)) return;

  const ITEM_RE = /\b[a-z0-9]+(?:_[a-z0-9]+)*__[a-z0-9]+(?:_[a-z0-9]+)*\b/gi;
  function detectItem() {
    const text = (document.body && document.body.innerText) || '';
    // Header line "travel_hospitality · travel_hospitality__tideglass_passage" wins.
    const h = text.match(/([a-z0-9_]+)\s*·\s*(\1__[a-z0-9_]+)/i);
    if (h) return h[2];
    const counts = {};
    for (const m of text.match(ITEM_RE) || []) counts[m] = (counts[m] || 0) + 1;
    let best = null;
    for (const k in counts) if (!best || counts[k] > counts[best]) best = k;
    return best;
  }

  setInterval(() => {
    const item = detectItem();
    if (!item) return; // background deduplicates; repeat so failures and topic changes recover
    try { chrome.runtime.sendMessage({ type: 'itemcast', item }).catch(() => {}); } catch (e) { /* reloaded */ }
  }, 3000);
})();
