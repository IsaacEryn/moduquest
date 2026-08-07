import type { ItemData, StatBlock } from '../core/types'

/**
 * 아이템 한 점을 글로 옮기는 곳. 상점·가방·상태창이 전부 여기를 쓴다.
 *
 * 화면마다 따로 문장을 만들면 언젠가 상점과 상태창이 다른 수치를 말하게 된다.
 * 그러면 낭독으로 게임하는 사람이 잘못된 정보로 결정하게 되니까 한 곳에 모았다.
 */

/** 오른 것은 +, 깎인 것은 - 그대로 — 무거운 장비의 대가를 감추지 않는다 */
export const signed = (v: number) => (v > 0 ? `+${v}` : `${v}`)

const STAT_ORDER = ['체력', '마력', '물리 공격', '마법 공격', '물리 방어', '마법 방어', '속도'] as const

function statBits(stats: StatBlock | undefined): string[] {
  if (!stats) return []
  const named: Record<string, number | undefined> = {
    체력: stats.hp,
    마력: stats.mp,
    '물리 공격': stats.patk,
    '마법 공격': stats.matk,
    '물리 방어': stats.pdef,
    '마법 방어': stats.mdef,
    속도: stats.spd,
  }
  return STAT_ORDER.filter((k) => (named[k] ?? 0) !== 0).map(
    (k) => `${k} ${signed(named[k] as number)}`,
  )
}

/** 소모품이 하는 일 — 장비의 능력치와 같은 자리에 같은 모양으로 적는다 */
export function consumableEffect(item: ItemData): string {
  const parts: string[] = []
  if (item.heal) parts.push(`체력 ${item.heal} 회복`)
  if (item.mana) parts.push(`마력 ${item.mana} 회복`)
  if (item.cooldownCut) parts.push(`기술 대기 ${item.cooldownCut} 감소`)
  return parts.join(' · ')
}

/**
 * 아이템의 효과 한 줄. 장비면 능력치, 소모품이면 회복량.
 * 수치는 전부 데이터에서 조립하니 설명과 실제가 어긋날 일이 없다.
 */
export function describeItem(item: ItemData, setName?: string): string {
  if (item.kind === 'consumable') return consumableEffect(item)

  const parts: string[] = []
  const bits = statBits(item.stats)
  if (bits.length) parts.push(bits.join(' '))

  const auraBits = statBits(item.allyStats)
  if (auraBits.length) parts.push(`동료 ${auraBits.join(' ')}`)

  if (setName) parts.push(setName)
  if (item.minLevel) parts.push(`${item.minLevel}레벨부터`)
  return parts.join(' · ')
}

const SLOT_LABEL: Record<string, string> = {
  weapon: '무기',
  armor: '갑옷',
  shoes: '신발',
  gloves: '장갑',
}

const TIER_LABEL: Record<number, string> = { 1: '일반', 2: '정련', 3: '울림' }

/** "정련 무기" 같은 갈래 표시. 색으로만 등급을 나누지 않으려고 글로도 적는다 */
export function categoryOf(item: ItemData): string {
  if (item.kind === 'consumable') return '소모품'
  if (item.kind === 'keepsake') return '추억의 물건'
  const tier = item.tier ? TIER_LABEL[item.tier] : ''
  const slot = item.slot ? SLOT_LABEL[item.slot] : '장비'
  return [tier, slot].filter(Boolean).join(' ')
}

/**
 * 스크린리더가 읽을 칸 하나의 이름.
 * 그림은 aria-hidden이라 여기 담기지 않은 것은 화면을 못 보는 사람에게 없는 것과 같다.
 */
export function itemAriaLabel(
  item: ItemData,
  opts: { count?: number; price?: string; extra?: string } = {},
): string {
  const parts = [item.name]
  if (opts.count !== undefined && opts.count > 1) parts.push(`${opts.count}개`)
  parts.push(categoryOf(item))
  const effect = describeItem(item)
  if (effect) parts.push(effect)
  if (opts.price) parts.push(opts.price)
  if (opts.extra) parts.push(opts.extra)
  return parts.join(', ')
}

/*
  직업 제한 문장을 여기서도 만들 수 있게 해 두었지만 부르는 곳이 없다 —
  "왜 못 입는가"는 코어의 canEquip이 이유와 함께 돌려주고, 화면은 그 문장을
  그대로 쓴다. 규칙을 아는 쪽이 말하는 것이 옳으므로 이 자리는 비워 둔다.
*/
