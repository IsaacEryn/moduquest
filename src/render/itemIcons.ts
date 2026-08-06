import type { SpriteDef } from './sprites'
import type { ItemData } from '../core/types'

/**
 * 가방 칸에 놓일 아이템 그림.
 *
 * 캐릭터 스프라이트와 같은 방식이다 — 외부 파일 없이 픽셀을 코드로 두고 그린다.
 * 종류마다 실루엣이 다르고, 등급은 금속 색으로 갈린다. 그림은 장식이라
 * 화면에서 aria-hidden이고, 뜻은 언제나 곁의 글이 옮긴다.
 */

/** 16칸 격자에 맞춘다 — 짧게 적어도 뒤가 공백으로 채워진다 */
const grid = (rows: string[]): string[] => {
  const padded = rows.map((r) => r.padEnd(16, ' '))
  while (padded.length < 16) padded.push(' '.repeat(16))
  return padded.slice(0, 16)
}

const OUTLINE = '#1b2026'

/** 등급이 올라갈수록 금속이 밝아진다 — 색만으로 갈리지 않게 이름도 함께 보인다 */
const METAL = {
  1: { m: '#a8875f', M: '#6f5638' }, // 무쇠
  2: { m: '#b9c6d4', M: '#7c8b9c' }, // 정련
  3: { m: '#e8c65c', M: '#a8862c' }, // 울림
} as const

type Tier = 1 | 2 | 3

const WOOD = { w: '#8a6240', W: '#5c3f28' }

// ── 소모품 ──

const POTION = grid([
  '',
  '      kkkk',
  '      kggk',
  '      kggk',
  '     kkggkk',
  '    kgggggggk',
  '   kggggggggk',
  '   kgllllllgk',
  '   kglLLLLlgk',
  '   kglLLLLlgk',
  '   kgllllllgk',
  '   kggggggggk',
  '    kkkkkkkk',
])

// ── 무기 ──

const SWORD = grid([
  '           kk',
  '          kmk',
  '         kmMk',
  '        kmMk',
  '       kmMk',
  '      kmMk',
  '     kmMk',
  '    kmMk',
  '   kmMk',
  '  kkmkk',
  ' kHHHHHk',
  '  kkwkk',
  '   kwk',
  '   kWk',
  '   kkk',
])

const BOW = grid([
  '     kwwk',
  '    kwWWk',
  '   kwWk sk',
  '   kWk  sk',
  '  kwk   sk',
  '  kwk   sk',
  '  kwk   sk',
  '  kwk   sk',
  '  kwk   sk',
  '   kWk  sk',
  '   kwWk sk',
  '    kwWWk',
  '     kwwk',
])

const DAGGER = grid([
  '         kk',
  '        kmk',
  '       kmMk',
  '      kmMk',
  '     kmMk',
  '    kmMk',
  '   kkmkk',
  '  kHHHHk',
  '   kkwkk',
  '    kwk',
  '    kWk',
  '    kkk',
])

const STAFF = grid([
  '      kkk',
  '     kcCck',
  '    kcCCCck',
  '    kcCCCck',
  '     kcCck',
  '      kwk',
  '      kwk',
  '      kWk',
  '      kwk',
  '      kwk',
  '      kWk',
  '      kwk',
  '      kkk',
])

const AXE = grid([
  '    kkkkk',
  '   kmmmmmk',
  '  kmMMMMMmk',
  '  kmMMMMMmk',
  '   kmMMMkwk',
  '    kkkk kwk',
  '        kwk',
  '        kWk',
  '        kwk',
  '        kWk',
  '        kwk',
  '        kkk',
])

// ── 방어구 ──

const ARMOR = grid([
  '',
  '   kk      kk',
  '  kmmk    kmmk',
  ' kmMMmkkkkmMMmk',
  ' kmMMMMMMMMMMmk',
  ' kmMMMMMMMMMMmk',
  '  kmMMMMMMMMmk',
  '  kmMMMMMMMMmk',
  '  kmMMMMMMMMmk',
  '  kmMMMMMMMMmk',
  '   kmMMMMMMmk',
  '   kmmkkkkmmk',
  '   kkk    kkk',
])

const ROBE = grid([
  '',
  '    kk    kk',
  '   kcck  kcck',
  '  kcCCckkcCCck',
  '  kcCCCCCCCCck',
  '  kcCCCCCCCCck',
  '  kcCCCCCCCCck',
  '  kcCCCCCCCCck',
  ' kcCCCCCCCCCCck',
  ' kcCCCCCCCCCCck',
  ' kcCCCCCCCCCCck',
  ' kccccccccccck',
  '  kkkkkkkkkkk',
])

