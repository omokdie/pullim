"""확장 폴더 → zip (파일 순서 · 시각을 고정해서 같은 내용이면 같은 zip)"""
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
SKIP = {'.DS_Store', 'Thumbs.db'}
entries = []
for base, dirs, files in os.walk(src):
    dirs.sort()
    for f in sorted(files):
        if f in SKIP or f.startswith('.'):
            continue
        full = os.path.join(base, f)
        entries.append((os.path.relpath(full, src).replace(os.sep, '/'), full))
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for rel, full in entries:
        info = zipfile.ZipInfo(rel, date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = zipfile.ZIP_DEFLATED
        info.external_attr = 0o644 << 16
        z.writestr(info, open(full, 'rb').read())
print(f'{out}: {len(entries)} files')
