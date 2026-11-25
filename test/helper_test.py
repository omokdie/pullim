#!/usr/bin/env python3
"""python3 test/helper_test.py [PullimHelper.exe] — 업데이트 도우미를 가짜 릴리스로 시험 (리눅스: mono, 윈도우: 그대로)."""
import hashlib, http.server, json, os, shutil, socketserver, subprocess, sys, tempfile, threading, zipfile

sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # 윈도우 콘솔 기본 인코딩(cp1252)이면 한글 출력이 깨지므로

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'build/out/PullimHelper.exe')
RUN = [EXE] if os.name == 'nt' else ['mono', EXE]

work = tempfile.mkdtemp(prefix='pullim-helper-')
site = os.path.join(work, 'site')
os.makedirs(site)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=site, **k)
    def log_message(self, *a): pass

httpd = socketserver.TCPServer(('127.0.0.1', 0), Quiet)
PORT = httpd.server_address[1]
BASE = f'http://127.0.0.1:{PORT}/'
threading.Thread(target=httpd.serve_forever, daemon=True).start()

passed = failed = 0
def check(name, cond, extra=''):
    global passed, failed
    if cond: passed += 1; print('ok -', name)
    else: failed += 1; print('FAIL -', name, extra)

def install_dir(version='1.0.0'):
    d = tempfile.mkdtemp(prefix='inst-', dir=work)
    shutil.copytree(os.path.join(ROOT, 'extension'), os.path.join(d, 'extension'))
    mf = os.path.join(d, 'extension/manifest.json')
    m = json.load(open(mf, encoding='utf-8')); m['version'] = version
    json.dump(m, open(mf, 'w', encoding='utf-8'), ensure_ascii=False)
    open(os.path.join(d, 'extension/old-file.txt'), 'w', encoding='utf-8').write('예전 파일')
    os.makedirs(os.path.join(d, 'extension/old-dir'))
    open(os.path.join(d, 'extension/old-dir/x.txt'), 'w', encoding='utf-8').write('x')
    json.dump({'installer': 'setup', 'helper': 1}, open(os.path.join(d, 'extension/install-info.json'), 'w', encoding='utf-8'))
    return d

