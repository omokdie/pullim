; 풀림 설치 프로그램 (NSIS 3, 유니코드). 관리자 권한 없이 사용자 폴더에 설치.
;   makensis -INPUTCHARSET UTF8 -DVERSION=1.0.0 -DROOT=<저장소> -DHELPER=<PullimHelper.exe> -DOUTFILE=<결과.exe> windows/installer.nsi
; 설치하는 것
;   %LOCALAPPDATA%\Pullim\extension\     브라우저가 불러올 확장 폴더 (설치 안내: extension\guide.html)
;   %LOCALAPPDATA%\Pullim\PullimHelper.exe  업데이트 도우미 (+ .manifest)
;   시작 메뉴 '풀림', 시작 프로그램 '풀림 업데이트 도우미', 예약 작업 'Pullim Helper'(3시간마다), 앱 목록의 제거 항목

Unicode true
ManifestDPIAware true
RequestExecutionLevel user
SetCompressor /SOLID lzma

!ifndef VERSION
  !error "VERSION 을 -DVERSION=x.y.z 로 주세요"
!endif
!ifndef ROOT
  !define ROOT ".."
!endif
!ifndef HELPER
  !define HELPER "${ROOT}/build/out/PullimHelper.exe"
!endif
!ifndef OUTFILE
  !define OUTFILE "${ROOT}/dist/Pullim-Setup-${VERSION}.exe"
!endif

!define APPNAME "풀림"
!define FULLNAME "풀림 - 우클릭·드래그·복사 제한 해제"
!define PUBLISHER "omokdie"
!define REPO_URL "https://github.com/omokdie/pullim"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Pullim"
!define TASK_NAME "Pullim Helper"
!define STARTUP_LNK "$SMSTARTUP\풀림 업데이트 도우미.lnk"
!define MENU_DIR "$SMPROGRAMS\풀림"

Name "${APPNAME}"
Caption "${APPNAME} ${VERSION} 설치"
UninstallCaption "${APPNAME} 제거"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Pullim"
BrandingText "풀림 ${VERSION} · github.com/omokdie/pullim"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1042 "ProductName" "${APPNAME}"
VIAddVersionKey /LANG=1042 "FileDescription" "${APPNAME} 설치 프로그램"
VIAddVersionKey /LANG=1042 "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=1042 "LegalCopyright" "omokdie"
VIAddVersionKey /LANG=1042 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1042 "ProductVersion" "${VERSION}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!define MUI_ICON "${ROOT}/assets/pullim.ico"
!define MUI_UNICON "${ROOT}/assets/pullim.ico"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${ROOT}/assets/installer-side.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "${ROOT}/assets/installer-side.bmp"
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "설치를 그만둘까요?"

!define MUI_WELCOMEPAGE_TITLE "풀림 ${VERSION} 설치"
!define MUI_WELCOMEPAGE_TEXT "자바스크립트로 우클릭 · 글자 선택(드래그) · 복사를 막아 둔 사이트를 다시 쓸 수 있게 풀어 주는 확장 프로그램이에요. 크롬 · 엣지 · 네이버 웨일에서 쓸 수 있어요.$\r$\n$\r$\n설치하면 새 버전이 나올 때마다 자동으로 업데이트돼요.$\r$\n$\r$\n관리자 권한은 필요 없어요. [다음]을 누르면 바로 설치합니다."
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "설치 끝! 이제 브라우저에 추가해 주세요"
!define MUI_FINISHPAGE_TEXT "쓰는 브라우저(크롬 · 엣지 · 웨일)마다 한 번씩 풀림 폴더를 불러오면 끝이에요.$\r$\n$\r$\n순서는 안내 페이지에 있어요:$\r$\n① 확장 프로그램 페이지에서 '개발자 모드' 켜기$\r$\n② '압축 해제된 항목 로드' 누르기$\r$\n③ 폴더 경로 붙여넣기 → 폴더 선택$\r$\n$\r$\n시작 메뉴 → 풀림 → '풀림 설치 안내'로 언제든 다시 볼 수 있어요."
!define MUI_FINISHPAGE_SHOWREADME "$INSTDIR\extension\guide.html"
!define MUI_FINISHPAGE_SHOWREADME_TEXT "설치 안내 열기 (브라우저에 추가하는 방법)"
!define MUI_FINISHPAGE_LINK "GitHub 에서 보기"
!define MUI_FINISHPAGE_LINK_LOCATION "${REPO_URL}"
!insertmacro MUI_PAGE_FINISH

