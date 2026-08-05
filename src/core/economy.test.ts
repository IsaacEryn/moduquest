import { describe, expect, it } from 'vitest'
import type { GameData } from './types'
import economyData from '../data/economy.json'
import items from '../data/items.json'

const ITEMS = items as GameData['items']
const ECONOMY = economyData as GameData['economy']

/**
 * 값에도 확률이 없다. 그래서 값은 전부 이 파일 하나에서 나오고,
 * 도움말은 여기 적힌 수를 그대로 옮겨 적는다 — 두 곳이 어긋나면 규칙이 거짓말이 된다.
 */
describe('마을 경제 데이터', () => {
  it('상점 물건은 전부 실재하고, 사는 값이 파는 값보다 비싸다', () => {
    for (const [id, price] of Object.entries(ECONOMY.shop.stock)) {
      const item = ITEMS[id]
      expect(item, `상점의 ${id}`).toBeDefined()
      expect(price, `${id}의 값`).toBeGreaterThan(0)
      const sell =
        item.kind === 'consumable'
          ? ECONOMY.sell.consumable
          : ECONOMY.sell.byTier[String(item.tier)]
      // 사서 되파는 것만으로 돈이 불어나면 경제가 아니라 버그다
      expect(price, `${id}: 사는 값이 파는 값 이하다`).toBeGreaterThan(sell)
    }
  })

  it('상점에는 소모품과 1등급 장비만 둔다 — 좋은 장비는 싸워서 얻는다', () => {
    for (const id of Object.keys(ECONOMY.shop.stock)) {
      const item = ITEMS[id]
      if (item.kind === 'consumable') continue
      expect(item.kind, `${id}의 종류`).toBe('equipment')
      expect(item.tier, `${id}의 등급`).toBe(1)
    }
  })

  it('모든 장비 등급에 파는 값과 분해 산출이 있다', () => {
    const tiers = new Set(
      Object.values(ITEMS)
        .filter((i) => i.kind === 'equipment' && i.tier)
        .map((i) => String(i.tier)),
    )
    for (const tier of tiers) {
      expect(ECONOMY.sell.byTier[tier], `${tier}등급 판매가`).toBeGreaterThan(0)
      expect(ECONOMY.dismantle.byTier[tier], `${tier}등급 분해 산출`).toBeGreaterThan(0)
    }
  })

  it('손에서 놓을 수 없는 물건은 다시 구할 길이 없는 것들이다', () => {
    // 팔기·분해 거절은 별도 목록이 아니라 아이템 자체에서 읽는다.
    // 그 전제(오라 장비에는 allyStats가 있다)를 여기서 못 박는다
    const locked = ['story_banner', 'guide_lantern']
    for (const id of locked) {
      expect(ITEMS[id]?.allyStats, `${id}의 오라`).toBeDefined()
    }
    expect(ITEMS['bell_shard'].kind).toBe('keepsake')
  })

  it('강화 비용표는 단계 수와 길이가 같고 오를수록 비싸진다', () => {
    const { costs, maxLevel, stats, gainPerLevel } = ECONOMY.upgrade
    expect(costs.length).toBe(maxLevel)
    for (let i = 1; i < costs.length; i++) {
      expect(costs[i].gold, `${i + 1}단계 값`).toBeGreaterThan(costs[i - 1].gold)
      expect(costs[i].materials, `${i + 1}단계 재료`).toBeGreaterThan(costs[i - 1].materials)
    }
    for (const stat of stats) {
      expect(gainPerLevel[stat], `${stat}의 단계당 증가`).toBeGreaterThan(0)
    }
    // 마력은 강화하지 않는다 — 특성이 마력을 건드리지 않는 것과 같은 결이다
    expect(stats).not.toContain('mp')
  })
})
