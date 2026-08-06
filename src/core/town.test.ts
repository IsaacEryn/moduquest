import { describe, expect, it } from 'vitest'
import { EventBus, type GameEvent } from './events'
import { Game } from './game'
import type { GameData, StageData, TraitsFile } from './types'
import economy from '../data/economy.json'
import items from '../data/items.json'
import sets from '../data/sets.json'
import jobs from '../data/jobs.json'
import monsters from '../data/monsters.json'
import party from '../data/party.json'
import progression from '../data/progression.json'
import stage1 from '../data/stages/stage1.json'
import stage2 from '../data/stages/stage2.json'
import stage3 from '../data/stages/stage3.json'
import traitsFile from '../data/traits.json'

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
const ECONOMY = DATA.economy

function makeGame() {
  const bus = new EventBus()
  const events: GameEvent[] = []
  bus.on((e) => events.push(e))
  const game = new Game(DATA, bus, { schedule: () => null, cancel: () => {} }, null, () => 1000)
  return { game, events }
}

function skipDialogue(game: Game) {
  let guard = 0
  while (game.mode === 'dialogue' && guard++ < 50) game.advanceDialogue()
}

/** 쉼터에 서 있는 상태로 만든다 — 마을에 들를 수 있는 유일한 자리다 */
function atCheckpoint(game: Game) {
  game.start()
  skipDialogue(game)
  const cp = game.field.currentArea.checkpoint
  if (!cp) throw new Error('스테이지1에 쉼터가 없다')
  game.field.pos = { ...cp }
  return game
}

/** 지갑을 채운다. 테스트가 전투를 반복하지 않아도 되도록 상점을 통해 넣는다 */
function fund(game: Game, gold: number, materials: number) {
  // 동전은 처치로만 들어오므로 판매로 채운다 — 상점에 산 것을 되파는 경로
  const seed = game as unknown as { gold: number; materials: number }
  seed.gold = gold
  seed.materials = materials
}

describe('마을에 들르는 자리', () => {
  it('쉼터에서만 들를 수 있다', () => {
    const { game } = makeGame()
    game.start()
    skipDialogue(game)
    expect(game.canVisitTown().ok).toBe(false)
    expect(game.canVisitTown().reason).toContain('쉼터')

    const cp = game.field.currentArea.checkpoint!
    game.field.pos = { ...cp }
    expect(game.canVisitTown().ok).toBe(true)
  })

  it('쉼터 밖에서는 사고팔 수 없다', () => {
    const { game } = makeGame()
    game.start()
    skipDialogue(game)
    fund(game, 999, 99)
    expect(game.canBuy('potion_small').ok).toBe(false)
    expect(game.buy('potion_small')).toBe(false)
    expect(game.currentGold).toBe(999)
  })
})

describe('사고팔기', () => {
  it('사면 동전이 줄고 가방이 는다', () => {
    const { game, events } = makeGame()
    atCheckpoint(game)
    fund(game, 100, 0)
    const price = ECONOMY.shop.stock['potion_small']

    expect(game.buy('potion_small')).toBe(true)
    expect(game.currentGold).toBe(100 - price)
    expect(game.inventoryList.find((i) => i.id === 'potion_small')?.count).toBe(1)
    const bought = events.find((e) => e.type === 'bought')
    expect(bought).toMatchObject({ price, gold: 100 - price })
  })

  it('동전이 모자라면 이유를 말하고 거절한다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 3, 0)
    const r = game.canBuy('potion_small')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('모자라')
    expect(game.buy('potion_small')).toBe(false)
  })

  it('상점에 없는 것은 살 수 없다 — 좋은 장비는 싸워서 얻는다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 9999, 0)
    expect(game.canBuy('steel_sword').ok).toBe(false)
    expect(game.buy('steel_sword')).toBe(false)
  })

  it('되팔면 동전이 늘고 가방에서 사라진다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 100, 0)
    game.buy('wood_sword')
    const before = game.currentGold

    expect(game.sell('wood_sword')).toBe(true)
    expect(game.currentGold).toBe(before + ECONOMY.sell.byTier['1'])
    expect(game.inventoryList.find((i) => i.id === 'wood_sword')).toBeUndefined()
  })

  it('입고 있는 장비는 팔리지 않는다 — 가방에 없기 때문이다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 100, 0)
    game.buy('wood_sword')
    game.equip(game.player.id, 'wood_sword')
    expect(game.canSell('wood_sword').ok).toBe(false)
    expect(game.canSell('wood_sword').reason).toContain('가방에 없다')
  })
})

