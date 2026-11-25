/* 풀림 — 페이지 안(확장 프로그램 전용 격리 공간)에서 우클릭 · 선택 · 복사 막기를 풂.
 *
 * document_start 에 모든 프레임으로 들어가 사이트 스크립트보다 먼저 window 의 캡처 단계에 자리를 잡는다.
 * 사이트가 막을 때 쓰는 이벤트(contextmenu · selectstart · copy · cut · dragstart · Ctrl+C/A/X)를
 * 사이트 처리기가 받기 전에 멈춰서(stopImmediatePropagation) preventDefault 를 못 부르게 한다.
 * 풀림은 preventDefault 를 부르지 않으므로 브라우저 기본 동작(우클릭 메뉴 · 선택 · 복사)은 그대로 일어난다.
 * 글자 선택을 막는 CSS(user-select: none)는 백그라운드가 USER 출처 CSS 로 덮는다.
 */
(() => {
  'use strict';

  let VERSION;
  try { VERSION = chrome.runtime.getManifest().version; } catch { return; }

  const G = globalThis;
  const ID = Math.random().toString(36).slice(2);
  const orphaned = () => { try { return !chrome.runtime || !chrome.runtime.id; } catch { return true; } };

  // 같은 프레임에 이미 살아 있는 풀림이 있으면(설치 직후 열린 탭에 한 번 더 넣는 경우) 그걸 씀
  const prev = G.__pullim;
  if (prev && typeof prev.orphaned === 'function' && !prev.orphaned()) {
    if (typeof prev.resync === 'function') prev.resync();
    return;
  }
  // 확장 프로그램이 업데이트(다시 불러오기)되면 예전 스크립트는 '고아'가 된다(설정을 못 받음).
  // 고아는 사이트보다 먼저 잡아 둔 자리를 그대로 지키면서, 새 스크립트가 알려 주는 설정을 따른다 (아래 pullim:state).

  const state = {
    active: true, // 백그라운드 답을 받기 전엔 켜 둠 (끈 사이트면 곧 꺼짐)
    strong: false,
    f: { contextmenu: true, select: true, copy: true, keys: true, drag: true },
    retired: false,
  };

  const removers = [];
  const regs = [];
  const listen = (target, type, fn, capture = true) => {
    regs.push([target, type, fn, capture]);
    target.addEventListener(type, fn, capture);
    removers.push(() => target.removeEventListener(type, fn, capture));
  };
  // document.open()(document.write 로 프레임을 새로 쓰는 경우)은 window · document 의 처리기를 모두 지운다
  // → 문서 뿌리(<html>)가 바뀌면 다시 붙임 (이미 붙어 있으면 아무 일도 없음)
  function watchDocumentRewrite() {
    let root = document.documentElement;
    try {
      const mo = new MutationObserver(() => {
        if (document.documentElement === root) return;
        root = document.documentElement;
        if (!state.retired) for (const [t, type, fn, c] of regs) t.addEventListener(type, fn, c);
      });
      mo.observe(document, { childList: true });
      removers.push(() => mo.disconnect());
    } catch {}
  }
  const live = () => state.active && !state.retired;

  const EDIT_TAGS = /^(INPUT|TEXTAREA|SELECT)$/;
  const MEDIA_TAGS = /^(CANVAS|VIDEO|AUDIO|EMBED|OBJECT|IFRAME|FRAME)$/;

  function targetEl(e) {
    let t = null;
    try { t = e.composedPath()[0]; } catch {}
    t = t || e.target;
    if (!t) return null;
    if (t.nodeType === 9) return t.documentElement;
    if (t.nodeType !== 1) return t.parentElement || null;
    return t;
  }
  const isEditable = (el) => !!el && (el.isContentEditable === true || EDIT_TAGS.test(el.tagName || ''));
  const closest = (el, sel) => { try { return el && el.closest ? el.closest(sel) : null; } catch { return null; } };
  const stop = (e) => e.stopImmediatePropagation();

  // ── 우클릭 메뉴 ─────────────────────────────────────────────
  // Shift 를 누른 채 우클릭하면 사이트 원래 메뉴(자체 메뉴가 있는 사이트용)
  function onContextMenu(e) {
    if (!e.isTrusted || !live() || !state.f.contextmenu || e.shiftKey) return;
    if (!state.strong) {
      const el = targetEl(e);
      // 입력 칸(비밀번호 관리자 메뉴 등) · 영상 · 게임 화면 · 코드 편집기는 일반 모드에서 건드리지 않음
      if (el && (isEditable(el) || MEDIA_TAGS.test(el.tagName) || closest(el, '.monaco-editor'))) return;
    }
    stop(e);
  }

  // ── 글자 선택 ───────────────────────────────────────────────
  function onSelectStart(e) {
    if (!e.isTrusted || !live() || !state.f.select) return;
    if (isEditable(targetEl(e))) return;
    stop(e);
  }

  // ── 복사 · 잘라내기 (입력 칸 · 편집기 안은 사이트에 맡김) ─────
  function onCopy(e) {
    if (!e.isTrusted || !live() || !state.f.copy) return;
    if (isEditable(targetEl(e)) || isEditable(document.activeElement)) return;
    stop(e);
  }

  // ── 끌기 (글자 · 그림을 끌어 옮기기) ──────────────────────────
  function onDragStart(e) {
    if (!e.isTrusted || !live() || !state.f.drag) return;
    const el = targetEl(e);
    if (isEditable(el)) return;
    if (!state.strong && closest(el, '[draggable="true"]')) return; // 끌어서 순서 바꾸기 같은 사이트 기능
    stop(e);
  }

  // ── 단축키 Ctrl+C · Ctrl+A · Ctrl+X ──────────────────────────
  function onKeyDown(e) {
    if (!e.isTrusted || !live() || !state.f.keys) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
    if (!/^Key[CAX]$/.test(e.code || '') && !/^[cax]$/i.test(e.key || '')) return;
    if (isEditable(targetEl(e))) return;
    stop(e);
  }

  // ── 강력 모드: 오른쪽 버튼 누름 자체를 막는 사이트 · 투명한 덮개 ──
  function onRightButton(e) {
    if (e.button !== 2 || !e.isTrusted || !live() || !state.strong || !state.f.contextmenu || e.shiftKey) return;
    if (e.type === 'pointerdown' || e.type === 'mousedown') passThroughCover(e);
    stop(e);
  }

  const CONTENT_TAGS = /^(IMG|VIDEO|CANVAS|SVG|PICTURE|AUDIO|IFRAME|INPUT|TEXTAREA|SELECT|BUTTON|A)$/i;
  function hasOwnText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue.trim()) return true;
    return false;
  }
  function isCover(el) {
    if ((el.textContent || '').trim()) return false;
    if (el.querySelector && el.querySelector('img,video,canvas,svg,picture,iframe,input,textarea,select,button,a')) return false;
    const pos = getComputedStyle(el).position;
    return pos === 'absolute' || pos === 'fixed';
  }
  // 그림 · 글 위에 덮어 둔 빈 투명 상자를 잠깐 클릭이 지나가게 해서, 우클릭이 아래 그림 · 글에 닿게 함
  function passThroughCover(e) {
    let stack;
    try { stack = document.elementsFromPoint(e.clientX, e.clientY); } catch { return; }
    const changed = [];
    for (const el of stack) {
      if (el === document.documentElement || el === document.body) break;
      if (CONTENT_TAGS.test(el.tagName) || hasOwnText(el)) break;
      if (isCover(el)) {
        changed.push([el, el.style.getPropertyValue('pointer-events'), el.style.getPropertyPriority('pointer-events')]);
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    }
    if (changed.length) {
      setTimeout(() => {
        for (const [el, v, p] of changed) {
          if (v) el.style.setProperty('pointer-events', v, p); else el.style.removeProperty('pointer-events');
        }
      }, 1500);
    }
  }

  // ── 일반 모드로 안 풀리는 사이트 알아채기 (팝업에 '강력 모드' 권하기) ──
  let downEv = null;
  let downSeq = 0;
  function onLeftDown(e) {
    if (e.isTrusted && e.button === 0) { downEv = e; downSeq++; }
  }
  function onLeftUp(e) {
    if (!e.isTrusted || e.button !== 0 || !downEv) return;
    const d = downEv;
    downEv = null;
    if (!live() || state.strong || !state.f.select) return;
    if (Math.abs(e.clientX - d.clientX) + Math.abs(e.clientY - d.clientY) < 8) return; // 끌어서 고르려던 것만
    const el = targetEl(d);
    if (!el || isEditable(el) || closest(el, 'a[href],button,input,select,textarea,label,img,svg,canvas,video,[role],[draggable="true"]')) return;
    if (!(el.textContent || '').trim()) return;
    const sel = getSelection();
    if (!sel) return;
    if (sel.isCollapsed) {
      if (d.defaultPrevented) hint('mousedown'); // 누르는 순간을 막아 선택이 시작조차 안 됨
      return;
    }
    const seq = downSeq;
    setTimeout(() => { // 골라졌다가 사이트가 곧바로 지우는지
      const s = getSelection();
      if (seq === downSeq && s && s.isCollapsed) hint('cleared');
    }, 400);
  }

  const hinted = new Set();
  function hint(kind) {
    if (hinted.has(kind) || orphaned()) return;
    hinted.add(kind);
    try { chrome.runtime.sendMessage({ t: 'hint', kind }).catch(() => {}); } catch {}
  }

  // ── 백그라운드와 연결이 안 될 때만 쓰는 페이지 안 스타일 ──────
  const FALLBACK_CSS = ':is(html, body, body *):not(button, select, option, [role="button"], [role="slider"], [draggable="true"])'
    + ':not(#\\_pl):not(#\\_pl):not(#\\_pl) { -webkit-user-select: auto !important; user-select: auto !important; }';
  let fallbackStyle = null;
  function setFallbackCSS(on) {
    if (on && !fallbackStyle) {
      const root = document.head || document.documentElement;
      if (!root) return;
      fallbackStyle = document.createElement('style');
      fallbackStyle.textContent = FALLBACK_CSS;
      root.appendChild(fallbackStyle);
    } else if (!on && fallbackStyle) {
      fallbackStyle.remove();
      fallbackStyle = null;
    }
  }

  // ── 강력 모드의 페이지 쪽 스크립트(strong-main.js)에 설정 알리기 ──
  function sendConfigToMain() {
    const detail = JSON.stringify({ active: live() && state.strong, f: state.f });
    try { window.dispatchEvent(new CustomEvent('pullim-config', { detail })); } catch {}
  }

  // ── 설정 받기 ───────────────────────────────────────────────
  function topHint() {
    try { if (window.top === window) return location.href; } catch {}
    try {
      const ao = location.ancestorOrigins;
      if (ao && ao.length) return ao[ao.length - 1] + '/';
    } catch {}
    return '';
  }

  let syncing = 0;
  async function sync() {
    if (state.retired || orphaned()) return;
    const my = ++syncing;
    let res = null;
    try { res = await chrome.runtime.sendMessage({ t: 'hello', top: topHint() }); } catch {}
    if (state.retired || my !== syncing) return;
    if (res && res.state) {
      applyState(res.state);
      setFallbackCSS(res.cssOk === false && state.active && state.f.select);
    } else {
      setFallbackCSS(state.active && state.f.select);
    }
    sendConfigToMain();
    // 같은 페이지에 남은 예전(고아) 스크립트에게 지금 설정을 알림
    const detail = JSON.stringify({ active: state.active, strong: state.strong, features: state.f });
    try { document.dispatchEvent(new CustomEvent('pullim:state', { detail })); } catch {}
  }

  function applyState(s) {
    if (!s || typeof s !== 'object') return;
    state.active = !!s.active;
    state.strong = !!s.strong;
    if (s.features && typeof s.features === 'object') state.f = { ...state.f, ...s.features };
  }

  function retire() {
    if (state.retired) return;
    state.retired = true;
    state.active = false;
    for (const r of removers.splice(0)) { try { r(); } catch {} }
    setFallbackCSS(false);
    sendConfigToMain();
  }

  listen(window, 'contextmenu', onContextMenu);
  listen(window, 'selectstart', onSelectStart);
  listen(window, 'copy', onCopy);
  listen(window, 'cut', onCopy);
  listen(window, 'dragstart', onDragStart);
  listen(window, 'keydown', onKeyDown);
  for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick']) listen(window, t, onRightButton);
  listen(window, 'mousedown', onLeftDown);
  listen(window, 'mouseup', onLeftUp);
  listen(window, 'pullim-config-request', sendConfigToMain, false);
  listen(window, 'pageshow', (e) => { if (e.persisted) sync(); }, false);

  const onStorage = (changes, area) => { if (area === 'local' && changes.settings) sync(); };
  try {
    chrome.storage.onChanged.addListener(onStorage);
    removers.push(() => { try { chrome.storage.onChanged.removeListener(onStorage); } catch {} });
  } catch {}

  G.__pullim = { version: VERSION, orphaned, retire, resync: sync };

  // 고아가 된 뒤: 새 스크립트가 오면 페이지 안 예비 스타일은 넘기고, 새 스크립트가 알려 주는 설정을 따름
  listen(document, 'pullim:hello', (e) => { if (e.detail !== ID && orphaned()) setFallbackCSS(false); }, false);
  listen(document, 'pullim:state', (e) => {
    if (!orphaned()) return; // 살아 있는 스크립트는 자기 설정을 씀
    try { applyState(JSON.parse(e.detail)); } catch {}
    sendConfigToMain();
  }, false);
  try { document.dispatchEvent(new CustomEvent('pullim:hello', { detail: ID })); } catch {}

  watchDocumentRewrite();
  sync();
})();
