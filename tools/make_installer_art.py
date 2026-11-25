"""설치 프로그램 그림: assets/installer-side.bmp (164x314, 환영 · 마침 화면 왼쪽)"""
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
W, H, S = 164, 314, 3  # 3배로 그린 뒤 줄여서 매끄럽게
img = Image.new('RGB', (W * S, H * S))
top, bot = (52, 216, 187), (9, 92, 82)
d = ImageDraw.Draw(img)
for y in range(H * S):
    t = y / (H * S - 1)
    d.line([(0, y), (W * S, y)], fill=tuple(int(top[i] + (bot[i] - top[i]) * t) for i in range(3)))
logo = Image.open(os.path.join(ROOT, 'extension/icons/icon128.png')).convert('RGBA').resize((96 * S, 96 * S), Image.LANCZOS)
# 로고 둘레를 살짝 밝게
glow = Image.new('RGBA', logo.size, (255, 255, 255, 0))
img.paste(logo, ((W * S - logo.size[0]) // 2, 58 * S), logo)
font_path = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
big = ImageFont.truetype(font_path, 30 * S, index=1)  # KR
small = ImageFont.truetype(font_path, 11 * S, index=1)
def center(text, y, font, fill):
    w = d.textlength(text, font=font)
    d.text(((W * S - w) / 2, y), text, font=font, fill=fill)
center('풀림', 168 * S, big, (255, 255, 255))
for i, line in enumerate(['우클릭 · 드래그 · 복사', '제한을 풀어 줘요']):
    center(line, (214 + i * 18) * S, small, (225, 247, 242))
center('크롬 · 엣지 · 웨일', 284 * S, small, (190, 232, 224))
img = img.resize((W, H), Image.LANCZOS)
img.save(os.path.join(ROOT, 'assets/installer-side.bmp'))
print('ok', img.size)
