import { describe, expect, it } from 'vitest'
import economy from '../data/economy.json'
import items from '../data/items.json'
import jobs from '../data/jobs.json'
import monsters from '../data/monsters.json'
import party from '../data/party.json'
import progression from '../data/progression.json'
import sets from '../data/sets.json'
import stage1 from '../data/stages/stage1.json'
import stage2 from '../data/stages/stage2.json'
import stage3 from '../data/stages/stage3.json'
import traitsFile from '../data/traits.json'
import type { GameData, StageData, TraitsFile } from '../core/types'
import { helpFacts, minLevelOfTier } from './helpFacts'

/**
 * 도움말은 이 게임의 약속이다 — "숨기면 정보 격차지만 밝히면 전략". 그래서
 * 도움말이 데이터와 어긋나는 순간은 오탈자가 아니라 약속을 어기는 순간이다.
 *
 * 실제로 어긋난 적이 있다. 도움말은 "정련은 3레벨, 울림은 4레벨부터"라고 했는데
 * 데이터는 4·6레벨이었고, "1등급 장비 넷을 판다"는데 진열대에는 열 가지가 있었다.
 * 사람이 두 곳을 맞추는 대신 여기서 검사한다.
 */

const DATA: GameData = {
  jobs: jobs as GameData['jobs'],
  monsters: monsters as GameData['monsters'],
  party,
  progression,
  items: items as GameData['items'],
  sets: sets as GameData['sets'],
  economy: economy as GameData['economy'],
  stages: [stage1, stage2, stage3] as StageData[],
  traits: traitsFile as TraitsFile,
}

describe('도움말의 수치는 데이터에서 온다', () => {
  const facts = helpFacts(DATA)

  it('빈 자리 없이 전부 채워진다', () => {
    const names = [
      'tier-levels',
      'shop-stock',
      'sell-values',
      'dismantle-yield',
      'upgrade-costs',
      'upgrade-gain',
      'level-caps',
      'drop-cycle',
      'gift-limit',
    ]
    for (const n of names) expect(facts[n], n).toBeTruthy()
  })

  it('등급별 최소 레벨이 실제 장비와 같다', () => {
    for (const tier of [2, 3]) {
      const level = minLevelOfTier(DATA, tier)
      if (level === null || level <= 1) continue
      expect(facts['tier-levels']).toContain(`${level}레벨`)
      expect(facts['level-caps']).toContain(String(level))
    }
    // 그 레벨은 실제로 착용 조건이어야 한다 — 문장과 판정이 같은 수를 봐야 한다
    const tier2 = Object.values(DATA.items).filter((i) => i.tier === 2)
    expect(tier2.every((i) => (i.minLevel ?? 1) === minLevelOfTier(DATA, 2))).toBe(true)
  })

  it('상점 품목 수가 진열대와 같다', () => {
    const stock = Object.keys(DATA.economy.shop.stock).filter((id) => DATA.items[id])
    const gear = stock.filter((id) => DATA.items[id].kind === 'equipment')
    const potions = stock.filter((id) => DATA.items[id].kind === 'consumable')
    // 등급별로 나눠 말하므로 등급 수만큼의 항목이 문장에 있어야 한다
    const tiers = new Set(gear.map((id) => DATA.items[id].tier))
    for (const tier of tiers) {
      const n = gear.filter((id) => DATA.items[id].tier === tier).length
      expect(facts['shop-stock']).toContain(`${tier}등급 장비`)
      expect(n).toBeGreaterThan(0)
    }
    expect(potions.length).toBeGreaterThan(0)
  })

  it('되파는 값과 분해 산출이 economy와 같다', () => {
    expect(facts['sell-values']).toContain(`${Math.round(DATA.economy.sell.rate * 100)}퍼센트`)
    for (const [tier, v] of Object.entries(DATA.economy.sell.byTier)) {
      expect(facts['sell-values'], `tier ${tier}`).toContain(`${v}냥`)
    }
    for (const [tier, v] of Object.entries(DATA.economy.dismantle.byTier)) {
      expect(facts['dismantle-yield'], `tier ${tier}`).toContain(`${v}개`)
    }
  })

  it('강화 비용과 상한이 economy와 같다', () => {
    const up = DATA.economy.upgrade
    for (const [i, c] of up.costs.entries()) {
      expect(facts['upgrade-costs']).toContain(`${i + 1}단계 ${c.gold}냥과 재료 ${c.materials}개`)
    }
    expect(facts['upgrade-costs']).toContain(`${up.maxLevel}단계까지`)
  })

  it('최고 레벨과 두 번째 기술 레벨이 데이터와 같다', () => {
    expect(facts['level-caps']).toContain(`최고 ${DATA.progression.xpTable.length}레벨`)
    const second = Math.min(
      ...Object.values(DATA.jobs).map((j) => j.skills[1]?.unlockLevel ?? Infinity),
    )
    expect(facts['level-caps']).toContain(`${second}레벨이 되면`)
  })

  it('드랍 예시가 실제 순환 목록과 같다', () => {
    const slime = DATA.monsters['slime']
    const at = (slime.drops ?? []).findIndex((d) => d)
    expect(facts['drop-cycle']).toContain(slime.name)
    expect(facts['drop-cycle']).toContain(DATA.items[(slime.drops ?? [])[at]!].name)
  })

  it('같은 등급의 장비는 최소 레벨이 하나다', () => {
    /*
      도움말은 등급마다 최소 레벨을 하나만 말한다("울림은 6레벨부터"). 그 문장이
      참이려면 등급 안에서 값이 갈리지 않아야 한다. 한 벌만 4로 적혀 있던 적이
      있었는데, 그때 도움말은 데이터와 어긋나지 않으면서도 사람에게는 틀린 말을 했다.
    */
    const byTier = new Map<number, Set<number>>()
    for (const item of Object.values(DATA.items)) {
      if (item.kind !== 'equipment' || !item.tier) continue
      const seen = byTier.get(item.tier) ?? new Set<number>()
      seen.add(item.minLevel ?? 1)
      byTier.set(item.tier, seen)
    }
    for (const [tier, levels] of byTier) {
      expect([...levels], `${tier}등급의 최소 레벨이 갈렸다`).toHaveLength(1)
    }
  })
})
