#!/usr/bin/env node
/**
 * 로고와 파비콘을 게임의 스프라이트에서 그대로 만든다.
 *
 * 아이덴티티를 따로 그리지 않는 이유: 파비콘 16×16에서 살아남는 그림은
 * 원래 그 크기로 설계된 픽셀아트뿐이고, 무엇보다 탭에 뜨는 얼굴과 게임 안
 * 얼굴이 같아야 "이 게임"이라고 알아본다.
 *
 * 다섯이 나란히 선 것이 로고다 — "같은 세계, 다른 렌즈"를 그림 하나로.
 *
 * 쓰는 법: node tools/buildBrand.mjs
 * 필요한 것: rsvg-convert, magick (둘 다 brew)
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'brand')

/** 스프라이트 정의를 TS 원본에서 읽는다 — 그림의 출처는 언제나 게임 쪽이다 */
async function loadSprites() {
  const src = join(ROOT, 'src', 'render', 'sprites.ts')
  const text = await import('node:fs/promises').then((fs) => fs.readFile(src, 'utf-8'))

  const SKIN = '#e8c39e'
  const out = {}
  for (const job of ['warrior', 'rogue', 'archer', 'mage', 'healer']) {
    const block = text.match(new RegExp(`\\n  ${job}: \\{\\n([\\s\\S]*?)\\n  \\},\\n`))
    if (!block) throw new Error(`${job} 스프라이트를 찾지 못했다`)
    const body = block[1]

    const palText = body.match(/palette: \{([\s\S]*?)\}/)[1]
    const palette = {}
    for (const m of palText.matchAll(/(\w+):\s*(SKIN|'([^']*)')/g)) {
      palette[m[1]] = m[2] === 'SKIN' ? SKIN : m[3]
    }

    const pixText = body.match(/pixels: \[([\s\S]*?)\]/)[1]
    const pixels = [...pixText.matchAll(/'([^']*)'/g)].map((m) => m[1])
    if (pixels.length !== 16) throw new Error(`${job}의 줄 수가 16이 아니다: ${pixels.length}`)
    out[job] = { palette, pixels }
  }
  return out
}

const OUTLINE = '#0d1013'

/**
 * 픽셀 격자를 SVG 사각형들로. 게임의 drawSprite와 같은 규칙이다 —
 * 채워진 칸 둘레에 테두리를 한 겹 둘러 배경색과 무관하게 실루엣이 남는다.
 */
function spriteRects(def, ox, oy) {
  const size = def.pixels.length
  const filled = (x, y) =>
    y >= 0 && y < size && x >= 0 && x < size && !!def.palette[def.pixels[y][x]]
  const parts = []

  const outline = []
  for (let y = -1; y <= size; y++) {
    for (let x = -1; x <= size; x++) {
      if (filled(x, y)) continue
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) {
        outline.push(`M${ox + x + 1} ${oy + y + 1}h1v1h-1z`)
      }
    }
  }
  if (outline.length) parts.push(`<path fill="${OUTLINE}" d="${outline.join('')}"/>`)

  // 같은 색끼리 묶어 path 하나로 — 파일이 작아지고 읽기도 쉽다
  const byColor = new Map()
  def.pixels.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = def.palette[row[x]]
      if (!color) continue
      if (!byColor.has(color)) byColor.set(color, [])
      byColor.get(color).push(`M${ox + x + 1} ${oy + y + 1}h1v1h-1z`)
    }
  })
  for (const [color, d] of byColor) {
    parts.push(`<path fill="${color}" d="${d.join('')}"/>`)
  }
  return parts.join('')
}

const svg = (w, h, body, title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${title}">` +
  `<title>${title}</title>${body}</svg>\n`

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: 'inherit' })
}

const sprites = await loadSprites()
mkdirSync(OUT, { recursive: true })

