# 개발 · 새 버전 내보내기

## 새 버전 내보내기 (이것만 하면 됨)

1. `extension/manifest.json` 의 `"version"` 을 올린다 (예: `1.0.0` → `1.0.1`).
2. `CHANGELOG.md` 맨 위에 `## 1.0.1` 절을 쓴다. 첫 줄이 사용자 팝업 · 도우미에 보일 한 줄 설명이 된다.
3. main 에 push.

나머지는 GitHub Actions(`.github/workflows/release.yml`)가 한다:
① 리눅스에서 설정 규칙 · 크롬 실기 시험(Chrome for Testing) · 빌드 · 도우미 시험(Mono)
→ ② **진짜 윈도우**(windows-latest)에서 조용히 설치 · 파일 · 예약 작업 · 시작 프로그램 · 앱 목록 확인, 도우미 시험(.NET Framework), 설치된 도우미로 가짜 새 버전 받기, 덮어 설치, 제거
→ ③ 둘 다 통과하면 `v<버전>` 릴리스를 만들고 올라간 파일의 SHA-256 을 다시 확인.
같은 버전 릴리스가 이미 있으면 시험만 하고 게시하지 않는다(README 만 바꾼 push 는 아예 안 돔).

설치된 PC 의 도우미가 3시간 안에(또는 로그인할 때) `releases/latest/download/latest.json` 을 읽어 새 zip 을 받고, 브라우저 속 풀림이 10분 안에 다시 불러온다.

> 이 클라우드 작업 환경은 GitHub API 로 릴리스를 직접 만들 수 없어서(403) 릴리스는 워크플로가 `GITHUB_TOKEN` 으로 만든다. 코드 push 는 된다.

## 구조

