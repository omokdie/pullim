// 시험 페이지 공통: 사이트 쪽 처리기가 몇 번 불렸는지 셈 (페이지 세계)
window.__hits = { ctx: 0, sel: 0, copy: 0, cut: 0, key: 0, drag: 0, down: 0, rdown: 0, clear: 0, alert: 0, edcopy: 0, inputctx: 0, menu: 0 };
window.alert = () => { window.__hits.alert++; };
