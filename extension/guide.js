/* 풀림 안내 — 설치 직후 파일로(file://) 열리기도 하고, 확장 프로그램 안에서(chrome-extension://) 열리기도 함 */
(() => {
  const $ = (id) => document.getElementById(id);
  const inExtension = location.protocol === 'chrome-extension:';
  const isFile = location.protocol === 'file:';

  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 1800);
  }

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(`복사했어요: ${text}`);
  }

  // 설치 프로그램이 연 경우: 이 파일이 있는 폴더 = 확장 폴더 (예: C:\Users\이름\AppData\Local\Pullim\extension)
  if (isFile) {
    let p = decodeURIComponent(location.pathname);
    if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
    p = p.replace(/\//g, '\\').replace(/\\[^\\]*$/, '');
    if (p) {
      $('extPath').textContent = p;
      $('heroTitle').textContent = '설치 끝! 이제 브라우저에 추가해 주세요';
    }
  }

  if (inExtension) {
    try { $('ver').textContent = 'v' + chrome.runtime.getManifest().version; } catch {}
    if (location.hash === '#welcome') {
      $('welcome').hidden = false;
      $('heroTitle').textContent = '풀림';
      $('install').querySelector('h2').firstChild.textContent = '다른 브라우저에도 추가하기 ';
    }
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy-from]');
    if (btn) { copy($(btn.dataset.copyFrom).textContent.trim()); return; }
    const code = e.target.closest('code.copy');
    if (code) copy(code.textContent.trim());
  });
})();
