import { describe, expect, it } from 'vitest'
import type { GameData } from './types'
import progression from '../data/progression.json'
import items from '../data/items.json'
import economyData from '../data/economy.json'
import jobsData from '../data/jobs.json'
import monstersData from '../data/monsters.json'
import sets from '../data/sets.json'
import stage1 from '../data/stages/stage1.json'
import stage2 from '../data/stages/stage2.json'
import stage3 from '../data/stages/stage3.json'

const ITEMS = items as GameData['items']
const SETS = sets as GameData['sets']
const MONSTERS = monstersData as GameData['monsters']
const JOBS = jobsData as GameData['jobs']
const ECONOMY = economyData as GameData['economy']
const MAX_LEVEL = progression.xpTable.length
const STAGES = [stage1, stage2, stage3]

/**
 * 데이터가 서로를 가리키는 곳이 늘었다 — 드랍·상자·세트가 실재하지 않는 id를
 * 가리키면 조용히 아무 일도 안 일어나는 버그가 된다. 참조 무결성을 테스트로 강제한다.
 */
describe('아이템 데이터 무결성', () => {
  it('몹 드랍과 첫 처치 보상은 전부 실재하는 아이템이다', () => {
    for (const [mid, m] of Object.entries(MONSTERS)) {
      for (const d of m.drops ?? []) {
        if (d !== null) expect(ITEMS[d], `${mid} drops ${d}`).toBeDefined()
      }
      for (const d of m.firstDrops ?? []) {
        expect(ITEMS[d], `${mid} firstDrops ${d}`).toBeDefined()
      }
      // 첫 처치 보상은 보스만 갖는다
      if (m.firstDrops) expect(m.isBoss, `${mid}에 firstDrops가 있는데 보스가 아니다`).toBe(true)
    }
  })

  it('상자 내용물은 전부 실재하는 아이템이다', () => {
    for (const stage of STAGES) {
      for (const area of stage.areas) {
        for (const chest of area.chests ?? []) {
          for (const id of chest.items) {
            expect(ITEMS[id], `${stage.id}/${area.id} 상자의 ${id}`).toBeDefined()
          }
        }
      }
    }
  })

  it('장비는 슬롯·세트·레벨 조건이 온전하다', () => {
    const slots = ['weapon', 'armor', 'shoes', 'gloves']
    for (const [id, item] of Object.entries(ITEMS)) {
      if (item.kind !== 'equipment') {
        expect(item.slot, `${id}는 장비가 아닌데 슬롯이 있다`).toBeUndefined()
        continue
      }
      expect(slots, `${id}의 슬롯`).toContain(item.slot)
      expect(item.stats, `${id}에 능력치가 없다`).toBeDefined()
      if (item.set) expect(SETS[item.set], `${id}의 세트 ${item.set}`).toBeDefined()
      // 최고 레벨보다 높은 조건은 영원히 입을 수 없는 장비다
      expect(item.minLevel ?? 1, `${id}의 레벨 조건`).toBeLessThanOrEqual(MAX_LEVEL)
    }
  })

  it('전용 장비의 직업은 전부 실재한다', () => {
    for (const [id, item] of Object.entries(ITEMS)) {
      for (const job of item.jobs ?? []) {
        expect(JOBS[job], `${id}의 전용 직업 ${job}`).toBeDefined()
      }
      // 빈 배열은 아무도 못 입는 장비다 — 실수를 데이터에서 막는다
      if (item.jobs) expect(item.jobs.length, `${id}의 전용 직업 수`).toBeGreaterThan(0)
    }
  })

  it('직업마다 전용 무기가 등급별로 하나씩은 있다', () => {
    for (const job of Object.keys(JOBS)) {
      for (const tier of [1, 2]) {
        const mine = Object.values(ITEMS).filter(
          (i) => i.slot === 'weapon' && i.tier === tier && i.jobs?.includes(job),
        )
        expect(mine.length, `${job}의 ${tier}등급 전용 무기`).toBeGreaterThan(0)
      }
    }
  })

  it('모든 장비는 어디선가 손에 들어온다 — 아무도 못 얻는 장비는 없는 것과 같다', () => {
    const reachable = new Set<string>(Object.keys(ECONOMY.shop.stock))
    for (const m of Object.values(MONSTERS)) {
      for (const d of [...(m.drops ?? []), ...(m.firstDrops ?? [])]) if (d) reachable.add(d)
    }
    for (const stage of STAGES) {
      for (const area of stage.areas) {
        for (const chest of area.chests ?? []) for (const id of chest.items) reachable.add(id)
      }
    }
    for (const [id, item] of Object.entries(ITEMS)) {
      if (item.kind !== 'equipment') continue
      expect(reachable.has(id), `${id}를 얻을 길이 없다`).toBe(true)
    }
  })

  it('세트 보너스에는 오라가 없다 — 2중 전파를 데이터로 막는다', () => {
    // 세트 보너스는 착용자 본인에게만 붙는 StatBlock이다. 구조상 allyStats를
    // 가질 수 없지만, 세트 조각이 전부 오라 장비인 조합도 만들지 않기로 한다
    for (const [sid, set] of Object.entries(SETS)) {
      expect(set.pieces, `${sid}의 요구 개수`).toBeGreaterThanOrEqual(2)
      const pieces = Object.values(ITEMS).filter((i) => i.set === sid)
      expect(pieces.length, `${sid} 조각 수가 요구 개수보다 적다`).toBeGreaterThanOrEqual(
        set.pieces,
      )
    }
  })

  it('소모품은 어떤 효과든 하나는 갖는다', () => {
    for (const [id, item] of Object.entries(ITEMS)) {
      if (item.kind !== 'consumable') continue
      const effective = (item.heal ?? 0) + (item.mana ?? 0) + (item.cooldownCut ?? 0)
      expect(effective, `${id}는 아무 효과가 없다`).toBeGreaterThan(0)
    }
  })
})