const SHOES = grid([
  '',
  '',
  '   kkkk',
  '   kmmk',
  '   kmMk',
  '   kmMk',
  '   kmMk',
  '   kmMkkkk',
  '   kmMMMMk',
  '  kmMMMMMk',
  '  kmmmmmmk',
  '  kkkkkkkk',
])

const GLOVES = grid([
  '',
  '     kk kk',
  '    kmkkmk',
  '    kmkkmk',
  '  kkkmmmmk',
  ' kmmmmmmmk',
  ' kmMMMMMMk',
  ' kmMMMMMMk',
  '  kmMMMMk',
  '  kmmmmmk',
  '  kkkkkkk',
])

// ── 특별한 것 ──

const BANNER = grid([
  '   kkkkkkkk',
  '   kcCCCCck',
  '   kcCCCCck',
  '   kcCCCCck',
  '   kcCCCck',
  '   kcCCck',
  '   kcCck',
  '   kwk',
  '   kwk',
  '   kWk',
  '   kwk',
  '   kkk',
])

const LAMP = grid([
  '      kk',
  '     kmMk',
  '    kkmmkk',
  '   kmMMMMmk',
  '  kmMlllLMmk',
  '  kmlLLLLlmk',
  '  kmlLLLLlmk',
  '  kmMlllLMmk',
  '   kmMMMMmk',
  '    kmmmmk',
  '     kkkk',
])

const KEEPSAKE = grid([
  '      kk',
  '     kcck',
  '    kcCCck',
  '   kcCCCCck',
  '  kcCCCCCCck',
  '  kcCCCCCCck',
  '   kcCCCCck',
  '    kcCCck',
  '     kcck',
  '      kk',
])

/** 물약은 담긴 것으로 색이 갈린다 — 이름과 색이 함께 말한다 */
const LIQUID = {
  heal: { l: '#f2a3a3', L: '#c94f4f' },
  mana: { l: '#a3c4f2', L: '#3f6fc9' },
  stamina: { l: '#a9e3a3', L: '#3f9c4f' },
} as const

function potionIcon(item: ItemData): SpriteDef {
  const kind = item.heal ? 'heal' : item.mana ? 'mana' : 'stamina'
  return {
    pixels: POTION,
    palette: { k: OUTLINE, g: '#cfd8e0', ...LIQUID[kind] },
  }
}

/** 무기는 생김새가 저마다 다르다 — 이름을 보지 않아도 활과 지팡이는 갈린다 */
function weaponPixels(id: string): string[] {
  if (id.includes('bow')) return BOW
  if (id.includes('dagger')) return DAGGER
  if (id.includes('staff') || id.includes('bell')) return STAFF
  if (id.includes('axe') || id.includes('club')) return AXE
  return SWORD
}

function tierOf(item: ItemData): Tier {
  return (item.tier ?? 1) as Tier
}

/**
 * 아이템 하나의 그림. 어떤 아이템이 와도 반드시 무언가를 돌려준다 —
 * 새 아이템을 데이터에 더했을 때 빈칸이 생기지 않아야 한다.
 */
export function iconForItem(id: string, item: ItemData): SpriteDef {
  if (item.kind === 'consumable') return potionIcon(item)
  if (item.kind === 'keepsake') {
    return { pixels: KEEPSAKE, palette: { k: OUTLINE, c: '#cfe6f2', C: '#7fb6d0' } }
  }

  const metal = METAL[tierOf(item)]
  const base = { k: OUTLINE, ...metal, ...WOOD, H: '#5c4a33' }

  // 곁의 동료를 밝히는 물건은 무기·방어구와 다른 얼굴을 갖는다
  if (item.allyStats) {
    const pixels = id.includes('lamp') || id.includes('lantern') ? LAMP : BANNER
    return { pixels, palette: { ...base, c: '#e0c46a', C: '#b8912f', l: '#fff0b8', L: '#f0c94f' } }
  }

  if (item.slot === 'weapon') {
    return { pixels: weaponPixels(id), palette: { ...base, c: '#cfe6f2', C: '#7fb6d0', s: '#d8d2c4' } }
  }
  if (item.slot === 'armor') {
    const robe = id.includes('robe')
    return robe
      ? { pixels: ROBE, palette: { ...base, c: '#b9a3e0', C: '#7a5fb0' } }
      : { pixels: ARMOR, palette: base }
  }
  if (item.slot === 'shoes') return { pixels: SHOES, palette: base }
  if (item.slot === 'gloves') return { pixels: GLOVES, palette: base }

  // 슬롯이 없는 장비 — 데이터가 늘어도 빈칸을 내지 않는다
  return { pixels: KEEPSAKE, palette: { k: OUTLINE, c: '#cfe6f2', C: '#7fb6d0' } }
}
