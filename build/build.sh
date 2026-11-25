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

# 도우미는 윈도우의 .NET Framework(4.5~4.8.1)에서 돈다 → 모노 라이브러리가 아니라 4.5 참조 어셈블리에 맞춰 컴파일
# (모노에만 있는 String.Split(char, ...) 같은 것이 섞이면 윈도우에서 MissingMethodException)
REF="$OUT/net45"
NUPKG_SHA=23a9f94ea3e2cb88cd8341af75b811c6fb5cb82516fc696e95ed4620279128e3
if [ ! -f "$REF/mscorlib.dll" ]; then
  mkdir -p "$REF"
  curl -sSL -o "$OUT/net45.nupkg" \
    https://api.nuget.org/v3-flatcontainer/microsoft.netframework.referenceassemblies.net45/1.0.3/microsoft.netframework.referenceassemblies.net45.1.0.3.nupkg
  echo "$NUPKG_SHA  $OUT/net45.nupkg" | sha256sum -c -
  python3 - "$OUT/net45.nupkg" "$REF" <<'PY'
import sys, zipfile, os
z = zipfile.ZipFile(sys.argv[1])
for n in ('mscorlib', 'System', 'System.Core', 'System.IO.Compression', 'System.IO.Compression.FileSystem'):
    open(os.path.join(sys.argv[2], n + '.dll'), 'wb').write(z.read(f'build/.NETFramework/v4.5/{n}.dll'))
PY
fi
mcs -target:winexe -platform:anycpu -optimize+ -codepage:utf8 -nologo -nostdlib -noconfig \
  -r:"$REF/mscorlib.dll" -r:"$REF/System.dll" -r:"$REF/System.Core.dll" \
  -r:"$REF/System.IO.Compression.dll" -r:"$REF/System.IO.Compression.FileSystem.dll" \
  -win32icon:assets/pullim.ico -out:"$OUT/PullimHelper.exe" windows/PullimHelper.cs

makensis -INPUTCHARSET UTF8 -V2 -DVERSION="$VER" -DROOT="$ROOT" -DHELPER="$OUT/PullimHelper.exe" \
  -DOUTFILE="$DIST/Pullim-Setup-$VER.exe" windows/installer.nsi

python3 build/make_latest.py "$VER" > /dev/null
# README 의 '최신 버전 받기' 링크용 (버전 없는 이름)
cp "$DIST/Pullim-Setup-$VER.exe" "$DIST/Pullim-Setup.exe"
cp "$DIST/pullim-extension-$VER.zip" "$DIST/pullim-extension.zip"
ls -l "$DIST"
