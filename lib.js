// Injected into every frame of the page (isolated world) before each action.
// Defines window.HV, which the background / popup then call.
(() => {
  const txt = el => ((el.innerText || el.textContent || el.value || '') + '').replace(/\s+/g, ' ').trim();
  const vis = el => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && parseFloat(s.opacity) > 0.05;
  };
  const isDisabled = el => {
    const s = getComputedStyle(el);
    return !!el.disabled || el.getAttribute('aria-disabled') === 'true' ||
      el.classList.contains('disabled') || s.pointerEvents === 'none' || s.cursor === 'not-allowed';
  };
  const list = v => String(v || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const area = el => { const r = el.getBoundingClientRect(); return r.width * r.height; };
  const BTN = 'button, [role="button"], input[type="button"], input[type="submit"]';

  const buttons = () => [...document.querySelectorAll(BTN)].filter(vis);

  const findText = (texts, exact) => {
    const wanted = list(texts).map(t => t.toLowerCase());
    if (!wanted.length) return null;
    let best = null;
    for (const el of document.querySelectorAll('body *')) {
      if (!vis(el)) continue;
      const t = txt(el).toLowerCase();
      if (!t || t.length > 200) continue;
      if (wanted.some(w => (exact ? t === w : t.includes(w)))) best = el; // later in DOM = deeper
    }
    return best;
  };

  const fire = el => {
    try { el.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    const r = el.getBoundingClientRect();
    const o = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, buttons: 1,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerover', o));
    el.dispatchEvent(new MouseEvent('mouseover', o));
    el.dispatchEvent(new PointerEvent('pointerdown', o));
    el.dispatchEvent(new MouseEvent('mousedown', o));
    if (typeof el.focus === 'function') el.focus({ preventScroll: true });
    el.dispatchEvent(new PointerEvent('pointerup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('mouseup', { ...o, buttons: 0 }));
    el.dispatchEvent(new MouseEvent('click', { ...o, buttons: 0 }));
  };

  // ---------- learned ("taught") elements ----------
  const cssPath = el => {
    const parts = [];
    let e = el;
    while (e && e.nodeType === 1 && e !== document.body && parts.length < 10) {
      let s = e.tagName.toLowerCase();
      if (e.id && !/\d{3,}|:/.test(e.id)) { parts.unshift(s + '#' + CSS.escape(e.id)); break; }
      const p = e.parentElement;
      if (p) {
        const same = [...p.children].filter(c => c.tagName === e.tagName);
        if (same.length > 1) s += ':nth-of-type(' + (same.indexOf(e) + 1) + ')';
      }
      parts.unshift(s);
      e = p;
    }
    return parts.join(' > ');
  };
  const goodClasses = el => [...(el.classList || [])].filter(c => !/\d{3,}|^css-|^sc-|^jsx-|hover|active|focus|open/i.test(c)).slice(0, 10);

  const describe = el => ({
    tag: el.tagName.toLowerCase(),
    text: txt(el).slice(0, 80),
    aria: el.getAttribute('aria-label') || '',
    title: el.getAttribute('title') || '',
    testid: el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || '',
    id: el.id || '',
    role: el.getAttribute('role') || '',
    cls: goodClasses(el),
    path: cssPath(el)
  });

  const findTaught = d => {
    if (!d) return null;
    let byPath = null;
    try { byPath = d.path ? document.querySelector(d.path) : null; } catch (e) {}
    let best = null, bestScore = 0;
    for (const el of document.querySelectorAll(d.tag)) {
      if (!vis(el)) continue;
      let s = 0;
      if (d.id && el.id === d.id) s += 10;
      if (d.testid && (el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy')) === d.testid) s += 8;
      if (d.aria && el.getAttribute('aria-label') === d.aria) s += 6;
      if (d.title && el.getAttribute('title') === d.title) s += 5;
      if (d.text && txt(el).slice(0, 80) === d.text) s += 5;
      if (el === byPath) s += 4;
      if (d.cls && d.cls.length) {
        const mine = new Set(goodClasses(el));
        s += 3 * d.cls.filter(c => mine.has(c)).length / d.cls.length;
      }
      if (s > bestScore) { best = el; bestScore = s; }
    }
    return bestScore >= 5 ? best : null;
  };

  // ---------- page elements ----------
  const runBtn = cfg => {
    const prefix = (cfg.runPrefix || 'Run ').toLowerCase();
    return buttons().find(b => txt(b).toLowerCase().startsWith(prefix) && !isDisabled(b)) || null;
  };
  const callBtn = cfg => buttons().find(b => txt(b).toLowerCase() === (cfg.callText || 'Call').toLowerCase()) || null;

  const endCallBtn = (cfg, taught) => {
    const t = findTaught(taught.endcall);
    if (t) return t;
    const labelled = [...buttons(), ...[...document.querySelectorAll('[aria-label], [title]')].filter(vis)];
    const byLabel = labelled.find(b => /end ?call|hang ?up|leave call|disconnect/i.test(
      (b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + txt(b)));
    if (byLabel) return byLabel;
    // red, icon-only, small round element (the red phone button), whatever tag it uses
    const red = [...document.querySelectorAll('button, [role="button"], div, span, a')].find(b => {
      if (txt(b) || !vis(b)) return false;
      const r = b.getBoundingClientRect();
      if (r.width < 20 || r.height < 20 || r.width > 90 || r.height > 90) return false;
      const m = getComputedStyle(b).backgroundColor.match(/\d+/g);
      return m && +m[0] > 180 && +m[1] < 100 && +m[2] < 100 && (m[3] === undefined || +m[3] > 0);
    });
    return red ? (red.closest('button, [role="button"]') || red) : null;
  };

  // Step cards ("1 sign_in Customer", "2 inspect_portal Agent", ...) and which one is highlighted.
  const rgb = c => { const m = (c || '').match(/[\d.]+/g); return m ? { r: +m[0], g: +m[1], b: +m[2], a: m[3] === undefined ? 1 : +m[3] } : null; };
  const bluish = el => {
    const s = getComputedStyle(el);
    const bd = rgb(s.borderTopColor), bg = rgb(s.backgroundColor);
    const bdBlue = bd && bd.a > 0.3 && parseFloat(s.borderTopWidth) > 0 && bd.b > 150 && bd.b - bd.r > 60;
    const bgBlue = bg && bg.a > 0.3 && bg.b > 200 && bg.b - bg.r > 12;
    return bdBlue || bgBlue;
  };
  const stepCards = () => {
    const cands = [];
    for (const el of document.querySelectorAll('div, button, li, a, [role="tab"]')) {
      const t = (el.innerText || '').trim();
      if (!t || t.length > 90) continue;
      const lines = t.split('\n').map(x => x.trim()).filter(Boolean);
      if (lines.length < 2 || lines.length > 4) continue;
      if (!/^(customer|agent)$/i.test(lines[lines.length - 1])) continue;
      if (!vis(el)) continue;
      cands.push(el);
    }
    const cards = cands.filter(c => !cands.some(o => o !== c && c.contains(o))); // innermost
    let active = 0;
    const customer = cards.filter(c => /customer$/i.test((c.innerText || '').trim())).length;
    for (const c of cards) {
      const a0 = area(c);
      let e = c, hit = false;
      for (let i = 0; i < 4 && e && e !== document.body; i++, e = e.parentElement) {
        if (i > 0 && area(e) > a0 * 3 + 6000) break; // left the card
        if (bluish(e)) { hit = true; break; }
      }
      if (hit) active++;
    }
    return { count: cards.length, active, customer };
  };

  // Failed call (audio not saved): the next recovery button to click, only while the page shows a failure text.
  const recoverBtn = cfg => {
    const body = (document.body ? document.body.innerText : '').toLowerCase();
    if (!list(cfg.failTexts).some(t => body.includes(t.toLowerCase()))) return null;
    const els = [...document.querySelectorAll(BTN + ', a')].filter(vis);
    for (const want of list(cfg.recoverTexts)) {
      const el = els.find(b => txt(b).toLowerCase() === want.toLowerCase() && !isDisabled(b));
      if (el) return el;
    }
    return null;
  };

  const dropdownEl = (cfg, taught) => findTaught(taught.dropdown) || findText(cfg.triggerTexts, true);
  const optionEl = (cfg, taught) => findTaught(taught.option) || findText(cfg.optionTexts, false);

  const clickable = el => {
    const c = el.closest('button, [role="button"], [role="option"], [role="menuitem"], [role="menuitemradio"], a, li');
    return c && area(c) <= area(el) * 8 + 8000 ? c : el;
  };

  // ---------- API ----------
  window.HV = {
    scan(cfg, taught) {
      const body = document.body ? document.body.innerText : '';
      const m = body.match(/Overall\s+(\d+)\s+of\s+(\d+)\s+done/i);
      const cm = body.match(/customer\s+(\d+)\s+of\s+(\d+)/i);
      const low = body.toLowerCase();
      const run = runBtn(cfg), call = callBtn(cfg);
      return {
        url: location.href.slice(0, 100),
        run: run ? txt(run) : null,
        recover: (el => (el ? txt(el) : null))(recoverBtn(cfg)),
        call: call ? { enabled: !isDisabled(call) } : null,
        progress: m ? { done: +m[1], total: +m[2] } : null,
        custTotal: cm ? +cm[2] : null,
        endCall: !!endCallBtn(cfg, taught),
        noCustomerSteps: /no customer steps|\b0 customer steps/i.test(body),
        steps: stepCards(),
        // call with no tool steps at all: "0 total", or "no steps" text with no step cards and no Run button
        zeroSteps: /\b0 total\b/i.test(body) ||
          (/no customer steps|no steps/i.test(body) && stepCards().count === 0 && !run),
        uploading: list(cfg.uploadingTexts).some(t => low.includes(t.toLowerCase())),
        ready: list(cfg.readyTexts).some(t => low.includes(t.toLowerCase())),
        dropdown: !!dropdownEl(cfg, taught),
        optionVisible: !!optionEl(cfg, taught)
      };
    },

    click(cfg, taught, what) {
      const el = what === 'run' ? runBtn(cfg)
        : what === 'call' ? callBtn(cfg)
        : what === 'end' ? endCallBtn(cfg, taught)
        : what === 'recover' ? recoverBtn(cfg) : null;
      if (!el || (what !== 'end' && isDisabled(el))) return { ok: false, msg: 'Button disappeared before it could be clicked' };
      const label = what === 'end' ? 'End call' : txt(el);
      fire(el);
      return { ok: true, msg: 'Clicked: ' + label };
    },

    async advance(cfg, taught) {
      let opt = optionEl(cfg, taught);
      if (!opt) {
        const dd = dropdownEl(cfg, taught);
        if (!dd) return { ok: false, msg: 'Status dropdown not found. Teach it in the extension popup.' };
        fire(taught.dropdown ? dd : clickable(dd));
        for (let i = 0; i < 30 && !opt; i++) { await sleep(100); opt = optionEl(cfg, taught); }
        if (!opt) return { ok: false, msg: 'Opened the dropdown, but the option did not appear. Teach it in the extension popup.' };
      }
      const target = taught.option ? opt : clickable(opt);
      const label = txt(target).slice(0, 60);
      fire(target);
      return { ok: true, msg: 'Status changed: ' + (label || 'option clicked') };
    },

    // Teach mode: record the next real click in this frame.
    arm(slot) {
      HV.disarm();
      const h = e => {
        const t = e.target.closest ? e.target : e.target.parentElement;
        if (!t) return;
        HV.disarm();
        chrome.runtime.sendMessage({ type: 'taught', slot, desc: describe(clickable(t)) });
      };
      window.__hvTeach = h;
      document.addEventListener('click', h, true);
    },
    disarm() {
      if (window.__hvTeach) document.removeEventListener('click', window.__hvTeach, true);
      window.__hvTeach = null;
    },

    // Persistent status bar while auto mode runs (text = null removes it).
    badge(text, kind) {
      let b = document.getElementById('__cta_auto_badge');
      if (text == null) { if (b) b.remove(); return; }
      if (!b) {
        b = document.createElement('div');
        b.id = '__cta_auto_badge';
        b.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;left:20px;max-width:520px;' +
          'padding:8px 12px;border-radius:8px;font:600 13px/1.4 system-ui,sans-serif;color:#fff;' +
          'box-shadow:0 4px 16px rgba(0,0,0,.25);pointer-events:none';
        document.documentElement.appendChild(b);
      }
      b.style.background = kind === 'err' ? '#cf222e' : kind === 'ok' ? '#1a7f37' : '#6639ba';
      b.textContent = 'AUTO ● ' + text + '   (Alt+W to stop)';
    },

    toast(msg, kind) {
      let box = document.getElementById('__cta_step_toast');
      if (!box) {
        box = document.createElement('div');
        box.id = '__cta_step_toast';
        box.style.cssText = 'position:fixed;z-index:2147483647;bottom:20px;right:20px;max-width:440px;' +
          'padding:10px 14px;border-radius:8px;font:13px/1.4 system-ui,sans-serif;color:#fff;' +
          'box-shadow:0 4px 16px rgba(0,0,0,.25);pointer-events:none;transition:opacity .3s';
        document.documentElement.appendChild(box);
      }
      box.style.background = kind === 'ok' ? '#1a7f37' : kind === 'warn' ? '#9a6700' : kind === 'info' ? '#0969da' : '#cf222e';
      box.textContent = msg;
      box.style.opacity = '1';
      clearTimeout(window.__hvToastTimer);
      window.__hvToastTimer = setTimeout(() => { box.style.opacity = '0'; }, kind === 'info' ? 8000 : 2500);
    }
  };
})();
