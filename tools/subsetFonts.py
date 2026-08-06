#!/usr/bin/env python3
"""글꼴을 이 게임이 쓰는 글자만으로 줄인다.

CREDITS.md는 오래전부터 "한글 서브셋으로 만들어 제공한다"고 적어 왔지만 실제로는
원본 그대로였다 — 세 파일에 한글 11,172자가 전부 들어 있어 1.37MB였다. Phaser 다음으로
큰 다운로드였고, 느린 회선에서 첫 화면까지 걸리는 시간은 접근성 문제이기도 하다.

담는 글자
  1. KS X 1001 상용 한글 2,350자 — 함께 하기의 별명은 사람이 짓는 것이라
     저장소에 있는 글자만으로 줄이면 남의 이름이 깨진다. 상용 음절은 남긴다.
  2. 저장소가 실제로 쓰는 모든 글자 — 대사·아이템 이름·도움말까지.
  3. ASCII와 흔한 문장부호.
그 밖의 드문 음절은 글꼴 스택의 다음 글꼴(Apple SD Gothic Neo·system-ui)이 그린다.
`font-display: swap`도 있으므로 글자가 안 보이는 경우는 없다.

되돌리거나 다시 만들려면 원본을 받아 이 스크립트를 다시 돌린다.
  Pretendard  https://github.com/orioncactus/pretendard  (SIL OFL 1.1)
  Galmuri11   https://galmuri.quiple.dev                 (SIL OFL 1.1)

    python3 -m pip install 'fonttools[woff]' brotli
    python3 tools/subsetFonts.py <원본이 있는 폴더>

인자를 주지 않으면 지금 저장소의 글꼴을 제자리에서 줄인다(이미 줄인 것을 다시
줄여도 결과는 같다 — 글자가 늘어나지는 않으니 원본이 필요하면 위 주소에서 받을 것).
"""

import os
import sys
from glob import glob

from fontTools import subset

FONTS = ['Pretendard-Regular', 'Pretendard-Bold', 'Galmuri11']
FONT_DIR = os.path.join('src', 'assets', 'fonts')
# 저장소에서 글자를 긁어올 곳 — 문장은 코드와 데이터 양쪽에 있다
SOURCES = ['src/**/*.ts', 'src/**/*.json', 'src/**/*.css', 'index.html', 'tools/*.mjs', 'docs/*.md']
PUNCTUATION = '·—…‘’“”±×÷→←↑↓•©®°※「」『』〈〉'


def ks_x_1001_hangul() -> set:
    """상용 한글 2,350자. euc-kr 코덱이 곧 그 표다."""
    out = set()
    for lead in range(0xB0, 0xC9):
        for trail in range(0xA1, 0xFF):
            try:
                out.add(bytes([lead, trail]).decode('euc-kr'))
            except UnicodeDecodeError:
                pass
    return out


def chars_in_repo() -> set:
    out = set()
    for pattern in SOURCES:
        for path in glob(pattern, recursive=True):
            with open(path, encoding='utf-8') as f:
                out |= set(f.read())
    return out


def main() -> None:
    source_dir = sys.argv[1] if len(sys.argv) > 1 else FONT_DIR
    chars = ks_x_1001_hangul() | chars_in_repo()
    chars |= {chr(c) for c in range(0x20, 0x7F)} | set(PUNCTUATION)
    chars = {c for c in chars if ord(c) > 0x1F}
    text = ''.join(sorted(chars))
    print(f'담을 글자 {len(chars)}자')

    for name in FONTS:
        src = os.path.join(source_dir, f'{name}.woff2')
        dst = os.path.join(FONT_DIR, f'{name}.woff2')
        before = os.path.getsize(src)
        subset.main([
            src,
            f'--text={text}',
            '--layout-features=*',
            '--flavor=woff2',
            '--no-hinting',
            '--desubroutinize',
            f'--output-file={dst}.tmp',
        ])
        os.replace(f'{dst}.tmp', dst)
        after = os.path.getsize(dst)
        print(f'{name}: {before // 1024}K → {after // 1024}K')


if __name__ == '__main__':
    main()
