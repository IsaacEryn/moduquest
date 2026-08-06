import { attrWord, josa, ordinalWord } from '../core/korean'
import { levelForXp } from '../core/stats'
import type { GameData } from '../core/types'
import { GIFT_DAILY_LIMIT } from '../net/giftPolicy'

/**
 * 도움말이 말하는 수치를 데이터에서 조립한다.
 *
 * 손으로 적었을 때 실제로 어긋났다 — "정련은 3레벨부터"라고 안내하면서 입으려 하면
 * "4레벨부터"라고 거절했고, "1등급 장비 넷을 판다"는데 진열대에는 열 가지가 있었다.
 * 규칙을 밝힌다는 이 게임의 약속은 그 순간 거짓이 된다.
 *
 * DOM을 모르는 순수 함수로 둔 것은 시험이 이 문장들을 데이터와 맞대 볼 수 있게
 * 하기 위해서다. 화면은 여기서 나온 값을 textContent로 옮겨 적기만 한다.
 */

const TIER_KO: Record<number, string> = { 1: '일반', 2: '정련', 3: '울림' }
const STAT_KO: Record<string, string> = { hp: '체력', atk: '공격', def: '방어', spd: '속도' }

/** 등급별 최소 레벨 — 실제 장비 데이터가 정한다 */
export function minLevelOfTier(data: GameData, tier: number): number | null {
  const levels = Object.values(data.items)
    .filter((i) => i.kind === 'equipment' && i.tier === tier)
    .map((i) => i.minLevel ?? 1)
  return levels.length > 0 ? Math.min(...levels) : null
}

function tierList(byTier: Record<string, number>, unit: string): string {
  return Object.entries(byTier)
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([tier, v]) => `${TIER_KO[Number(tier)] ?? `${tier}등급`} ${v}${unit}`)
    .join('·')
}

export function helpFacts(data: GameData): Record<string, string> {
  const { items, economy, progression, monsters, jobs } = data
  const facts: Record<string, string> = {}

  // 레벨 제한이 붙은 등급만 말한다 — 1레벨부터 입는 등급은 말할 것이 없다
  const gated = [2, 3]
    .map((t) => ({ tier: t, level: minLevelOfTier(data, t) }))
    .filter((x): x is { tier: number; level: number } => x.level !== null && x.level > 1)
  // "정련은 4레벨, 울림은 6레벨부터" — 부터는 마지막에 한 번만 붙인다
  facts['tier-levels'] = `${gated
    .map((x) => `${josa(TIER_KO[x.tier], '은', '는')} ${x.level}레벨`)
    .join(', ')}부터`

  // 상점 진열대 — 무엇을 몇 가지 파는지 데이터가 답한다
  const stockIds = Object.keys(economy.shop.stock).filter((id) => items[id])
  const potions = stockIds.filter((id) => items[id].kind === 'consumable').length
  const gearByTier = new Map<number, number>()
  for (const id of stockIds) {
    const item = items[id]
    if (item.kind !== 'equipment' || !item.tier) continue
    gearByTier.set(item.tier, (gearByTier.get(item.tier) ?? 0) + 1)
  }
  const gear = [...gearByTier.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tier, n]) => `${tier}등급 장비 ${attrWord(n)} 가지`)
    .join(', ')
  facts['shop-stock'] = `물약 ${attrWord(potions)} 가지와 ${gear}를 판다`

  // 소모품은 상점 값에서 끌어오므로 도움말도 규칙을 말한다 — 물약이 늘어도 문장이 안 낡는다
  const sellPercent = Math.round(economy.sell.rate * 100)
  facts['sell-values'] =
    `소모품은 산 값의 ${sellPercent}퍼센트, 장비는 등급에 따라 ${tierList(economy.sell.byTier, '냥')}`
  facts['dismantle-yield'] = tierList(economy.dismantle.byTier, '개')

  const up = economy.upgrade
  const costs = up.costs.map((c, i) => `${i + 1}단계 ${c.gold}냥과 재료 ${c.materials}개`).join(', ')
  facts['upgrade-costs'] = `${costs}. 한 능력치당 ${up.maxLevel}단계까지다.`

  // 같은 증가량끼리 묶어 읽는다 — "체력은 5, 공격·방어·속도는 1씩"
  const byGain = new Map<number, string[]>()
  for (const stat of up.stats) {
    const gain = up.gainPerLevel[stat] ?? 0
    byGain.set(gain, [...(byGain.get(gain) ?? []), STAT_KO[stat] ?? stat])
  }
  facts['upgrade-gain'] = `${[...byGain.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([gain, names]) => `${josa(names.join('·'), '은', '는')} ${gain}`)
    .join(', ')}씩 단계마다 오른다.`

  const maxLevel = levelForXp(progression.xpTable, Number.MAX_SAFE_INTEGER)
  const secondSkill = Math.min(
    ...Object.values(jobs)
      .map((j) => j.skills[1]?.unlockLevel ?? Infinity)
      .filter((n) => Number.isFinite(n)),
  )
  facts['level-caps'] =
    `최고 ${maxLevel}레벨까지 간다. ${secondSkill}레벨이 되면 직업마다 두 번째 기술이 열리고, ` +
    `${gated.map((x) => x.level).join('·')}레벨에 더 좋은 장비를 입을 수 있다.`

  // 순환 드랍의 실례 하나 — 규칙을 말로만 적으면 감이 오지 않는다
  const example = Object.values(monsters)
    .filter((m) => !m.isBoss && (m.drops?.length ?? 0) > 0)
    .map((m) => {
      const at = (m.drops ?? []).findIndex((d) => d)
      return { name: m.name, at, item: items[(m.drops ?? [])[at] ?? '']?.name }
    })
    .find((x) => x.at >= 0 && x.item)
  if (example) {
    facts['drop-cycle'] =
      `${josa(example.name, '은', '는')} ${ordinalWord(example.at + 1)} 번째마다 ${example.item}`
  }

  facts['gift-limit'] = `하루 ${attrWord(GIFT_DAILY_LIMIT)} 개까지`
  return facts
}