describe('분해', () => {
  it('장비를 분해하면 강화 재료가 된다', () => {
    const { game, events } = makeGame()
    atCheckpoint(game)
    fund(game, 100, 0)
    game.buy('leather_armor')

    expect(game.dismantle('leather_armor')).toBe(true)
    expect(game.currentMaterials).toBe(ECONOMY.dismantle.byTier['1'])
    expect(game.inventoryList.find((i) => i.id === 'leather_armor')).toBeUndefined()
    expect(events.find((e) => e.type === 'dismantled')).toMatchObject({
      gained: ECONOMY.dismantle.byTier['1'],
    })
  })

  it('물약은 분해할 수 없다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 100, 0)
    game.buy('potion_small')
    const r = game.canDismantle('potion_small')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('장비만')
  })

  it('비싸게 산 물약은 비싸게 팔린다 — 예전에는 전부 같은 값이었다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    const small = game.sellValueOf('potion_small')
    const big = game.sellValueOf('potion_big')
    expect(small).toBe(4)
    expect(big).toBe(8)
    expect(big).toBeGreaterThan(small as number)
  })

  it('되파는 값은 언제나 사는 값보다 싸다 — 되팔아 이문이 남으면 안 된다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    for (const row of game.shopStock) {
      const sell = game.sellValueOf(row.id)
      if (sell === null) continue
      expect(sell, `${row.id}는 ${row.price}냥에 사서 ${sell}냥에 팔린다`).toBeLessThan(row.price)
    }
  })

  it('추억의 물건과 오라 장비는 팔지도 분해하지도 못한다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    const bag = game as unknown as { inventory: Map<string, number> }
    bag.inventory.set('bell_shard', 1)
    bag.inventory.set('story_banner', 1)

    for (const id of ['bell_shard', 'story_banner']) {
      expect(game.sellValueOf(id), `${id}의 판매가`).toBeNull()
      expect(game.dismantleYieldOf(id), `${id}의 분해 산출`).toBeNull()
      expect(game.canSell(id).reason).toContain('놓을 수 없다')
      expect(game.sell(id)).toBe(false)
      expect(game.dismantle(id)).toBe(false)
    }
  })
})

describe('전용 장비', () => {
  it('궁수의 활은 다른 직업이 들 수 없고, 이유에 주인을 밝힌다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 100, 0)
    game.buy('wood_bow')

    // 기본 파티는 도적·전사·힐러 — 궁수가 없으니 전원 거절
    for (const job of game.currentPartyJobs) {
      const r = game.canEquip(job, 'wood_bow')
      expect(r.ok, job).toBe(false)
      expect(r.reason).toContain('궁수 전용')
      expect(game.equip(job, 'wood_bow')).toBe(false)
    }
  })

  it('두 직업의 것은 그 둘만 입는다 — 힐러는 로브를 입고 전사는 못 입는다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 100, 0)
    game.buy('leather_robe')

    expect(game.canEquip('warrior', 'leather_robe').reason).toContain('마법사·힐러 전용')
    expect(game.equip('healer', 'leather_robe')).toBe(true)
    // 로브는 몸을 막기보다 마력을 돕는다
    const b = game.statBreakdownOf('healer')!
    expect(b.equip.mp).toBe(8)
  })

  it('공용 장비는 여전히 모두의 것이다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 100, 0)
    game.buy('wood_sword')
    for (const job of game.currentPartyJobs) {
      expect(game.canEquip(job, 'wood_sword').ok, job).toBe(true)
    }
  })
})

