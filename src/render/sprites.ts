/**
 * 픽셀 스프라이트를 코드로 그린다. 외부 에셋을 쓰지 않으므로 라이선스 문제가 없고,
 * 저자극 모드의 채도 낮춘 팔레트도 같은 그림에서 바로 만들어 낼 수 있다.
 *
 * 각 스프라이트는 문자 하나가 픽셀 하나인 16×16 격자다. 공백은 투명.
 */

export interface SpriteDef {
  pixels: string[]
  palette: Record<string, string>
}

const SKIN = '#e8c39e'

/** 골렘 형제는 같은 몸을 쓰고 팔레트만 다르다 */
const GOLEM_PIXELS = [
  '                ',
  '   rrrrrrrrrr   ',
  '  rRRRRRRRRRRr  ',
  '  rRRrrrrrrRRr  ',
  '  rReRRRRRReRr  ',
  '  rRRRRRRRRRRr  ',
  '  rRRRddddRRRr  ',
  ' rrrRRRRRRRRrrr ',
  ' rRrRRRRRRRRrRr ',
  ' rRrRRRRRRRRrRr ',
  ' rRrRRRRRRRRrRr ',
  ' rrrRRRRRRRRrrr ',
  '    RRRR RRRR   ',
  '    rrrr rrrr   ',
  '   RRRRR RRRRR  ',
  '                ',
]