!define MUI_UNCONFIRMPAGE_TEXT_TOP "풀림 확장 프로그램 파일과 업데이트 도우미를 지웁니다."
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "풀림을 지웠어요"
!define MUI_FINISHPAGE_TEXT "각 브라우저의 확장 프로그램 페이지(chrome://extensions · edge://extensions · whale://extensions)에서 풀림의 [삭제]도 눌러 주세요. 폴더가 없어져서 브라우저가 오류로 표시할 수 있어요."
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "Korean"

Function .onInit
  SetShellVarContext current
FunctionEnd

Section "풀림" SecMain
  SectionIn RO
  SetShellVarContext current
  SetOverwrite on

  ; 도우미가 업데이트 중이면 끝내고 덮어쓰기
  nsExec::Exec 'taskkill /F /IM PullimHelper.exe'
  Pop $0

  ; 확장 폴더: 예전 파일을 지우고 새로 (브라우저 쪽 설정은 브라우저에 저장돼 있어 그대로)
  RMDir /r "$INSTDIR\extension"
  SetOutPath "$INSTDIR\extension"
  File /r /x "install-info.json" "${ROOT}/extension/*.*"
  FileOpen $0 "$INSTDIR\extension\install-info.json" w
  FileWrite $0 '{"installer":"setup","helper":1,"version":"${VERSION}"}'
  FileClose $0

  SetOutPath "$INSTDIR"
  File "/oname=PullimHelper.exe" "${HELPER}"
  File "/oname=PullimHelper.exe.manifest" "${ROOT}/windows/PullimHelper.exe.manifest"
  File "/oname=pullim.ico" "${ROOT}/assets/pullim.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; 시작 메뉴
  CreateDirectory "${MENU_DIR}"
  CreateShortCut "${MENU_DIR}\풀림 설치 안내.lnk" "$INSTDIR\extension\guide.html" "" "$INSTDIR\pullim.ico"
  CreateShortCut "${MENU_DIR}\풀림 업데이트 확인.lnk" "$INSTDIR\PullimHelper.exe" "--now" "$INSTDIR\pullim.ico"
  CreateShortCut "${MENU_DIR}\풀림 확장 프로그램 폴더.lnk" "$INSTDIR\extension"
  CreateShortCut "${MENU_DIR}\풀림 제거.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\pullim.ico"

  ; 자동 업데이트: 로그인할 때(시작 프로그램) + 3시간마다(예약 작업)
  CreateShortCut "${STARTUP_LNK}" "$INSTDIR\PullimHelper.exe" "--startup" "$INSTDIR\pullim.ico"
  nsExec::Exec 'schtasks /Create /F /SC HOURLY /MO 3 /TN "${TASK_NAME}" /TR "\"$INSTDIR\PullimHelper.exe\""'
  Pop $0
  ${If} $0 != 0
    DetailPrint "예약 작업을 만들지 못했어요 ($0). 로그인할 때만 업데이트를 확인해요."
  ${EndIf}

  ; 앱 목록 (설정 → 앱)
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${FULLNAME}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\pullim.ico"
  WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "${UNINST_KEY}" "URLInfoAbout" "${REPO_URL}"
  WriteRegStr HKCU "${UNINST_KEY}" "HelpLink" "${REPO_URL}"
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" $0
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  nsExec::Exec 'taskkill /F /IM PullimHelper.exe'
  Pop $0
  nsExec::Exec 'schtasks /Delete /F /TN "${TASK_NAME}"'
  Pop $0
  Delete "${STARTUP_LNK}"
  RMDir /r "${MENU_DIR}"

  RMDir /r "$INSTDIR\extension"
  RMDir /r "$INSTDIR\staging"
  Delete "$INSTDIR\PullimHelper.exe"
  Delete "$INSTDIR\PullimHelper.exe.manifest"
  Delete "$INSTDIR\pullim.ico"
  Delete "$INSTDIR\helper.log"
  Delete "$INSTDIR\helper.log.1"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd
