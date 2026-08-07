import { describe, expect, it } from 'vitest'
import { EventBus, type GameEvent } from './events'
import { Game, type TurnScheduler } from './game'
import { resolveArea } from './layout'
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

/** 예약된 콜백을 직접 들여다볼 수 있는 스케줄러 — 유령 타이머를 잡는 도구 */
function fakeScheduler() {
  const pending = new Map<number, () => void>()
  let next = 1
  const scheduler: TurnScheduler = {
    schedule(fn) {
      const id = next++
      pending.set(id, fn)
      return id
    },
    cancel(handle) {
      pending.delete(handle as number)
    },
  }
  return {
    scheduler,
    get count() {
      return pending.size
    },
    /** 예약된 것을 전부 실행한다 */
    flush() {
      for (const [id, fn] of [...pending]) {
        pending.delete(id)
        fn()
      }
    },
  }
}

function makeGame() {
  const data: GameData = {
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
  const bus = new EventBus()
  const events: GameEvent[] = []
  bus.on((e) => events.push(e))
  const timer = fakeScheduler()
  const game = new Game(data, bus, timer.scheduler)
  return { game, bus, events, timer }
}

/**
 * 조우 옆으로 걸어가 전투를 연다. 좌표를 손으로 적으면 지도를 다시 그릴 때마다
 * 벽 위로 순간이동한다 — 자리는 데이터에서 찾는다
 */
function stepInto(game: Game, encounterId: string): void {
  const area = game.field.currentArea
  // 보스는 encounters가 아니라 area.boss에 따로 있다
  const target =
    area.encounters.find((e) => e.id.endsWith(encounterId)) ??
    (area.boss?.id.endsWith(encounterId) ? area.boss : undefined)!
  const dirs = [
    { d: 'south' as const, x: 0, y: -1 },
    { d: 'north' as const, x: 0, y: 1 },
    { d: 'west' as const, x: 1, y: 0 },
    { d: 'east' as const, x: -1, y: 0 },
  ]
  for (const { d, x, y } of dirs) {
    const from = { x: target.pos.x + x, y: target.pos.y + y }
    if (area.tiles[from.y]?.[from.x] !== 0) continue
    game.field.pos = from
    game.moveField(d)
    return
  }
  throw new Error(`${encounterId} 옆에 설 자리가 없다`)
}

/** 대사를 끝까지 넘겨 필드로 보낸다 */
function skipDialogue(game: Game) {
  let guard = 0
  while (game.mode === 'dialogue' && guard++ < 50) game.advanceDialogue()
}

describe('스테이지 진행', () => {
  it('시작하면 첫 스테이지다', () => {
    const { game, events } = makeGame()
    game.start()
    expect(game.currentStageIndex).toBe(0)
    expect(game.stage.id).toBe('stage1')
    expect(game.stageCount).toBe(3)
    expect(events.some((e) => e.type === 'stageStart' && e.index === 0)).toBe(true)
  })

  it('스테이지를 옮기면 필드와 파티가 새로 만들어진다', () => {
    const { game } = makeGame()
    game.start()
    skipDialogue(game)
    game.player.hp = 1
    const beforeField = game.field

    game.startStage(1)
    expect(game.stage.id).toBe('stage2')
    expect(game.field).not.toBe(beforeField)
    expect(game.field.pos).toEqual(resolveArea(game.stage, 'a', 0).entryAt(null))
    expect(game.player.hp).toBe(game.player.maxHp) // 완전 회복
  })

  it('마지막 스테이지에는 다음이 없다', () => {
    const { game } = makeGame()
    game.startStage(2)
    expect(game.hasNextStage).toBe(false)
    game.nextStage()
    expect(game.currentStageIndex).toBe(2) // 그대로
  })

  it('범위 밖 스테이지는 무시한다', () => {
    const { game } = makeGame()
    game.start()
    game.startStage(99)
    expect(game.currentStageIndex).toBe(0)
    game.startStage(-1)
    expect(game.currentStageIndex).toBe(0)
  })

  it('스테이지를 옮기면 조우 대사를 다시 볼 수 있다', () => {
    // seenDialogues를 비우지 않으면 스테이지2의 firstBattle이 스테이지3에서 건너뛰인다
    const { game, events } = makeGame()
    game.start()
    skipDialogue(game)
    // 스테이지1의 첫 조우로 걸어가 대사를 소비한다
    game.moveField('east')
    game.moveField('east')
    game.moveField('east')
    game.moveField('north')
    expect(game.mode).toBe('dialogue')
    skipDialogue(game)

    events.length = 0
    game.startStage(1)
    skipDialogue(game)
    // 스테이지2의 첫 조우로 이동 — 같은 대사 키라도 다시 나와야 한다
    stepInto(game, 'e1')
    expect(game.mode).toBe('dialogue')
  })
})

describe('스테이지 전환 시 정리', () => {
  it('진행 중이던 턴 타이머가 남지 않는다', () => {
    const { game, timer } = makeGame()
    game.start()
    skipDialogue(game)
    // 첫 조우로 들어가 전투를 시작한다
    game.moveField('east')
    game.moveField('east')
    game.moveField('east')
    game.moveField('north')
    skipDialogue(game)
    expect(game.mode).toBe('battle')
    game.playerAction({ kind: 'defend' })
    expect(timer.count).toBeGreaterThan(0) // 다음 턴이 예약돼 있다

    game.startStage(1)
    expect(timer.count).toBe(0) // 유령 타이머가 남으면 새 스테이지에서 전투가 저절로 돈다
    expect(game.battle).toBeNull()

    timer.flush() // 남은 게 있었다면 여기서 터진다
    expect(game.mode).not.toBe('battle')
  })

  it('타이틀로 돌아가면 전투가 정리된다', () => {
    const { game, timer, events } = makeGame()
    game.start()
    skipDialogue(game)
    game.moveField('east')
    game.moveField('east')
    game.moveField('east')
    game.moveField('north')
    skipDialogue(game)
    game.playerAction({ kind: 'defend' })

    events.length = 0
    game.returnToTitle()
    expect(game.mode).toBe('title')
    expect(game.battle).toBeNull()
    expect(timer.count).toBe(0)
    expect(events.some((e) => e.type === 'battleEnd')).toBe(true)
  })
})

describe('스테이지 클리어', () => {
  it('보스를 이기면 다음이 있는지 함께 알린다', () => {
    const { game, events } = makeGame()
    game.startStage(0)
    skipDialogue(game)
    // 보스 옆으로 순간이동해 조우를 연다
    game.field.pos = { x: 10, y: 2 }
    game.moveField('north')
    skipDialogue(game)
    expect(game.mode).toBe('battle')
    // 보스를 즉사시킨다
    for (const e of game.battle!.enemies) e.hp = 1
    let guard = 0
    while (game.mode === 'battle' && guard++ < 50) {
      const target = game.battle!.enemies.find((e) => e.hp > 0)
      if (!target) break
      if (game.battle!.currentActor.isPlayer) {
        game.playerAction({ kind: 'attack', targetId: target.id })
      } else break
    }
    skipDialogue(game)

    const clear = events.find((e) => e.type === 'stageClear')
    expect(clear).toMatchObject({ index: 0, total: 3, hasNext: true })
  })
})

describe('경험치와 레벨', () => {
  it('이기면 처치한 몹들의 고정 경험치를 얻는다', () => {
    const { game, events, timer } = makeGame()
    game.start()
    skipDialogue(game)
    game.moveField('east')
    game.moveField('east')
    game.moveField('east')
    game.moveField('north') // e1: 슬라임 ×2 = 12
    skipDialogue(game)
    for (const e of game.battle!.enemies) e.hp = 1
    let guard = 0
    while (game.mode === 'battle' && guard++ < 60) {
      if (game.battle!.currentActor.isPlayer) {
        const target = game.battle!.enemies.find((e) => e.hp > 0)
        if (!target) break
        game.playerAction({ kind: 'attack', targetId: target.id })
      }
      timer.flush() // NPC·몹 턴 진행
    }
    const xpEvent = events.find((e) => e.type === 'xpGained')
    expect(xpEvent).toMatchObject({ amount: 12, total: 12 })
    expect(game.currentXp).toBe(12)
    expect(game.partyLevel).toBe(1)
  })

  it('레벨은 경험치에서 유도되고, 3레벨에 두 번째 스킬이 열린다', () => {
    const { game } = makeGame()
    const base = game.snapshot()
    expect(game.player.skills.length).toBe(1)

    game.restore({ ...base, xp: 40 }) // xpTable[2]=40 → 3레벨
    expect(game.partyLevel).toBe(3)
    expect(game.player.skills.length).toBe(2)
    expect(game.player.skills[1].name).toBe('급소 찌르기')
    // 성장이 능력치에 반영된다: 도적 물리 공격 20 + 2×2레벨
    expect(game.player.patk).toBe(20 + 2 * 2)
  })

  it('스테이지에 진입하면 그에 걸맞은 경험치가 보장된다', () => {
    const { game } = makeGame()
    game.startStage(2)
    expect(game.currentXp).toBeGreaterThanOrEqual(183)
    expect(game.partyLevel).toBeGreaterThanOrEqual(6)
  })
})

describe('아이템과 보물상자', () => {
  /** 전투를 끝까지 돌린다 — 플레이어는 공격만, NPC·몹 턴은 타이머로 진행 */
  function fightOut(game: Game, timer: { flush: () => void }) {
    let guard = 0
    while (game.mode === 'battle' && guard++ < 60) {
      if (game.battle!.currentActor.isPlayer) {
        const target = game.battle!.enemies.find((e) => e.hp > 0)
        if (!target) break
        game.playerAction({ kind: 'attack', targetId: target.id })
      }
      timer.flush()
    }
  }

  it('드랍은 처치 수 순환이다 — 슬라임 3번째마다 작은 물약', () => {
    const { game, events, timer } = makeGame()
    const base = game.snapshot()
    // 이미 두 번 잡았다면 이번 조우(슬라임 둘)에서 3번째만 물약이다
    game.restore({ ...base, kills: [{ monster: 'slime', count: 2 }] })
    game.field.pos = { x: 4, y: 7 }
    game.moveField('north') // e1: 슬라임 ×2
    skipDialogue(game)
    for (const e of game.battle!.enemies) e.hp = 1
    fightOut(game, timer)

    const gained = events.find((e) => e.type === 'itemGained')
    expect(gained).toMatchObject({ names: ['작은 물약'] })
    expect(game.inventoryList).toEqual([
      expect.objectContaining({ id: 'potion_small', count: 1, usableInField: true }),
    ])
  })

  it('보스는 첫 처치에 고정 보상을, 재처치엔 순환을 준다', () => {
    const fightBoss = (game: Game, timer: { flush: () => void }) => {
      game.field.pos = { x: 10, y: 2 }
      game.moveField('north')
      skipDialogue(game)
      for (const e of game.battle!.enemies) e.hp = 1
      fightOut(game, timer)
      skipDialogue(game)
    }

    // 첫 처치 — firstDrops(강철 검)
    const { game, events, timer } = makeGame()
    game.startStage(0)
    skipDialogue(game)
    fightBoss(game, timer)
    expect(events.find((e) => e.type === 'itemGained')).toMatchObject({ names: ['강철 검'] })

    // 재처치 — 순환의 첫 칸(강철 장갑). 고급 장비가 칸을 더 많이 차지하는 순환이다
    events.length = 0
    game.restartStage()
    skipDialogue(game)
    fightBoss(game, timer)
    expect(events.find((e) => e.type === 'itemGained')).toMatchObject({ names: ['강철 장갑'] })
  })

  it('보물상자는 밟으면 열리고 두 번 열리지 않는다', () => {
    const { game, events } = makeGame()
    game.start()
    skipDialogue(game)
    game.field.pos = { x: 3, y: 4 }
    game.moveField('west') // (2,4) 상자
    expect(events.find((e) => e.type === 'chestOpened')).toMatchObject({
      itemNames: ['작은 물약', '가죽 갑옷'],
    })
    expect(game.inventoryList[0]).toMatchObject({ id: 'potion_small', count: 1 })

    events.length = 0
    game.moveField('east')
    game.moveField('west') // 같은 칸을 다시 밟아도
    expect(events.some((e) => e.type === 'chestOpened')).toBe(false)
  })

  it('전투에서 도구를 쓰면 회복하고 턴을 소모한다', () => {
    const { game, events } = makeGame()
    const base = game.snapshot()
    game.restore({ ...base, bags: [[{ item: 'potion_small', count: 1 }], [], []] })
    game.field.pos = { x: 4, y: 7 }
    game.moveField('north')
    skipDialogue(game)
    const player = game.player
    player.hp = player.maxHp - 50

    game.playerAction({ kind: 'item', itemId: 'potion_small', targetId: player.id })
    expect(events.find((e) => e.type === 'itemUsed')).toMatchObject({
      name: '작은 물약',
      healed: 30,
    })
    expect(player.hp).toBe(player.maxHp - 20)
    expect(game.inventoryList.length).toBe(0) // 다 썼다
  })

  it('마력·스태미나 물약은 전투에서 각자의 효과를 낸다', () => {
    const { game, events } = makeGame()
    const base = game.snapshot()
    game.restore({
      ...base,
      bags: [[
        { item: 'mana_potion', count: 1 },
        { item: 'stamina_potion', count: 1 },
      ], [], []],
    })
    game.field.pos = { x: 4, y: 7 }
    game.moveField('north')
    skipDialogue(game)
    const player = game.player

    // 마력이 가득이면 마력 물약은 쓰이지 않는다 — 턴도 아이템도 그대로
    game.playerAction({ kind: 'item', itemId: 'mana_potion', targetId: player.id })
    expect(events.some((e) => e.type === 'itemUsed')).toBe(false)
    expect(game.inventoryList.find((i) => i.id === 'mana_potion')?.count).toBe(1)
    expect(game.battle!.currentActor.isPlayer).toBe(true)

    // 마력을 쓴 뒤에는 돌아온다
    player.mp -= 10
    game.playerAction({ kind: 'item', itemId: 'mana_potion', targetId: player.id })
    expect(events.find((e) => e.type === 'itemUsed')).toMatchObject({
      name: '마력 물약',
      mana: 10, // 최대치를 넘지 않는다
    })
    expect(player.mp).toBe(player.maxMp)
  })

  it('스태미나 물약은 기술 대기를 즉시 줄인다 — 바닥은 0', () => {
    const { game, events, timer } = makeGame()
    const base = game.snapshot()
    game.restore({ ...base, bags: [[{ item: 'stamina_potion', count: 2 }], [], []] })
    game.field.pos = { x: 4, y: 7 }
    game.moveField('north')
    skipDialogue(game)
    const player = game.player

    // 줄일 대기가 없으면 쓰이지 않는다
    game.playerAction({ kind: 'item', itemId: 'stamina_potion', targetId: player.id })
    expect(events.some((e) => e.type === 'itemUsed')).toBe(false)

    // 스킬을 써서 대기를 만든 뒤 내 차례에 마신다
    game.playerAction({ kind: 'skill', skillIndex: 0, targetId: game.battle!.enemies[0].id })
    expect(player.cooldowns[0]).toBe(2)
    let guard = 0
    while (game.mode === 'battle' && guard++ < 20 && !game.battle!.currentActor.isPlayer) {
      timer.flush()
    }
    // 라운드가 한 바퀴 돌아 대기 1 — 물약으로 0까지
    game.playerAction({ kind: 'item', itemId: 'stamina_potion', targetId: player.id })
    expect(events.find((e) => e.type === 'itemUsed')).toMatchObject({
      name: '스태미나 물약',
      cooldownCut: 2,
    })
    expect(player.cooldowns.every((c) => c >= 0)).toBe(true)
    expect(player.cooldowns[0]).toBe(0)
  })

  it('필드에서도 물약을 쓴다 — 체력이 가득이면 쓰지 않는다', () => {
    const { game } = makeGame()
    const base = game.snapshot()
    game.restore({ ...base, bags: [[{ item: 'potion_small', count: 2 }], [], []] })
    expect(game.useItemInField('potion_small', 'rogue')).toBe(false) // 가득
    game.player.hp -= 10
    expect(game.useItemInField('potion_small', 'rogue')).toBe(true)
    expect(game.player.hp).toBe(game.player.maxHp)
    expect(game.inventoryList[0].count).toBe(1)
  })
})

describe('장비', () => {
  it('입으면 능력치가 오르고 벗으면 돌아온다 — 가방과 어긋나지 않는다', () => {
    const { game } = makeGame()
    const base = game.snapshot()
    game.restore({ ...base, bags: [[{ item: 'wood_sword', count: 1 }], [], []] })
    const before = game.player.patk

    expect(game.equip('rogue', 'wood_sword')).toBe(true)
    expect(game.player.patk).toBe(before + 3)
    expect(game.inventoryList.find((i) => i.id === 'wood_sword')).toBeUndefined()

    expect(game.unequip('rogue', 'weapon')).toBe(true)
    expect(game.player.patk).toBe(before)
    expect(game.inventoryList.find((i) => i.id === 'wood_sword')?.count).toBe(1)
  })

  it('같은 슬롯에 입으면 맞교환된다 — 중간 상태가 없다', () => {
    const { game } = makeGame()
    const base = game.snapshot()
    game.restore({
      ...base,
      xp: 70, // 4레벨 — 강철 검 조건
      bags: [[
        { item: 'wood_sword', count: 1 },
        { item: 'steel_sword', count: 1 },
      ], [], []],
    })
    game.equip('rogue', 'wood_sword')
    expect(game.equip('rogue', 'steel_sword')).toBe(true)
    expect(game.equipmentOf('rogue').weapon).toBe('steel_sword')
    expect(game.inventoryList.find((i) => i.id === 'wood_sword')?.count).toBe(1)
  })

  it('레벨이 모자라면 입을 수 없고 이유를 말해 준다', () => {
    const { game } = makeGame()
    const base = game.snapshot()
    game.restore({ ...base, bags: [[{ item: 'steel_sword', count: 1 }], [], []] })
    const check = game.canEquip('rogue', 'steel_sword')
    expect(check.ok).toBe(false)
    expect(check.reason).toContain('4레벨')
    expect(game.equip('rogue', 'steel_sword')).toBe(false)
    expect(game.inventoryList.find((i) => i.id === 'steel_sword')?.count).toBe(1)
  })

  it('울림 세트 2개부터 보너스가 붙는다', () => {
    const { game } = makeGame()
    const base = game.snapshot()
    game.restore({
      ...base,
      xp: 160, // 6레벨 — 울림 장비 조건
      bags: [[
        { item: 'echo_sword', count: 1 },
        { item: 'echo_armor', count: 1 },
      ], [], []],
    })
    game.equip('rogue', 'echo_sword')
    expect(game.statBreakdownOf('rogue')!.set.patk).toBe(0) // 1개는 세트가 아니다
    game.equip('rogue', 'echo_armor')
    const b = game.statBreakdownOf('rogue')!
    expect(b.set).toMatchObject({ patk: 3, matk: 0, pdef: 2, mdef: 1 })
    expect(game.player.patk).toBe(b.total.patk)
  })

  it('오라 장비는 착용자가 아니라 동료를 강화한다', () => {
    const { game } = makeGame()
    const base = game.snapshot()
    game.restore({ ...base, xp: 70, bags: [[{ item: 'story_banner', count: 1 }], [], []] }) // 4레벨
    const warriorBefore = game.party[1].patk
    const rogueBefore = game.player.patk
    game.equip('warrior', 'story_banner')
    // 전사 자신은 깃발의 본체 수치(+1)만, 동료들은 오라(+1)를 받는다
    expect(game.party[1].patk).toBe(warriorBefore + 1)
    expect(game.statBreakdownOf('warrior')!.aura.patk).toBe(0)
    expect(game.player.patk).toBe(rogueBefore + 1)
    expect(game.statBreakdownOf('rogue')!.aura.patk).toBe(1)
  })

  it('특성을 바꿔도 성장과 장비가 유지된다 (회귀)', () => {
    // 예전 setTrait은 직업 기본값에서 재계산해 성장·장비를 날렸다
    const { game } = makeGame()
    const base = game.snapshot()
    game.restore({
      ...base,
      xp: 70, // 3레벨
      bags: [[{ item: 'wood_sword', count: 1 }], [], []],
      field: { ...base.field, pos: { x: 9, y: 2 }, checkpointReached: true }, // 쉼터
    })
    game.equip('rogue', 'wood_sword')
    expect(game.setTrait('swift-step')).toBe(true) // 속도 +3, 공격 -2
    // 물리 공격 = 기본 20 + 성장 2×3 + 나무 검 3 − 특성 2
    expect(game.player.patk).toBe(20 + 6 + 3 - 2)
    expect(game.player.spd).toBe(12 + 3 + 3)
  })

  it('형상 변형 문자열은 장비 조합이 같으면 항상 같다', () => {
    const { game } = makeGame()
    const base = game.snapshot()
    game.restore({
      ...base,
      xp: 70, // 4레벨
      bags: [[
        { item: 'wood_sword', count: 1 },
        { item: 'chain_armor', count: 1 },
        { item: 'cloth_gloves', count: 1 },
      ], [], []],
    })
    expect(game.equipVariantOf('rogue')).toBeNull() // 아무것도 안 입었다

    // 갑옷 → 무기 순서로 입어도 variant는 슬롯 고정 순서를 따른다
    game.equip('rogue', 'chain_armor')
    game.equip('rogue', 'wood_sword')
    const v = game.equipVariantOf('rogue')!
    expect(v.variant).toBe('wood_sword+chain_armor')
    expect(v.recolors.weapon?.primary).toBeDefined()

    // 리컬러 없는 장비만으로는 변형이 없다
    game.unequip('rogue', 'weapon')
    game.unequip('rogue', 'armor')
    game.equip('rogue', 'cloth_gloves')
    expect(game.equipVariantOf('rogue')).toBeNull()
  })

  it('파티에서 빠지는 직업의 장비는 가방으로 돌아온다', () => {
    const { game } = makeGame()
    // 타이틀에서 장비를 채운 뒤 구성을 바꾼다
    game.restore({ ...game.snapshot(), bags: [[{ item: 'wood_sword', count: 1 }], [], []] })
    game.equip('warrior', 'wood_sword')
    game.returnToTitle()
    expect(game.setParty(['rogue', 'mage', 'healer'])).toBe(true) // 전사가 빠진다
    expect(game.inventoryList.find((i) => i.id === 'wood_sword')?.count).toBe(1)
    expect(game.equipmentOf('warrior')).toEqual({})
  })
})

describe('지각 반경 합성', () => {
  it('어두운 스테이지는 특성이 없어도 반경이 생긴다', () => {
    const { game } = makeGame()
    game.startStage(1) // 울림 굴 — darkness 5
    expect(game.perceptionRadius).toBe(5)
  })

  it('특성과 스테이지 중 좁은 쪽을 쓴다', () => {
    const { game } = makeGame()
    game.setTrait('narrow-focus') // 반경 4
    game.startStage(1) // 어둠 5
    expect(game.perceptionRadius).toBe(4)
  })

  it('밝은 스테이지에서는 특성 반경만 적용된다', () => {
    const { game } = makeGame()
    game.setTrait('narrow-focus')
    game.startStage(2) // 울림 탑 — 어둠 없음
    expect(game.perceptionRadius).toBe(4)
  })
})

/**
 * 화면 위쪽 현황판은 눈으로 보는 사람에게 늘 보이지만, 필드 영역이 role=application이라
 * 브라우즈 모드에서는 화살표로 닿지 않는다. 그래서 둘러보기가 같은 수를 말해 준다.
 * 두 곳이 다른 수를 말하기 시작하면 낭독이 거짓이 되므로 여기서 묶어 둔다.
 */
describe('둘러보기는 현황판과 같은 수를 말한다', () => {
  function lookAround(game: Game, events: GameEvent[]): string {
    const before = events.length
    game.fieldSummary()
    const e = events.slice(before).find((x) => x.type === 'fieldSummary')
    return e && e.type === 'fieldSummary' ? e.text : ''
  }

  it('파티 체력·지갑·레벨·스테이지가 전부 들어 있다', () => {
    const { game, events } = makeGame()
    game.start()
    skipDialogue(game)
    const text = lookAround(game, events)
    for (const c of game.party) {
      // 내 자리는 현황판과 같이 (나)를 붙인다 — 셋이 걸을 때 누구 체력인지 헷갈리지 않게
      const who = c.seat === game.localSeat ? `${c.name}(나)` : c.name
      expect(text, c.name).toContain(`${who} ${c.hp}/${c.maxHp}`)
    }
    expect(text).toContain(`동전 ${game.currentGold}냥`)
    expect(text).toContain(`재료 ${game.currentMaterials}개`)
    expect(text).toContain(`파티 ${game.partyLevel}레벨`)
    expect(text).toContain(`스테이지 ${game.currentStageIndex + 1}`)
  })

  it('쓰러진 동료는 숫자가 아니라 쓰러짐이라고 말한다', () => {
    const { game, events } = makeGame()
    game.start()
    skipDialogue(game)
    game.party[1].hp = 0
    const text = lookAround(game, events)
    expect(text).toContain(`${game.party[1].name} 쓰러짐`)
  })

  it('구역이 여럿인 스테이지에서는 몇 번째 구역인지 말한다', () => {
    const { game, events } = makeGame()
    game.startStage(1) // 울림 굴 — 구역이 여럿
    skipDialogue(game)
    const total = game.stage.areas.length
    expect(total).toBeGreaterThan(1)
    expect(lookAround(game, events)).toContain(`구역 1/${total}`)
  })

  it('저절로 나가는 요약에는 현황을 붙이지 않는다 — 걸음마다 지갑을 듣지 않게', () => {
    const { game, events } = makeGame()
    game.start()
    skipDialogue(game)
    const auto = events.filter((e) => e.type === 'fieldSummary')
    expect(auto.length).toBeGreaterThan(0)
    for (const e of auto) {
      if (e.type === 'fieldSummary') expect(e.text).not.toContain('체력은')
    }
  })
})

/**
 * 타이틀로 나갔다가 새로 시작하면 정말로 새로 시작해야 한다.
 *
 * Game은 화면이 살아 있는 동안 하나뿐인 객체다. 그래서 "새 모험"이 진행도를 지우지
 * 않으면, 저장을 다 지우고 새로 시작해도 지난 판의 레벨·장비·지갑이 그대로 따라온다.
 * 지운 사람은 지웠다고 믿기 때문에 이 어긋남은 조용히 지나간다.
 */
describe('새로 시작하면 지난 판이 따라오지 않는다', () => {
  /** 한참 걸어 온 상태 — 이어서 하기가 지나는 길 그대로 만든다 */
  function playedAWhile() {
    const { game, events } = makeGame()
    game.start()
    skipDialogue(game)
    const snap = game.snapshot()
    game.restore({
      ...snap,
      xp: 200,
      golds: [500, 0, 0],
      materials: [30, 0, 0],
      bags: [[{ item: 'potion_small', count: 3 }], [], []],
      kills: [{ monster: 'slime', count: 5 }],
      party: snap.party.map((p, i) =>
        i === 0 ? { ...p, equipment: { weapon: 'wood_sword' } } : p,
      ),
      upgrades: [{ job: snap.party[0].job, stat: 'hp', level: 2 }],
      clearedStages: ['stage1'],
      seenDialogues: ['intro'],
    })
    skipDialogue(game)
    return { game, events }
  }

  it('한참 걸어 온 상태가 실제로 만들어진다', () => {
    const { game } = playedAWhile()
    expect(game.partyLevel).toBeGreaterThan(1)
    expect(game.currentGold).toBe(500)
    expect(game.equipmentOf(game.party[0].id).weapon).toBe('wood_sword')
  })

  it('레벨·지갑·가방·장비·강화가 전부 처음으로 돌아간다', () => {
    const { game } = playedAWhile()
    const grownId = game.party[0].id

    game.returnToTitle()
    game.start()
    skipDialogue(game)

    expect(game.currentXp).toBe(0)
    expect(game.partyLevel).toBe(1)
    expect(game.currentGold).toBe(0)
    expect(game.currentMaterials).toBe(0)
    expect(game.inventoryList).toEqual([])
    expect(game.equipmentOf(grownId)).toEqual({})
    expect(game.upgradeLevelOf(grownId, 'hp')).toBe(0)
  })

  it('처치 수와 클리어 기록, 본 대사도 함께 지워진다', () => {
    const { game } = playedAWhile()
    game.returnToTitle()
    game.start()
    skipDialogue(game)
    const snap = game.snapshot()
    expect(game.clearedStageIds).toEqual([])
    expect(snap.kills).toEqual([]) // 드랍 순환이 지난 판에서 이어지면 안 된다
    expect(snap.seenDialogues).toEqual([])
  })

  it('타이틀을 거치지 않고 곧장 새로 시작해도 마찬가지다', () => {
    const { game } = playedAWhile()
    game.start() // 함께 하기의 출발 조건이 지나는 길
    skipDialogue(game)
    expect(game.currentGold).toBe(0)
    expect(game.partyLevel).toBe(1)
  })

  it('스테이지를 골라 들어가는 것은 지우지 않는다 — 그건 이어서 가는 길이다', () => {
    const { game } = playedAWhile()
    const gold = game.currentGold
    const weapon = game.equipmentOf(game.party[0].id).weapon
    game.startStage(1)
    skipDialogue(game)
    expect(game.currentGold).toBe(gold)
    expect(game.equipmentOf(game.party[0].id).weapon).toBe(weapon)
  })

  it('지도 순환은 지우지 않는다 — 다시 시작하면 다른 지도여야 한다', () => {
    // 변형이 둘인 스테이지로 확인한다. 순환 자리까지 지워 버리면 새 판마다
    // 같은 지도를 걷게 되고, "무작위가 아니라 순서다"의 순서가 사라진다
    const { game } = makeGame()
    game.startStage(1)
    skipDialogue(game)
    const first = game.snapshot().variants.find((v) => v.stage === game.stage.id)?.variant

    game.returnToTitle()
    game.start()
    skipDialogue(game)
    game.startStage(1)
    skipDialogue(game)
    const second = game.snapshot().variants.find((v) => v.stage === game.stage.id)?.variant

    expect(game.stage.variantCount).toBeGreaterThan(1)
    expect(second).not.toBe(first)
  })

  it('이어서 하기는 여전히 기록을 그대로 되살린다', () => {
    const { game } = playedAWhile()
    const saved = game.snapshot()
    game.returnToTitle()
    game.start() // 새로 시작해 전부 지운 뒤
    skipDialogue(game)
    expect(game.currentGold).toBe(0)
    game.restore(saved) // 다시 불러오면 돌아와야 한다
    expect(game.currentGold).toBe(500)
    expect(game.partyLevel).toBeGreaterThan(1)
  })
})

/**
 * 밟기 전에 들려야 하는 것들. Field를 새로 만드는 자리가 셋이라(생성·스테이지 전환·
 * 되살아나기) 한 곳만 빠뜨려도 스테이지를 옮긴 뒤 표시가 사라진다 — 실제로 빠뜨렸다.
 */
describe('강한 기척', () => {
  it('큰 싸움이 되는 조우는 이름에 표시가 붙는다', () => {
    const { game } = makeGame()
    const named = (monsters: string[]) =>
      game.field.encounterName({ id: 'x', pos: { x: 0, y: 0 }, monsters })
    expect(named(['echo_priest'])).toBe('울림 사제(강한 기척)')
    expect(named(['echo_shard'])).toBe('울림 조각')
  })

  it('스테이지를 옮겨도 표시가 살아 있다', () => {
    const { game } = makeGame()
    game.startStage(1)
    expect(
      game.field.encounterName({ id: 'x', pos: { x: 0, y: 0 }, monsters: ['echo_priest'] }),
    ).toContain('강한 기척')
    game.startStage(2)
    expect(
      game.field.encounterName({ id: 'x', pos: { x: 0, y: 0 }, monsters: ['echo_priest'] }),
    ).toContain('강한 기척')
  })
})

/**
 * 스테이지의 끝은 지도가 정한다.
 *
 * 처음에는 몹 데이터의 isBoss로 판정했는데, 울림 사제처럼 첫 처치 보상을 갖는
 * 중간 관문도 isBoss라서 지나가는 길에 스테이지가 끝나 버렸다. 넓은 길을 고른
 * 사람이 보물을 보기도 전에 클리어 화면을 본 것이다.
 */
describe('스테이지를 끝내는 싸움', () => {
  /** 그 조우를 이겼다고 치고 승리 처리를 태운다 */
  function win(game: Game, timer: ReturnType<typeof fakeScheduler>, shortId: string) {
    stepInto(game, shortId)
    skipDialogue(game)
    for (const e of game.battle!.enemies) e.hp = 1
    let guard = 0
    while (game.mode === 'battle' && guard++ < 300) {
      if (game.battle!.currentActor.isPlayer) {
        const target = game.battle!.enemies.find((x) => x.hp > 0)
        if (!target) break
        game.playerAction({ kind: 'attack', targetId: target.id })
      } else {
        timer.flush()
      }
    }
  }

  it('보스가 아닌 조우를 이기면 스테이지가 이어진다', () => {
    const { game, timer } = makeGame()
    game.start()
    skipDialogue(game)
    win(game, timer, 'e1')
    expect(game.mode).not.toBe('clear')
    expect(game.clearedStageIds).not.toContain(game.stage.id)
  })

  it('그 구역의 보스를 이겨야 클리어다', () => {
    const { game, timer } = makeGame()
    game.start()
    skipDialogue(game)
    win(game, timer, 'boss')
    skipDialogue(game)
    expect(game.clearedStageIds).toContain('stage1')
  })

  it('중간 관문은 스테이지 보스가 아니다 — 지도가 그렇게 말한다', () => {
    // 사제가 선 구역에는 boss가 없고, 종지기 구역에만 있다.
    // 이 관계가 깨지면 사제를 잡는 순간 스테이지가 끝난다
    const { game } = makeGame()
    game.startStage(2)
    const stage = game.stage
    const withBoss = stage.areas.filter((a) => a.boss)
    expect(withBoss).toHaveLength(1)
    expect(withBoss[0].boss!.monsters).toContain('bell_keeper')
    const priestArea = stage.areas.find((a) =>
      a.encounters.some((e) => e.monsters.includes('echo_priest')),
    )!
    expect(priestArea.boss, '울림 사제가 선 구역에 보스가 있으면 안 된다').toBeUndefined()
  })
})

/**
 * 가방이 자리마다 갈린 뒤의 규칙들.
 *
 * 하나를 공유하던 시절에는 떨어진 무기를 두고 누가 가질지 다투게 되고, 내가
 * 쓰려던 물약을 남이 마셔 버릴 수 있었다. 이제 보상은 사람이 앉은 자리마다 같은
 * 것을 하나씩 받고, 남에게 주고 싶으면 직접 건넨다.
 */
describe('자리별 가방과 지갑', () => {
  const bagsOf = (game: Game) =>
    (game as unknown as { bags: Map<string, number>[] }).bags
  const goldsOf = (game: Game) => (game as unknown as { golds: number[] }).golds

  it('솔로에서는 예전과 똑같이 한 벌만 나온다', () => {
    // 사람이 앉은 자리가 0번뿐이라 보상도 한 벌이다 — 밸런스가 흔들리지 않는다
    const { game } = makeGame()
    game.start()
    skipDialogue(game)
    const add = (game as unknown as { addItemToAll: (id: string) => void }).addItemToAll
    add.call(game, 'potion_small')
    expect(bagsOf(game)[0].get('potion_small')).toBe(1)
    expect(bagsOf(game)[1]?.get('potion_small') ?? 0).toBe(0)
  })

  it('사람이 앉은 자리마다 같은 것을 하나씩 받는다', () => {
    const { game } = makeGame()
    game.setSeatController(1, 'human')
    game.start()
    skipDialogue(game)
    const add = (game as unknown as { addItemToAll: (id: string) => void }).addItemToAll
    add.call(game, 'potion_small')
    expect(bagsOf(game)[0].get('potion_small')).toBe(1)
    expect(bagsOf(game)[1].get('potion_small')).toBe(1)
    // 컴퓨터가 맡은 자리는 받지 않는다 — 쓸 손이 없다
    expect(bagsOf(game)[2]?.get('potion_small') ?? 0).toBe(0)
  })

  it('동전도 자리마다 들어온다', () => {
    const { game } = makeGame()
    game.setSeatController(1, 'human')
    const gain = (game as unknown as { gainGold: (n: number) => void }).gainGold
    gain.call(game, 30)
    expect(goldsOf(game)[0]).toBe(30)
    expect(goldsOf(game)[1]).toBe(30)
    expect(goldsOf(game)[2] ?? 0).toBe(0)
  })

  it('내 가방의 물건을 동료에게 건넨다', () => {
    const { game } = makeGame()
    game.setSeatController(1, 'human')
    const add = (game as unknown as { addItem: (id: string, seat: number) => void }).addItem
    add.call(game, 'potion_small', 0)
    expect(game.giveItem('potion_small', 1, 0)).toBe(true)
    expect(game.countOf('potion_small', 0)).toBe(0)
    expect(game.countOf('potion_small', 1)).toBe(1)
  })

  it('없는 물건도, 나 자신에게도, 컴퓨터 자리에도 건넬 수 없다', () => {
    // 화면의 버튼만 막으면 원격 입력이 들어오는 순간 구멍이 된다 — 코어가 최종 책임자다
    const { game } = makeGame()
    game.setSeatController(1, 'human')
    const add = (game as unknown as { addItem: (id: string, seat: number) => void }).addItem
    add.call(game, 'potion_small', 0)
    expect(game.canGiveItem('potion_big', 1, 0).ok).toBe(false)
    expect(game.canGiveItem('potion_small', 0, 0).ok).toBe(false)
    expect(game.canGiveItem('potion_small', 2, 0).ok).toBe(false)
    expect(game.canGiveItem('potion_small', 9, 0).ok).toBe(false)
  })

  it('저장했다 되돌리면 자리별 가방과 지갑이 그대로다', () => {
    const { game } = makeGame()
    game.setSeatController(1, 'human')
    game.start()
    skipDialogue(game)
    const add = (game as unknown as { addItem: (id: string, seat: number) => void }).addItem
    add.call(game, 'potion_small', 0)
    add.call(game, 'wood_sword', 1)
    const gain = (game as unknown as { gainGold: (n: number) => void }).gainGold
    gain.call(game, 40)

    const snap = game.snapshot()
    expect(snap.bags[0].map((b) => b.item)).toContain('potion_small')
    expect(snap.bags[1].map((b) => b.item)).toContain('wood_sword')
    expect(snap.golds[0]).toBe(40)

    const { game: other } = makeGame()
    other.restore(snap)
    expect(other.countOf('potion_small', 0)).toBe(1)
    expect(other.countOf('wood_sword', 1)).toBe(1)
    expect(other.goldOf(1)).toBe(40)
  })
})