export const SPRITES: Record<string, SpriteDef> = {
  // 도적 — 후드와 단검, 날렵한 실루엣.
  // 숲 바닥이 초록이라 후드는 대비되는 남색 계열로 둔다(색만이 아니라 형태로도 구분되게)
  rogue: {
    palette: { h: '#5a6ea8', H: '#3c4a76', s: SKIN, d: '#c9ced4', b: '#2a3038' },
    pixels: [
      '                ',
      '     hhhhhh     ',
      '    hHHHHHHh    ',
      '    hHssssHh    ',
      '    hHsbsbsh    ',
      '    hHssssHh    ',
      '     hHssHh     ',
      '    hhhhhhhh    ',
      '   hHhhhhhhHh d ',
      '  hHhhhhhhhhHhd ',
      '  hh hhhhhh hhd ',
      '     hhhhhh   d ',
      '     hh  hh     ',
      '     hh  hh     ',
      '    bbb  bbb    ',
      '                ',
    ],
  },
  // 전사 — 투구와 방패, 두꺼운 어깨
  warrior: {
    palette: { a: '#8fa6b8', A: '#5c7182', s: SKIN, r: '#b5573f', b: '#2a3038' },
    pixels: [
      '                ',
      '     aaaaaa     ',
      '    aAAAAAAa    ',
      '    aAssssAa    ',
      '    aAsbsbsa    ',
      '    aAssssAa    ',
      '     aAssAa     ',
      '   aaaaaaaaaa   ',
      '  aAaarrrraaAa  ',
      '  aAaarrrraaAa  ',
      '  aa aaaaaa aa  ',
      '     aaaaaa     ',
      '     aa  aa     ',
      '     aa  aa     ',
      '    bbb  bbb    ',
      '                ',
    ],
  },
  // 힐러 — 두건과 지팡이, 부드러운 윤곽
  healer: {
    palette: { c: '#d8e3ec', C: '#9fb3c4', s: SKIN, g: '#7fd08a', w: '#a97f4f' },
    pixels: [
      '                ',
      '     cccccc     ',
      '    cCCCCCCc    ',
      '    cCssssCc    ',
      '    cCsssssc    ',
      '    cCssssCc    ',
      '     cCssCc     ',
      '    cccccccc  g ',
      '   cCccggcccC w ',
      '  cCcccggccccCw ',
      '  cc ccggcc ccw ',
      '     cccccc   w ',
      '     cccccc   w ',
      '    cccccccc  w ',
      '   cccccccccc   ',
      '                ',
    ],
  },
  // 궁수 — 초록 두건에 옆으로 든 활. 활 곡선이 실루엣을 만든다
  archer: {
    palette: { g: '#5e8f52', G: '#3f6338', s: SKIN, w: '#a97f4f', t: '#d8d3c0' },
    pixels: [
      '                ',
      '     gggggg     ',
      '    gGGGGGGg    ',
      '    gGssssGg    ',
      '    gGsttssg    ',
      '    gGssssGg    ',
      '     gGssGg   w ',
      '    gggggggg ww ',
      '   gGgggggggGw  ',
      '  gGggggggggw   ',
      '  gg gggggg w   ',
      '     gggggg ww  ',
      '     gg  gg  w  ',
      '     gg  gg     ',
      '    GGG  GGG    ',
      '                ',
    ],
  },
  // 마법사 — 뾰족한 보라 모자와 지팡이 끝의 빛
  mage: {
    palette: { m: '#7d6bb0', M: '#554687', s: SKIN, w: '#6b4a2f', l: '#ffd166' },
    pixels: [
      '       m        ',
      '      mmm       ',
      '     mmMmm      ',
      '    mmMMMmm     ',
      '   mmmmmmmmm    ',
      '    mMssssMm    ',
      '    mMsmsmsm  l ',
      '    mMssssMm  w ',
      '     mmmmmm   w ',
      '   mmMmmmmMmm w ',
      '  mMmmmmmmmmMmw ',
      '  mm mmmmmm mmw ',
      '     mmmmmm   w ',
      '    mmmmmmmm    ',
      '   mmmmmmmmmm   ',
      '                ',
    ],
  },
  // 슬라임 — 둥글고 말랑한 덩어리
  slime: {
    palette: { s: '#6fbf8a', S: '#4a8f64', e: '#16241c', l: '#b7e8c8' },
    pixels: [
      '                ',
      '                ',
      '      ssss      ',
      '    sslssssS    ',
      '   sslsssssSS   ',
      '  sslssssssSS   ',
      '  sssssssssSS   ',
      ' ssseessseesSS  ',
      ' ssseessseesSS  ',
      ' ssssssssssssS  ',
      ' ssssssssssssS  ',
      ' SssssssssssSS  ',
      '  SSssssssSSS   ',
      '   SSSSSSSSS    ',
      '                ',
      '                ',
    ],
  },
  // 고블린 — 뾰족한 귀와 몽둥이
  goblin: {
    palette: { g: '#8fae5c', G: '#5f7a3a', e: '#c8412c', b: '#6b4a2f', t: '#f0f0e0' },
    pixels: [
      '                ',
      '  g          g  ',
      '  gg  gggg  gg  ',
      '  ggggGGGGgggg  ',
      '   ggGGGGGGgg   ',
      '   gGeGGGGeGg   ',
      '   gGGGGGGGGg   ',
      '   gGGttttGGg   ',
      '    gGGGGGGg  b ',
      '   ggggggggg  b ',
      '  gGgggggggGg b ',
      '  gg gggggg gbb ',
      '     gg  gg     ',
      '     gg  gg     ',
      '    GGG  GGG    ',
      '                ',
    ],
  },
  // 돌 골렘 — 각지고 큰 바위 덩어리
  golem: {
    palette: { r: '#8b8f96', R: '#5c6067', e: '#e0b050', d: '#3a3d42' },
    pixels: GOLEM_PIXELS,
  },
  // 울림 골렘 — 같은 몸에 파란 울림돌. 숲의 골렘과 형제라는 걸 형태로 보여준다
  golem_echo: {
    palette: { r: '#7a8fa8', R: '#4a5c72', e: '#8fd0e8', d: '#2e3a48' },
    pixels: GOLEM_PIXELS,
  },
  // 굴박쥐 — 펼친 날개. 가로로 넓어 다른 몹과 실루엣이 겹치지 않는다
  bat: {
    palette: { b: '#6b5a7a', B: '#463a55', w: '#9a8aa8', e: '#e0b050' },
    pixels: [
      '                ',
      '                ',
      '  bb        bb  ',
      ' bBBb      bBBb ',
      ' bBBBb    bBBBb ',
      ' bBBBBb  bBBBBb ',
      ' bBBBBBbwwBBBBBb',
      ' bBBBBBbwwBBBBBb',
      '  bBBBwwwwwwBBb ',
      '   bBBweewwBBb  ',
      '    bwwwwwwwb   ',
      '      wwwwww    ',
      '       wwww     ',
      '        ww      ',
      '                ',
      '                ',
    ],
  },
  // 울림 조각 — 마름모 결정. 생물이 아니라 사물이라는 게 형태로 드러난다
  shard: {
    palette: { c: '#8fd0e8', C: '#3f7c98', l: '#e8f6ff' },
    pixels: [
      '                ',
      '       c        ',
      '      ccc       ',
      '      cCc       ',
      '     ccCcc      ',
      '     cCCCc      ',
      '    ccCCCcc     ',
      '    cCClCCc     ',
      '    cCClCCc     ',
      '    cCCCCCc     ',
      '     cCCCc      ',
      '     cCCCc      ',
      '      cCc       ',
      '      ccc       ',
      '       c        ',
      '                ',
    ],
  },
  // 종지기 — 놋쇠빛 옷에 종을 들었다. 힐러와 겹치지 않게 어깨를 넓게
  keeper: {
    palette: { k: '#b8a06a', K: '#8a7448', e: '#e8f6ff', b: '#e0c060', B: '#d8c070' },
    pixels: [
      '                ',
      '     kkkkkk     ',
      '    kKKKKKKk    ',
      '    kKeKKeKk    ',
      '    kKKKKKKk    ',
      '     kKKKKk     ',
      '   kkkkkkkkkk   ',
      '  kKkkkkkkkKk B ',
      '  kKkkbbkkkKkBBB',
      '  kk kkbbkk kBBB',
      '     kkkkkk  BBB',
      '     kkkkkk   B ',
      '    kkkkkkkk    ',
      '   kkkkkkkkkk   ',
      '   kkkkkkkkkk   ',
      '                ',
    ],
  },
}