describe('성장 강화', () => {
  it('올리면 값을 치르고 능력치가 실제로 오른다', () => {
    const { game, events } = makeGame()
    atCheckpoint(game)
    const cost = ECONOMY.upgrade.costs[0]
    fund(game, cost.gold, cost.materials)
    const id = game.player.id
    const before = game.statBreakdownOf(id)!.total.atk

    expect(game.upgrade(id, 'atk')).toBe(true)
    expect(game.currentGold).toBe(0)
    expect(game.currentMaterials).toBe(0)
    const after = game.statBreakdownOf(id)!
    expect(after.total.atk).toBe(before + ECONOMY.upgrade.gainPerLevel.atk)
    // 내역에 출처가 따로 남아야 상태창이 "강화 +n"이라고 말할 수 있다
    expect(after.upgrade.atk).toBe(ECONOMY.upgrade.gainPerLevel.atk)
    expect(events.find((e) => e.type === 'upgraded')).toMatchObject({ level: 1, statName: '공격' })
  })

  it('강화는 회복이 아니다 — 체력은 비율을 유지한다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 9999, 999)
    const id = game.player.id
    game.player.hp = Math.floor(game.player.maxHp / 2)
    const ratio = game.player.hp / game.player.maxHp

    game.upgrade(id, 'hp')
    expect(game.player.hp).toBeLessThan(game.player.maxHp)
    expect(Math.abs(game.player.hp / game.player.maxHp - ratio)).toBeLessThan(0.02)
  })

  it('상한까지 올리면 더는 올릴 수 없다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 99999, 9999)
    const id = game.player.id
    for (let i = 0; i < ECONOMY.upgrade.maxLevel; i++) {
      expect(game.upgrade(id, 'def'), `${i + 1}단계`).toBe(true)
    }
    expect(game.upgradeLevelOf(id, 'def')).toBe(ECONOMY.upgrade.maxLevel)
    expect(game.upgradeCostOf(id, 'def')).toBeNull()
    const r = game.canUpgrade(id, 'def')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('다 올렸다')
  })

  it('재료가 모자라면 이유를 말한다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 9999, 0)
    const r = game.canUpgrade(game.player.id, 'spd')
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('강화 재료')
  })

  it('동료도 따로 강화한다 — 강화는 사람마다 쌓인다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 9999, 999)
    const [me, mate] = game.currentPartyJobs
    game.upgrade(mate, 'atk')
    expect(game.upgradeLevelOf(mate, 'atk')).toBe(1)
    expect(game.upgradeLevelOf(me, 'atk')).toBe(0)
    expect(game.statBreakdownOf(me)!.upgrade.atk).toBe(0)
  })
})

describe('동전은 싸워서 번다', () => {
  it('이기면 경험치와 같은 수의 동전이 들어온다', () => {
    const bus = new EventBus()
    const events: GameEvent[] = []
    bus.on((e) => events.push(e))
    const pending = new Map<number, () => void>()
    let next = 1
    const game = new Game(
      DATA,
      bus,
      {
        schedule: (fn) => {
          const id = next++
          pending.set(id, fn)
          return id
        },
        cancel: (h) => void pending.delete(h as number),
      },
      null,
      () => 1000,
    )
    game.start()
    skipDialogue(game)

    // 첫 조우 옆으로 걸어 들어가 이길 때까지 때린다. 설 자리는 지도에서 찾는다
    const area = game.field.currentArea
    const target = area.encounters[0]
    const sides = [
      { d: 'south' as const, x: 0, y: -1 },
      { d: 'north' as const, x: 0, y: 1 },
      { d: 'west' as const, x: 1, y: 0 },
      { d: 'east' as const, x: -1, y: 0 },
    ]
    const side = sides.find(
      (s) => area.tiles[target.pos.y + s.y]?.[target.pos.x + s.x] === 0,
    )!
    game.field.pos = { x: target.pos.x + side.x, y: target.pos.y + side.y }
    game.moveField(side.d)
    skipDialogue(game)
    for (const e of game.battle!.enemies) e.hp = 1
    let guard = 0
    while (game.mode === 'battle' && guard++ < 60) {
      if (game.battle!.currentActor.isPlayer) {
        const enemy = game.battle!.enemies.find((e) => e.hp > 0)
        if (!enemy) break
        game.playerAction({ kind: 'attack', targetId: enemy.id })
      }
      for (const [id, fn] of [...pending]) {
        pending.delete(id)
        fn()
      }
    }

    const xp = events.find((e) => e.type === 'xpGained')
    const gold = events.find((e) => e.type === 'goldGained')
    expect(xp).toBeDefined()
    expect(gold?.type === 'goldGained' && gold.amount).toBe(
      xp?.type === 'xpGained' && xp.amount ? xp.amount * ECONOMY.goldPerXp : 0,
    )
    expect(game.currentGold).toBeGreaterThan(0)
  })

  it('저장했다 되돌리면 지갑과 강화가 그대로다', () => {
    const { game } = makeGame()
    atCheckpoint(game)
    fund(game, 200, 10)
    game.upgrade(game.player.id, 'atk')
    const snapshot = game.snapshot()

    const { game: other } = makeGame()
    other.restore(snapshot)
    expect(other.currentGold).toBe(game.currentGold)
    expect(other.currentMaterials).toBe(game.currentMaterials)
    expect(other.upgradeLevelOf(other.player.id, 'atk')).toBe(1)
    expect(other.statBreakdownOf(other.player.id)!.upgrade.atk).toBe(
      ECONOMY.upgrade.gainPerLevel.atk,
    )
  })
})
