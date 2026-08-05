import { describe, expect, it } from 'vitest'
import { EventBus, type GameEvent } from './events'
import { Game, type TurnScheduler } from './game'
import type { GameData, StageData, TraitsFile } from './types'
import items from '../data/items.json'
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
    monsters,
    party,
  progression,
  items,
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
    expect(game.field.pos).toEqual(stage2.map.start)
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
    // 스테이지2의 첫 조우(4,6)로 이동 — 같은 키라도 다시 나와야 한다
    game.field.pos = { x: 4, y: 7 }
    game.moveField('north')
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

    game.restore({ ...base, xp: 70 }) // xpTable[2]=70 → 3레벨
    expect(game.partyLevel).toBe(3)
    expect(game.player.skills.length).toBe(2)
    expect(game.player.skills[1].name).toBe('급소 찌르기')
    // 성장이 능력치에 반영된다: 도적 공격 18 + 3×2레벨
    expect(game.player.atk).toBe(18 + 3 * 2)
  })

  it('스테이지에 진입하면 그에 걸맞은 경험치가 보장된다', () => {
    const { game } = makeGame()
    game.startStage(2)
    expect(game.currentXp).toBeGreaterThanOrEqual(110)
    expect(game.partyLevel).toBeGreaterThanOrEqual(3)
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
      expect.objectContaining({ id: 'potion_small', count: 1, usable: true }),
    ])
  })

  it('보물상자는 밟으면 열리고 두 번 열리지 않는다', () => {
    const { game, events } = makeGame()
    game.start()
    skipDialogue(game)
    game.field.pos = { x: 3, y: 4 }
    game.moveField('west') // (2,4) 상자
    expect(events.find((e) => e.type === 'chestOpened')).toMatchObject({
      itemNames: ['작은 물약'],
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
    game.restore({ ...base, inventory: [{ item: 'potion_small', count: 1 }] })
    game.field.pos = { x: 4, y: 7 }
    game.moveField('north')
    skipDialogue(game)
    const player = game.player
    player.hp = player.maxHp - 50

    game.playerAction({ kind: 'item', itemId: 'potion_small', targetId: player.id })
    expect(events.find((e) => e.type === 'itemUsed')).toMatchObject({
      name: '작은 물약',
      amount: 30,
    })
    expect(player.hp).toBe(player.maxHp - 20)
    expect(game.inventoryList.length).toBe(0) // 다 썼다
  })

  it('필드에서도 물약을 쓴다 — 체력이 가득이면 쓰지 않는다', () => {
    const { game } = makeGame()
    const base = game.snapshot()
    game.restore({ ...base, inventory: [{ item: 'potion_small', count: 2 }] })
    expect(game.useItemInField('potion_small', 'rogue')).toBe(false) // 가득
    game.player.hp -= 10
    expect(game.useItemInField('potion_small', 'rogue')).toBe(true)
    expect(game.player.hp).toBe(game.player.maxHp)
    expect(game.inventoryList[0].count).toBe(1)
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