/** 색을 회색 쪽으로 당긴다 — 저자극 모드용 팔레트 */
export function desaturate(hex: string, amount = 0.55): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  const mix = (c: number) => Math.round(c + (gray - c) * amount)
  return `#${((mix(r) << 16) | (mix(g) << 8) | mix(b)).toString(16).padStart(6, '0')}`
}

const OUTLINE = '#0d1013'

/**
 * 픽셀 격자를 캔버스로 그려 텍스처 소스로 쓴다.
 * 바깥 테두리를 한 겹 두르는 이유는 배경색과 관계없이 실루엣이 살아 있어야
 * 저시력·인지 접근성에 유리하기 때문이다(색 대비에만 기대지 않는다).
 */
export function drawSprite(def: SpriteDef, scale: number, lowStim: boolean): HTMLCanvasElement {
  const size = def.pixels.length
  const canvas = document.createElement('canvas')
  canvas.width = (size + 2) * scale
  canvas.height = (size + 2) * scale
  const ctx = canvas.getContext('2d')!
  const filled = (x: number, y: number) =>
    y >= 0 && y < size && x >= 0 && x < size && !!def.palette[def.pixels[y][x]]

  // 1) 채워진 픽셀에 이웃한 빈 칸을 테두리로
  ctx.fillStyle = OUTLINE
  for (let y = -1; y <= size; y++) {
    for (let x = -1; x <= size; x++) {
      if (filled(x, y)) continue
      const touching =
        filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)
      if (touching) ctx.fillRect((x + 1) * scale, (y + 1) * scale, scale, scale)
    }
  }

  // 2) 본체
  def.pixels.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = def.palette[row[x]]
      if (!color) continue
      ctx.fillStyle = lowStim ? desaturate(color) : color
      ctx.fillRect((x + 1) * scale, (y + 1) * scale, scale, scale)
    }
  })
  return canvas
}

/** 타일 텍스처: 같은 좌표면 같은 무늬가 나오도록 결정적으로 얼룩을 찍는다 */
export function drawTile(
  base: string,
  speck: string,
  size: number,
  lowStim: boolean,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = lowStim ? desaturate(base) : base
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = lowStim ? desaturate(speck) : speck
  const step = 4
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      // 좌표 해시 — 무작위처럼 보이지만 항상 같은 무늬
      if (((x * 73856093) ^ (y * 19349663)) % 7 === 0) {
        ctx.fillRect(x, y, step / 2, step / 2)
      }
    }
  }
  return canvas
}
