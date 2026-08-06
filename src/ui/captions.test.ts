import { describe, expect, it } from 'vitest'
// ?raw — 소스를 글자 그대로 읽는다. node의 fs를 쓰지 않는 것은 이 저장소가
// 타입 의존성을 늘리지 않기 위해서다(빌드는 Vite가 이 문법을 안다)
import announcerSource from './announcer.ts?raw'
import sfxSource from '../audio/sfx.ts?raw'

/**
 * "모든 효과음에 자막을 붙인다"는 청각장애 사용자에게 한 약속이다(docs/02-players.md).
 * 사람이 두 파일을 맞추는 대신 여기서 검사한다 — 실제로 어긋나 있었다.
 * 같은 소리를 쓰는 goldGained와 sold 중 한쪽에만 자막이 있었고,
 * 발소리·벽 부딪힘·차례 알림·방어·쓰러짐·패배는 소리만 나고 자막이 없었다.
 *
 * 소스를 읽어 검사하는 것은 이 저장소의 관례다 — 배포 워크플로도 innerHTML 보간을
 * 같은 방식으로 막는다. 규칙을 사람의 기억이 아니라 파이프라인에 맡긴다.
 */

/** switch의 case 라벨을 모은다 — 연달아 붙은 case(폴스루)도 각각 센다 */
function caseLabels(code: string): string[] {
  return [...code.matchAll(/case '([a-zA-Z]+)':/g)].map((m) => m[1])
}

/**
 * 자막을 부르는 case들. case 라벨부터 다음 case 라벨까지를 한 덩이로 보고,
 * 그 안에 caption 호출이 있으면 그 덩이에 속한 라벨 전부가 자막을 가진 것으로 친다.
 */
function captionedLabels(code: string): Set<string> {
  const out = new Set<string>()
  const parts = code.split(/case '([a-zA-Z]+)':/)
  // parts: [머리말, 라벨1, 본문1, 라벨2, 본문2, ...]
  let pending: string[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const label = parts[i]
    const body = parts[i + 1] ?? ''
    pending.push(label)
    // 본문이 사실상 비어 있으면 다음 case로 흘러가는 폴스루다
    if (body.trim().length === 0) continue
    if (body.includes('this.caption(')) for (const l of pending) out.add(l)
    pending = []
  }
  return out
}

describe('소리가 나는 곳에는 자막이 있다', () => {
  const sfx = sfxSource
  const announcer = announcerSource

  it('효과음이 있는 모든 사건에 자막이 붙어 있다', () => {
    const sounded = new Set(caseLabels(sfx.slice(sfx.indexOf('private handle'))))
    // 소리로 상태를 바꾸기만 하는 사건은 알릴 것이 없다
    sounded.delete('optionsChanged')
    const captioned = captionedLabels(announcer)
    const missing = [...sounded].filter((e) => !captioned.has(e))
    expect(missing, `자막 없는 효과음: ${missing.join(', ')}`).toEqual([])
  })

  it('자막은 대괄호 형식이다 — 소리라는 것이 글에서도 보여야 한다', () => {
    const texts = [...announcer.matchAll(/this\.caption\('([^']*)'\)/g)].map((m) => m[1])
    expect(texts.length).toBeGreaterThan(10)
    for (const t of texts) expect(t, t).toMatch(/^\[.+\]$/)
  })
})