| 파일 | 하는 일 |
|---|---|
| `extension/content/unlock.js` | 모든 프레임, document_start, 격리된 세계. window 캡처 단계에서 contextmenu · selectstart · copy · cut · dragstart · Ctrl+C/A/X 를 사이트 처리기보다 먼저 받아 `stopImmediatePropagation()` (preventDefault 는 안 부르므로 브라우저 기본 동작은 일어남). 입력 칸 · 편집기 안, 영상 · 캔버스(일반 모드)는 건드리지 않음. Shift+우클릭은 통과. 강력 모드 몫: 오른쪽 버튼 누름 막기 · 투명 덮개 통과. 일반 모드로 안 풀리면 `hint` 를 보내 아이콘에 `!` |
| `extension/content/strong-main.js` | 강력 모드 사이트에만, 페이지 세계. `Event.prototype.preventDefault` · `returnValue` · `on○○` 의 `return false` 를 사람이 한 동작에 대해서만 무시(왼쪽 버튼 mousedown 은 글자 위에서만), `Selection.removeAllRanges/empty` 무시(바로 뒤 addRange 는 허용) |
| `extension/background.js` | 설정 판단 → 프레임마다 USER 출처 CSS(`user-select:auto !important` — 사이트 인라인 `!important` 도 이김) 넣고 빼기, 강력 모드 스크립트 등록(`registerContentScripts`, world MAIN), 아이콘 글자, 업데이트 확인 |
| `extension/shared/core.js` | 사이트 판단 규칙(꺼 둔 사이트 · 강력 모드 · 웹 앱 예외 목록 `BUILTIN_EXCEPTIONS`) — `test/core_test.mjs` |
| `extension/popup`, `options`, `guide.html` | 팝업 · 설정 · 설치/사용 안내 (안내는 설치 직후 file:// 로도 열림 → 자기 위치로 폴더 경로를 보여 줌) |
| `windows/PullimHelper.cs` | 업데이트 도우미 (C#, .NET Framework 4.x, 창 없음). latest.json → 주소 앞부분 · SHA-256 · 크기 · zip 경로(../) · 버전 확인 → 파일 바꾸기(**manifest.json 은 맨 마지막**) → `install-info.json` |
| `windows/installer.nsi` | NSIS 설치 프로그램 (관리자 권한 없음, `%LOCALAPPDATA%\Pullim`), 시작 메뉴 · 시작 프로그램(`--startup`) · 예약 작업 `Pullim Helper`(3시간) · 앱 목록 |

### 알아 둘 것 (겪은 일)

- **확장 프로그램 자동 업데이트**: 스토어 밖 확장은 크롬 · 엣지가 스스로 업데이트하지 않는다(자체 호스팅은 회사 관리 PC 전용). 그래서 '압축 해제된 확장'으로 불러오게 하고, 도우미가 그 폴더 파일을 바꾸면 `background.js checkDisk()` 가 10분마다 `fetch(manifest.json)` 으로 디스크 버전을 보고 다르면 `chrome.runtime.reload()`. 같은 버전으로 한 번 시도했는데 안 바뀌면 되풀이하지 않음(`reloadTried`).
- `chrome.runtime.reload()` 는 **개발자 모드가 켜져 있어야** 다시 켜진다(크롬 134+). 사용자는 켜 둔 상태라 괜찮고, 시험 프로필도 `developer_mode: true` 로 띄운다.
- 다시 불러오면 열린 탭의 예전 스크립트는 '고아'(설정을 못 받음)가 되고 새 스크립트는 새 격리 세계에 들어간다. 고아가 사이트보다 앞선 자리를 갖고 있으므로 물러나지 않고, 새 스크립트가 `pullim:state` 이벤트로 알려 주는 설정을 따른다.
- `document.open()` 은 그 프레임 window 의 처리기를 모두 지운다 → `<html>` 이 바뀌면 다시 붙인다.
- 웹 페이지(안내 페이지)는 `chrome://extensions` 같은 주소를 열 수 없다 → 주소 · 폴더 경로 복사 단추로 대신함.
- 도우미는 리눅스의 mcs(모노)로 컴파일하지만 **.NET Framework 4.5 참조 어셈블리**(NuGet, `build.sh` 에 SHA-256 고정)에 맞춘다. 모노 라이브러리에 맞추면 `String.Split('/')` 가 .NET Framework 에 없는 `Split(char, StringSplitOptions)` 에 묶여 윈도우에서 `MissingMethodException` 이 났다(첫 윈도우 실기 시험에서 잡힘). 4.8 참조 어셈블리는 `System.IO.Compression` 4.2.0.0 을 가리켜서 4.5 를 쓴다.
- 윈도우 시험에서 한글 이름 바로가기는 `WScript.Shell` 이 영어 윈도우에서 못 읽는다 → `Shell.Application` 으로 확인. 파이썬은 `PYTHONUTF8=1`.
- 이름에 update/setup 이 들어간 32비트 exe 는 윈도우가 관리자 권한을 요구할 수 있어 도우미 이름을 `PullimHelper.exe` 로, 옆에 `asInvoker` manifest 를 둠(mcs 는 manifest 를 exe 에 넣지 못함).
- 확장 ID 는 manifest 의 `key` 로 고정: `jicjodhbaibbeiplmkeconolenimmgdi`.

## 시험 (리눅스 작업 환경)

```bash
npm ci
node test/core_test.mjs                          # 설정 규칙
node test/ext_test.mjs                           # 실제 크롬: 막힌 페이지들 대조 · 프레임 · 끄고 켜기 · 강력 모드 · 팝업 · 스스로 다시 불러오기
SHOTS=1 node test/ext_test.mjs                   #   + test/tmp 에 팝업 · 설정 · 안내 화면
bash build/build.sh                              # dist/ (apt: nsis mono-mcs mono-runtime libmono-system-io-compression*-cil)
python3 test/helper_test.py                      # 도우미: 업데이트 · SHA-256/크기/경로/주소/버전 거부 · minHelper (mono)
pwsh test/windows_test.ps1 -Version <버전>       # 윈도우에서만 (Actions 가 함)
node tools/make_icons.mjs && python3 tools/make_installer_art.py   # 아이콘 · 설치 그림을 바꿀 때만
```

시험 페이지(`test/pages/`): 티스토리식 막기(인라인 · 속성 · window 캡처 · CSS · 인라인 !important · 경고창), 출처 덧붙이기, 누름 막기, 선택 지우기, 투명 덮개, 다른 주소 프레임, srcdoc · document.write 프레임, 편집기, 자체 메뉴 웹 앱, 안 보이는 선택.