// ── 파비콘: 힐러 하나를 게임 배경색 위에.
//    다섯을 16px에 욱여넣으면 뭉개지고, 배경이 없으면 흰 로브가 밝은 탭에 묻힌다.
//    어두운 판을 깔면 밝은 탭에서도 어두운 탭에서도 같은 얼굴로 선다 ──
{
  const pad = 1
  const box = 16 + pad * 2
  const body =
    `<rect width="${box}" height="${box}" rx="3" fill="#101418"/>` +
    spriteRects(sprites.healer, pad, pad)
  writeFileSync(join(OUT, 'favicon.svg'), svg(box, box, body, '모두의 원정대'))
}

// ── 로고: 다섯이 나란히. 이 게임이 무엇인지 그림 하나로 ──
{
  const gap = 2
  const step = 16 + 2 + gap // 스프라이트 16 + 테두리 2 + 사이
  const width = step * 5 - gap
  const body = ['warrior', 'rogue', 'archer', 'mage', 'healer']
    .map((job, i) => spriteRects(sprites[job], i * step, 0))
    .join('')
  writeFileSync(join(OUT, 'logo.svg'), svg(width, 18, body, '모두의 원정대'))
}

// ── 나눔 카드(1200×630): 링크를 붙였을 때 뜨는 얼굴 ──
{
  const gap = 4
  const step = 16 + 2 + gap
  const row = step * 5 - gap
  const w = 1200
  const h = 630
  // 다섯이 가로로 다 들어가야 한다 — 폭에서 배율을 거꾸로 구한다
  const scale = Math.floor((w * 0.85) / row)
  const x = Math.round((w - row * scale) / 2)
  // 캐릭터·제목·부제를 한 덩어리로 보고 세로 가운데에 놓는다
  const y = 150
  const chars = ['warrior', 'rogue', 'archer', 'mage', 'healer']
    .map((job, i) => spriteRects(sprites[job], i * step, 0))
    .join('')
  const body =
    `<rect width="${w}" height="${h}" fill="#101418"/>` +
    `<g transform="translate(${x} ${y}) scale(${scale})">${chars}</g>` +
    `<text x="${w / 2}" y="${y + 18 * scale + 96}" fill="#f2f5f7" font-size="76" font-weight="700" text-anchor="middle" font-family="'Apple SD Gothic Neo','Malgun Gothic',sans-serif">모두의 원정대</text>` +
    `<text x="${w / 2}" y="${y + 18 * scale + 156}" fill="#b7c2cc" font-size="32" text-anchor="middle" font-family="'Apple SD Gothic Neo','Malgun Gothic',sans-serif">서로 다른 방식으로 감각하는 동료들이 한 파티로 떠나는 모험</text>`
  writeFileSync(join(OUT, 'og-card.svg'), svg(w, h, body, '모두의 원정대'))
}

// ── 래스터 산출물 ──
// 픽셀아트라 확대는 반드시 최근접 이웃(nearest) — 부드럽게 늘리면 죽는다
const png = (src, out, size) =>
  run('rsvg-convert', ['-w', String(size), '-h', String(size), '-o', out, src])

const fav = join(OUT, 'favicon.svg')
png(fav, join(OUT, 'icon-32.png'), 32)
png(fav, join(OUT, 'icon-180.png'), 180) // apple-touch-icon
png(fav, join(OUT, 'icon-192.png'), 192)
png(fav, join(OUT, 'icon-512.png'), 512)

// .ico는 16·32 두 벌을 담는다 — 옛 브라우저와 즐겨찾기 목록용
png(fav, join(OUT, '_ico16.png'), 16)
run('magick', [
  join(OUT, '_ico16.png'),
  join(OUT, 'icon-32.png'),
  join(OUT, 'favicon.ico'),
])
run('rm', [join(OUT, '_ico16.png')])

run('rsvg-convert', [
  '-w', '1200', '-h', '630',
  '-o', join(OUT, 'og-card.png'),
  join(OUT, 'og-card.svg'),
])

console.log('브랜드 자산을 public/brand에 만들었다.')
