"""dist/latest.json + dist/release-notes.md 만들기 — 릴리스 파일을 다 만든 뒤에 실행"""
import hashlib, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = 'omokdie/pullim'
ver = sys.argv[1]
dist = os.path.join(ROOT, 'dist')

def asset(name):
    data = open(os.path.join(dist, name), 'rb').read()
    return {'url': f'https://github.com/{REPO}/releases/download/v{ver}/{name}',
            'sha256': hashlib.sha256(data).hexdigest(), 'size': len(data)}

# CHANGELOG.md 의 "## <버전>" 절 → 릴리스 설명, 첫 줄 → 짧은 알림
log = open(os.path.join(ROOT, 'CHANGELOG.md'), encoding='utf-8').read()
m = re.search(rf'^## {re.escape(ver)}\b.*?\n(.*?)(?=^## |\Z)', log, re.S | re.M)
if not m:
    sys.exit(f'CHANGELOG.md 에 "## {ver}" 절이 없어요')
section = m.group(1).strip()
first = next((l.lstrip('-* ').strip() for l in section.splitlines() if l.strip()), '')

latest = {
    'version': ver,
    'notes': first,
    'minHelper': 1,
    'extension': asset(f'pullim-extension-{ver}.zip'),
    'setup': asset(f'Pullim-Setup-{ver}.exe'),
}
json.dump(latest, open(os.path.join(dist, 'latest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=2)

notes = f"""{section}

### 설치
- **처음이면** 아래 `Pullim-Setup-{ver}.exe` 를 받아 실행하세요 (관리자 권한 필요 없음). 설치가 끝나면 열리는 안내대로 크롬 · 엣지 · 웨일에 한 번씩 추가하면 끝이에요.
- **이미 설치했다면** 할 일이 없어요. 업데이트 도우미가 몇 시간 안에 받아 두고, 브라우저 속 풀림이 스스로 새 버전을 불러와요.
- 설치 프로그램 없이 쓰려면 `pullim-extension-{ver}.zip` 을 풀어서 그 폴더를 불러와도 돼요(이 경우 자동 업데이트는 안 돼요).

| 파일 | SHA-256 |
|---|---|
| Pullim-Setup-{ver}.exe | `{latest['setup']['sha256']}` |
| pullim-extension-{ver}.zip | `{latest['extension']['sha256']}` |
"""
open(os.path.join(dist, 'release-notes.md'), 'w', encoding='utf-8').write(notes)
print(json.dumps(latest, ensure_ascii=False, indent=2))
