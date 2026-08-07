import { describe, expect, it } from 'vitest'
import { EventBus, type GameEvent } from './events'
import { Game, type TurnScheduler } from './game'
import { snapshotChecksum } from '../net/checksum'
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

/** 예약을 손으로 미는 스케줄러 — 틱이 곧 명령이 되는 함께 하기의 축소판 */
function makeGame() {
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
  const bus = new EventBus()
  const events: GameEvent[] = []
  bus.on((e) => events.push(e))
  const game = new Game(DATA, bus, scheduler, null, () => 1000)
  const tick = () => {
    for (const [id, fn] of [...pending]) {
      pending.delete(id)
      fn()
    }
  }
  return { game, events, tick }
}

function skipDialogue(game: Game) {
  let guard = 0
  while (game.mode === 'dialogue' && guard++ < 50) game.advanceDialogue()
}

describe('좌석 — 누가 이 자리를 조작하는가', () => {
  it('솔로 기본은 0번만 사람이고 동료는 스스로 싸운다', () => {
    const { game } = makeGame()
    expect(game.seatControllerOf(0)).toBe('human')
    expect(game.seatControllerOf(1)).toBe('npc')
    expect(game.seatControllerOf(2)).toBe('npc')
    expect(game.party[0].isPlayer).toBe(true)
    expect(game.party[1].isPlayer).toBe(false)
  })

  it('남의 자리 차례에 낸 행동은 조용히 거절된다', () => {
    const { game, tick } = makeGame()
    game.setSeatController(1, 'human')
    game.start()
    skipDialogue(game)
    const area = game.field.currentArea
    const target = area.encounters[0]
    const dirs = [
      { d: 'south' as const, x: 0, y: -1 },
      { d: 'north' as const, x: 0, y: 1 },
      { d: 'west' as const, x: 1, y: 0 },
      { d: 'east' as const, x: -1, y: 0 },
    ]
    const s = dirs.find((s) => area.tiles[target.pos.y + s.y]?.[target.pos.x + s.x] === 0)!
    game.field.pos = { x: target.pos.x + s.x, y: target.pos.y + s.y }
    game.moveField(s.d)
    skipDialogue(game)

    // 지금 차례인 좌석을 찾고, 다른 좌석 번호로 공격을 시도한다
    let guard = 0
    while (game.mode === 'battle' && !game.battle!.currentActor.isPlayer && guard++ < 50) tick()
    const actorSeat = game.battle!.currentActor.seat!
    const wrongSeat = actorSeat === 0 ? 1 : 0
    const enemy = game.battle!.enemies[0]
    const before = enemy.hp
    game.playerAction({ kind: 'attack', targetId: enemy.id }, wrongSeat)
    expect(enemy.hp).toBe(before) // 아무 일도 없다
    game.playerAction({ kind: 'attack', targetId: enemy.id }, actorSeat)
    expect(enemy.hp).toBeLessThan(before)
  })

  it('이동과 대사 넘김은 길잡이(이동 토큰)의 몫이다', () => {
    const { game } = makeGame()
    game.setSeatController(1, 'human')
    game.start()
    skipDialogue(game)
    const at = { ...game.field.pos }
    // 토큰 없는 좌석의 이동은 거절
    game.moveField('east', 1)
    expect(game.field.pos).toEqual(at)
    // 토큰을 넘기면 그 좌석이 움직인다
    expect(game.passMoveToken(1)).toBe(true)
    game.moveField('east', 1)
    expect(game.field.pos).not.toEqual(at)
    // 이제 0번은 못 움직인다
    const at2 = { ...game.field.pos }
    game.moveField('east', 0)
    expect(game.field.pos).toEqual(at2)
  })

  it('토큰은 쥔 사람이나 방장만 넘긴다', () => {
    const { game } = makeGame()
    game.setSeatController(1, 'human')
    game.setSeatController(2, 'human')
    expect(game.passMoveToken(1, 2)).toBe(false) // 제3자는 못 넘긴다
    expect(game.passMoveToken(1, 0)).toBe(true) // 방장은 된다
    expect(game.passMoveToken(2, 1)).toBe(true) // 쥔 사람은 된다
    expect(game.passMoveToken(0, 0)).toBe(true) // 방장은 회수할 수 있다
  })

  it('사람 자리가 비면 그 자리의 차례를 동료 AI가 즉시 이어받는다', () => {
    const { game, tick, events } = makeGame()
    game.setSeatController(1, 'human')
    game.start()
    skipDialogue(game)
    const area = game.field.currentArea
    const target = area.encounters[0]
    const dirs = [
      { d: 'south' as const, x: 0, y: -1 },
      { d: 'north' as const, x: 0, y: 1 },
      { d: 'west' as const, x: 1, y: 0 },
      { d: 'east' as const, x: -1, y: 0 },
    ]
    const s = dirs.find((s) => area.tiles[target.pos.y + s.y]?.[target.pos.x + s.x] === 0)!
    game.field.pos = { x: target.pos.x + s.x, y: target.pos.y + s.y }
    game.moveField(s.d)
    skipDialogue(game)

    // 1번 좌석(전사)의 차례까지 진행
    let guard = 0
    while (
      game.mode === 'battle' &&
      !(game.battle!.currentActor.isPlayer && game.battle!.currentActor.seat === 1) &&
      guard++ < 50
    ) {
      if (game.battle!.currentActor.isPlayer) {
        // 0번 차례면 방어로 넘긴다
        game.playerAction({ kind: 'defend' }, game.battle!.currentActor.seat!)
      }
      tick()
    }
    expect(game.battle!.currentActor.seat).toBe(1)
    const countBefore = events.length
    // 접속 끊김 — 그 자리가 AI로 넘어가고 턴이 이어진다.
    // 턴 사이(타이머 대기 중)라면 보류된 틱이, 입력 대기 중이라면 즉시 재개가 잇는다
    game.setSeatController(1, 'npc')
    tick()
    const newEvents = events.slice(countBefore)
    expect(newEvents.some((e) => e.type === 'seatControlChanged')).toBe(true)
    // 대기가 풀렸다 — 전사가 스스로 행동했거나(공격/도발) 턴이 진행됐다
    expect(
      newEvents.some((e) => e.type === 'attacked' || e.type === 'taunted' || e.type === 'turnStart'),
    ).toBe(true)
    // 이후로는 사람 입력을 기다리는 자리가 0번뿐이다
    let guard2 = 0
    while (game.mode === 'battle' && guard2++ < 100) {
      const actor = game.battle!.currentActor
      if (actor.isPlayer) {
        expect(actor.seat).toBe(0)
        game.playerAction({ kind: 'defend' }, 0)
      }
      tick()
    }
  })
})

