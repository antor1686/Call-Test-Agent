// Item broadcast for Key Mapper (agent side): tells background.js which item this tab is on,
// so it can publish it to the shared ntfy topic. Read-only: never clicks anything.
(() => {
  const SA = /superannotate\.com/i;
  const anc = Array.from(location.ancestorOrigins || []);
  if (!SA.test(location.href) && !anc.some(o => SA.test(o))) return;

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

  let last = null;
  setInterval(() => {
    const item = detectItem();
    if (!item || item === last) return;
    last = item;
    try { chrome.runtime.sendMessage({ type: 'itemcast', item }).catch(() => {}); } catch (e) { /* reloaded */ }
  }, 3000);
})();
