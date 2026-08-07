import { resistTagOf } from '../core/resist'
import type { Resist } from '../core/types'

/**
 * 몹의 약점을 말로 옮긴다.
 *
 * 상성은 확률이 아니라 고정 배율이라 한 번 배우면 영원히 같다. 그런데 "배우면
 * 된다"를 그대로 두면 결국 외운 사람만 유리해진다 — 기억에 기대는 규칙은
 * 인지적 부담이 큰 사람에게 조용한 벽이 된다.
 *
 * 그래서 전투가 시작될 때마다 다시 말해 주고, 때릴 때마다 결과로도 알린다.
 * 외우지 않아도 그 자리에서 알 수 있으면 그것은 기억력 시험이 아니라 판단이 된다.
 * 수치는 데이터에서 조립하므로 배율을 고치면 문장이 저절로 따라온다.
 */

/**
 * "물리에 강하고 마법에 약하다" — 치우침이 없으면 null.
 * 어느 쪽이 이득인지 먼저 말하지 않는다. 강한 쪽부터 말해야 "그럼 반대로 가자"가
 * 자연스럽게 이어진다.
 */
export function resistLine(resist: Resist | undefined): string | null {
  const strong = resistTagOf(resist, 'physical') === 'strong' ? '물리' : null
  const magicStrong = resistTagOf(resist, 'magic') === 'strong' ? '마법' : null
  const weak = resistTagOf(resist, 'physical') === 'weak' ? '물리' : null
  const magicWeak = resistTagOf(resist, 'magic') === 'weak' ? '마법' : null

  const strongSide = strong ?? magicStrong
  const weakSide = weak ?? magicWeak
  if (!strongSide && !weakSide) return null
  if (strongSide && weakSide) return `${strongSide}에 강하고 ${weakSide}에 약하다`
  if (strongSide) return `${strongSide}에 강하다`
  return `${weakSide}에 약하다`
}

/** 몹 이름을 붙인 한 줄. 낭독과 화면이 같은 문장을 쓴다 */
export function monsterResistLine(name: string, resist: Resist | undefined): string | null {
  const line = resistLine(resist)
  return line ? `${name} — ${line}.` : null
}

/**
 * 짧은 꼬리표. 전투 화면의 대상 목록에 붙는다.
 * 긴 문장을 잘라 쓰지 않고 따로 조립한다 — 자른 문장은 "물리에 강· 마법에 약"처럼
 * 어디서도 끝나지 않는 말이 된다.
 */
export function resistBadge(resist: Resist | undefined): string | null {
  if (!resist) return null
  const parts: string[] = []
  for (const [type, ko] of [
    ['physical', '물리'],
    ['magic', '마법'],
  ] as const) {
    const tag = resistTagOf(resist, type)
    if (tag === 'strong') parts.push(`${ko} 강함`)
    else if (tag === 'weak') parts.push(`${ko} 약함`)
  }
  return parts.length ? parts.join(' · ') : null
}