def make_zip(name, version, extra=None, evil=False):
    path = os.path.join(site, name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    src = os.path.join(ROOT, 'extension')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(src):
            for f in files:
                full = os.path.join(base, f)
                rel = os.path.relpath(full, src).replace(os.sep, '/')
                if rel == 'install-info.json': continue
                if rel == 'manifest.json':
                    m = json.load(open(full, encoding='utf-8')); m['version'] = version
                    z.writestr(rel, json.dumps(m, ensure_ascii=False, indent=2))
                else:
                    z.write(full, rel)
        z.writestr('new-folder/새 파일.txt', '새 버전에 생긴 파일')
        if evil: z.writestr('../evil.txt', 'nope')
        for k, v in (extra or {}).items(): z.writestr(k, v)
    data = open(path, 'rb').read()
    return BASE + name, hashlib.sha256(data).hexdigest(), len(data)

def feed(version, url, sha, size, **more):
    j = {'version': version, 'notes': '시험', 'extension': {'url': url, 'sha256': sha, 'size': size}}
    j.update(more)
    open(os.path.join(site, 'latest.json'), 'w', encoding='utf-8').write(json.dumps(j, ensure_ascii=False))

def run(d, prefix=None):
    p = subprocess.run(RUN + ['--dir', d, '--feed', BASE + 'latest.json', '--allow-prefix', prefix or BASE, '--no-delay'],
                       capture_output=True, encoding='utf-8', errors='replace', timeout=120)
    return p.returncode, p.stdout + p.stderr

def ver(d):
    return json.load(open(os.path.join(d, 'extension/manifest.json'), encoding='utf-8'))['version']

# 1) 새 버전 받아 바꾸기
url, sha, size = make_zip('v1.0.1/pullim-extension-1.0.1.zip', '1.0.1')
feed('1.0.1', url, sha, size)
d = install_dir('1.0.0')
code, out = run(d)
check('새 버전으로 업데이트 (종료 코드 10)', code == 10, out)
check('manifest 버전이 1.0.1', ver(d) == '1.0.1')
check('새 파일 · 한글 이름 폴더 생김', os.path.exists(os.path.join(d, 'extension/new-folder/새 파일.txt')))
check('예전에만 있던 파일 · 빈 폴더 지움', not os.path.exists(os.path.join(d, 'extension/old-file.txt')) and not os.path.exists(os.path.join(d, 'extension/old-dir')))
info = json.load(open(os.path.join(d, 'extension/install-info.json'), encoding='utf-8'))
check('install-info.json 갱신', info.get('installer') == 'setup' and info.get('version') == '1.0.1' and 'updatedAt' in info, info)
check('임시 폴더 정리', not os.path.exists(os.path.join(d, 'staging')))
log = open(os.path.join(d, 'helper.log'), encoding='utf-8').read()
check('기록 남김', '업데이트 끝 1.0.0 → 1.0.1' in log, log)

# 2) 이미 최신
code, out = run(d)
check('이미 최신이면 그대로 (종료 코드 0)', code == 0 and ver(d) == '1.0.1', out)

# 3) SHA-256 틀림
d = install_dir('1.0.0')
feed('1.0.1', url, '0' * 64, size)
code, out = run(d)
check('SHA-256 이 틀리면 안 바꿈', code == 1 and ver(d) == '1.0.0' and os.path.exists(os.path.join(d, 'extension/old-file.txt')), out)

# 4) 크기 틀림
feed('1.0.1', url, sha, size + 1)
code, out = run(d)
check('크기가 틀리면 안 바꿈', code == 1 and ver(d) == '1.0.0', out)

# 5) 폴더 밖으로 나가는 경로
eurl, esha, esize = make_zip('v1.0.2/evil.zip', '1.0.2', evil=True)
feed('1.0.2', eurl, esha, esize)
code, out = run(d)
check('../ 경로가 든 압축 파일 거부', code == 1 and ver(d) == '1.0.0' and not os.path.exists(os.path.join(d, 'evil.txt')), out)

# 6) 다른 곳 주소
feed('1.0.1', 'https://example.com/x.zip', sha, size)
code, out = run(d)
check('풀림 릴리스가 아닌 주소 거부', code == 1 and ver(d) == '1.0.0', out)

# 7) 버전이 서로 다름
feed('1.0.3', url, sha, size)
code, out = run(d)
check('압축 파일 버전 ≠ 업데이트 정보 버전이면 거부', code == 1 and ver(d) == '1.0.0', out)

# 8) 새 설치 프로그램이 필요한 판
feed('2.0.0', url, sha, size, minHelper=2)
code, out = run(d)
info = json.load(open(os.path.join(d, 'extension/install-info.json'), encoding='utf-8'))
check('minHelper 가 크면 바꾸지 않고 표시만', code == 0 and ver(d) == '1.0.0' and info.get('needsSetup') is True, out)

# 9) 망가진 latest.json · 없는 주소
open(os.path.join(site, 'latest.json'), 'w', encoding='utf-8').write('{"version": "1.0.1", ')
code, out = run(d)
check('망가진 업데이트 정보', code == 1 and ver(d) == '1.0.0', out)
os.remove(os.path.join(site, 'latest.json'))
code, out = run(d)
check('업데이트 정보가 없으면(404) 실패로 끝냄', code == 1 and ver(d) == '1.0.0', out)

# 10) 처음 설치 폴더가 비어 있어도 됨
d2 = tempfile.mkdtemp(prefix='empty-', dir=work)
feed('1.0.1', url, sha, size)
code, out = run(d2)
check('빈 폴더에도 새로 깔기', code == 10 and ver(d2) == '1.0.1', out)

httpd.shutdown()
shutil.rmtree(work, ignore_errors=True)
print(f'\n{passed}개 통과, {failed}개 실패')
sys.exit(1 if failed else 0)
