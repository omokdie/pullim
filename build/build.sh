#!/usr/bin/env bash
# 릴리스 파일 만들기 → dist/  (필요: python3, mcs(mono-mcs), makensis(nsis))
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
VER=$(python3 -c "import json;print(json.load(open('extension/manifest.json'))['version'])")
OUT="$ROOT/build/out"
DIST="$ROOT/dist"
rm -rf "$DIST"
mkdir -p "$OUT" "$DIST"
echo "== 풀림 $VER"

python3 build/make_zip.py extension "$DIST/pullim-extension-$VER.zip"

mcs -target:winexe -platform:anycpu -optimize+ -codepage:utf8 -nologo \
  -r:System.IO.Compression.dll -r:System.IO.Compression.FileSystem.dll \
  -win32icon:assets/pullim.ico -out:"$OUT/PullimHelper.exe" windows/PullimHelper.cs

makensis -INPUTCHARSET UTF8 -V2 -DVERSION="$VER" -DROOT="$ROOT" -DHELPER="$OUT/PullimHelper.exe" \
  -DOUTFILE="$DIST/Pullim-Setup-$VER.exe" windows/installer.nsi

python3 build/make_latest.py "$VER" > /dev/null
# README 의 '최신 버전 받기' 링크용 (버전 없는 이름)
cp "$DIST/Pullim-Setup-$VER.exe" "$DIST/Pullim-Setup.exe"
cp "$DIST/pullim-extension-$VER.zip" "$DIST/pullim-extension.zip"
ls -l "$DIST"
