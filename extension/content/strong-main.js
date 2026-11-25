/* 풀림 — 강력 모드 (페이지 쪽 세계). 사용자가 강력 모드를 켠 사이트에만 들어간다.
 *
 * 일반 모드로 안 풀리는 사이트가 쓰는 방법을 무력화:
 *  - 마우스를 누르는 순간(mousedown)을 막아 글자 선택이 시작조차 안 되게 하는 것
 *  - 고른 글자를 곧바로 지우는 것 (getSelection().removeAllRanges() 반복)
 *  - 풀림보다 먼저 자리 잡은 처리기의 preventDefault / return false / returnValue=false
 * 설정(켜짐 · 기능)은 격리된 세계의 unlock.js 가 'pullim-config' 이벤트로 알려 준다.
 */
(() => {
  'use strict';
  const MARK = Symbol.for('pullim.strong');
  if (window[MARK]) {
    try { window.dispatchEvent(new Event('pullim-config-request')); } catch {}
    return;
  }
  Object.defineProperty(window, MARK, { value: true });

  let cfg = { active: true, f: { contextmenu: true, select: true, copy: true, keys: true, drag: true } };
  window.addEventListener('pullim-config', (e) => {
    try {
      const d = JSON.parse(e.detail);
      if (d && typeof d === 'object') cfg = { active: !!d.active, f: { ...cfg.f, ...(d.f || {}) } };
    } catch {}
  }, true);

  const EDIT_TAGS = /^(INPUT|TEXTAREA|SELECT)$/;
  const INTERACTIVE = 'a[href],button,input,select,textarea,label,summary,video,audio,canvas,iframe,embed,object,svg,img,'
    + '[role="button"],[role="link"],[role="slider"],[role="tab"],[role="menuitem"],[role="option"],[role="scrollbar"],[draggable="true"],[contenteditable]';

  function elOf(ev) {
    let t = null;
    try { t = ev.composedPath()[0]; } catch {}
    t = t || ev.target;
    if (t && t.nodeType === 9) return t.documentElement;
    if (t && t.nodeType !== 1) return t.parentElement || null;
    return t;
  }
  const editable = (el) => !!el && (el.isContentEditable === true || EDIT_TAGS.test(el.tagName || ''));
  function plainText(el) {
    if (!el || editable(el)) return false;
    try { if (el.closest(INTERACTIVE)) return false; } catch { return false; }
    return (el.textContent || '').trim().length > 0;
  }

  const FEATURE = { mousedown: 'select', selectstart: 'select', contextmenu: 'contextmenu', copy: 'copy', cut: 'copy', dragstart: 'drag', keydown: 'keys' };

  // 사람이 한 동작에 대해 사이트가 기본 동작을 막으려 할 때, 그 막기를 무시할지
  function ignore(ev) {
    if (!cfg.active || !ev || !ev.isTrusted) return false;
    const feat = FEATURE[ev.type];
    if (!feat || cfg.f[feat] === false) return false;
    switch (ev.type) {
      case 'mousedown': return ev.button === 0 && !ev.ctrlKey && !ev.metaKey && plainText(elOf(ev));
      case 'selectstart': return !editable(elOf(ev));
      case 'contextmenu': return !ev.shiftKey;
      case 'copy':
      case 'cut': return !editable(elOf(ev)) && !editable(document.activeElement);
      case 'dragstart': return !editable(elOf(ev));
      case 'keydown':
        return (ev.ctrlKey || ev.metaKey) && !ev.altKey && !ev.shiftKey
          && (/^Key[CAX]$/.test(ev.code || '') || /^[cax]$/i.test(ev.key || '')) && !editable(elOf(ev));
    }
    return false;
  }

  // preventDefault · returnValue
  const EP = Event.prototype;
  const nativePD = EP.preventDefault;
  const patchedPD = {
    preventDefault() {
      if (ignore(this)) return undefined;
      return nativePD.call(this);
    },
  }.preventDefault;
  try { Object.defineProperty(EP, 'preventDefault', { value: patchedPD, writable: true, configurable: true, enumerable: true }); } catch {}

  const rv = Object.getOwnPropertyDescriptor(EP, 'returnValue');
  if (rv && rv.set && rv.configurable) {
    try {
      Object.defineProperty(EP, 'returnValue', {
        get: rv.get,
        set(v) { if (!v && ignore(this)) return; rv.set.call(this, v); },
        enumerable: rv.enumerable,
        configurable: true,
      });
    } catch {}
  }

  // on○○ = function(){ return false } 형태
  const TYPES = Object.keys(FEATURE);
  const wrapped = new WeakMap(); // 원래 함수 → 감싼 함수
  const original = new WeakMap(); // 감싼 함수 → 원래 함수
  function wrap(fn) {
    if (typeof fn !== 'function') return fn;
    if (original.has(fn)) return fn;
    let w = wrapped.get(fn);
    if (!w) {
      w = function (ev) {
        const r = fn.apply(this, arguments);
        return r === false && ignore(ev) ? undefined : r;
      };
      wrapped.set(fn, w);
      original.set(w, fn);
    }
    return w;
  }
  function patchHandlers(obj) {
    for (const t of TYPES) {
      const prop = 'on' + t;
      const d = obj && Object.getOwnPropertyDescriptor(obj, prop);
      if (!d || !d.set || !d.get || !d.configurable) continue;
      try {
        Object.defineProperty(obj, prop, {
          get() { const v = d.get.call(this); return (v && original.get(v)) || v; },
          set(fn) { d.set.call(this, wrap(fn)); },
          enumerable: d.enumerable,
          configurable: true,
        });
      } catch {}
    }
  }
  patchHandlers(window);
  for (const C of [window.Window, window.Document, window.HTMLElement, window.SVGElement, window.Element]) {
    if (C && C.prototype) patchHandlers(C.prototype);
  }

  // <body onmousedown="return false"> 같은 HTML 속성 처리기
  const ATTRS = TYPES.map((t) => 'on' + t);
  const ATTR_SEL = ATTRS.map((a) => `[${a}]`).join(',');
  function rewrap(el) {
    for (const a of ATTRS) {
      if (!el.hasAttribute || !el.hasAttribute(a)) continue;
      try {
        const fn = el[a]; // 브라우저가 속성 글을 함수로 만든 것(원래 함수)
        if (typeof fn === 'function') el[a] = fn; // 우리 setter 를 거쳐 감싼 함수로 바꿔 끼움
      } catch {}
    }
  }
  function scan(root) {
    if (!root) return;
    if (root.nodeType === 1) rewrap(root);
    if (root.querySelectorAll) for (const el of root.querySelectorAll(ATTR_SEL)) rewrap(el);
  }
  try {
    new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') rewrap(r.target);
        else for (const n of r.addedNodes) if (n.nodeType === 1) scan(n);
      }
    }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ATTRS });
  } catch {}
  scan(document.documentElement);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => scan(document.documentElement), { once: true });
  }

  // 고른 글자를 지우는 것 막기 (입력 칸 밖에서, 무언가 골라져 있을 때만)
  const SP = window.Selection && Selection.prototype;
  if (SP) {
    const nRemoveAll = SP.removeAllRanges;
    const nEmpty = SP.empty;
    const nAdd = SP.addRange;
    let suppressedAt = -1e9;
    const keep = (sel) => {
      if (!cfg.active || cfg.f.select === false) return false;
      if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
      const n = sel.anchorNode;
      const el = n && (n.nodeType === 1 ? n : n.parentElement);
      return !!el && !editable(el);
    };
    const patched = {
      removeAllRanges() { if (keep(this)) { suppressedAt = performance.now(); return; } return nRemoveAll.call(this); },
      empty() { if (keep(this)) { suppressedAt = performance.now(); return; } return nEmpty.call(this); },
      // removeAllRanges() 바로 뒤 addRange() 는 사이트가 선택을 옮기려는 것 → 그때는 진짜로 비우고 옮김
      addRange(r) { if (this.rangeCount && performance.now() - suppressedAt < 100) nRemoveAll.call(this); return nAdd.call(this, r); },
    };
    for (const k of Object.keys(patched)) {
      try { Object.defineProperty(SP, k, { value: patched[k], writable: true, configurable: true, enumerable: true }); } catch {}
    }
  }

  try { window.dispatchEvent(new Event('pullim-config-request')); } catch {}
})();