describe('결정성 — 같은 명령 열이면 같은 세계', () => {
  it('두 화면에 같은 명령을 재생하면 체크섬이 같다', () => {
    const run = () => {
      const { game, tick } = makeGame()
      game.setSeatController(1, 'human')
      game.start()
      skipDialogue(game)
      // 고정 대본: 이동 → 상자 → 조우 → 전투 → 승리까지 같은 명령 열
      const script: Array<() => void> = [
        () => game.moveField('east', 0),
        () => game.moveField('east', 0),
        () => game.moveField('east', 0),
        () => game.moveField('north', 0),
        () => skipDialogue(game),
      ]
      for (const step of script) step()
      // 전투: 사람 좌석 차례면 공격, 아니면 틱 — 명령 열이 동일하게 반복된다
      let guard = 0
      while (game.mode === 'battle' && guard++ < 200) {
        const actor = game.battle!.currentActor
        if (actor.isPlayer) {
          const enemy = game.battle!.enemies.find((e) => e.hp > 0)
          if (!enemy) break
          game.playerAction({ kind: 'attack', targetId: enemy.id }, actor.seat!)
        }
        tick()
      }
      return snapshotChecksum(game.snapshot())
    }
    const a = run()
    const b = run()
    expect(a).toBe(b)
  })

  it('updatedAt이 달라도 체크섬은 같다', () => {
    const { game } = makeGame()
    const s1 = { ...game.snapshot(), updatedAt: 1 }
    const s2 = { ...game.snapshot(), updatedAt: 999999 }
    expect(snapshotChecksum(s1)).toBe(snapshotChecksum(s2))
  })

  it('상태가 다르면 체크섬도 다르다', () => {
    const { game } = makeGame()
    const s1 = game.snapshot()
    const s2 = { ...game.snapshot(), golds: [999, 0, 0] }
    expect(snapshotChecksum(s1)).not.toBe(snapshotChecksum(s2))
  })
})
