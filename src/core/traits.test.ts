import { describe, expect, it } from 'vitest'
import { EventBus } from './events'
import { Game } from './game'
import { applyStats, perceptionRadius, resolveTrait, resolveTraitId } from './traits'
import type { GameData, StageData, TraitsFile } from './types'
import items from '../data/items.json'
import jobs from '../data/jobs.json'
import monsters from '../data/monsters.json'
import party from '../data/party.json'
import progression from '../data/progression.json'
import stage from '../data/stages/stage1.json'
import traitsFile from '../data/traits.json'

const TRAITS = traitsFile as TraitsFile

function makeGame(traitId?: string) {
  const data: GameData = {
    jobs: jobs as GameData['jobs'],
    monsters: monsters as GameData['monsters'],
    party,
  progression,
  items,
    stages: [stage as StageData],
    traits: TRAITS,
  }
  const bus = new EventBus()
  // 테스트에서는 턴을 직접 진행하므로 스케줄러는 아무것도 하지 않는다
  const game = new Game(data, bus, { schedule: () => null, cancel: () => {} }, traitId)
  return { game, bus }
}

describe('특성 해석', () => {
  it('모르는 id는 기본값으로', () => {
    expect(resolveTraitId(TRAITS, 'no-such-trait')).toBe(TRAITS.default)
    expect(resolveTraitId(TRAITS, null)).toBe(TRAITS.default)
    expect(resolveTrait(TRAITS, 'no-such-trait').name).toBe('균형')
  })

  it('기본 특성은 아무것도 바꾸지 않는다', () => {
    const base = { hp: 90, atk: 18, def: 6, spd: 12 }
    const t = resolveTrait(TRAITS, 'balanced')
    expect(applyStats(base, t, TRAITS.limits)).toEqual(base)
    expect(perceptionRadius(t, TRAITS.limits)).toBeNull()
  })

  it('능력치가 하한 아래로 내려가지 않는다', () => {
    const t = resolveTrait(TRAITS, 'steady-hand') // spd -3
    const s = applyStats({ hp: 90, atk: 18, def: 6, spd: 4 }, t, TRAITS.limits)
    expect(s.spd).toBe(TRAITS.limits.minStat)
  })

  it('지각 반경은 최소 반경 아래로 좁아지지 않는다', () => {
    const tight = { ...resolveTrait(TRAITS, 'narrow-focus') }
    tight.perception = { radius: 1 }
    expect(perceptionRadius(tight, TRAITS.limits)).toBe(TRAITS.limits.minRadius)
  })
})

describe('특성 적용', () => {
  it('플레이어에게만 적용되고 동료는 그대로다', () => {
    const { game } = makeGame('swift-step') // atk -2, spd +3
    const player = game.player
    const warrior = game.party.find((c) => c.id === 'warrior')!
    expect(player.atk).toBe(jobs.rogue.atk - 2)
    expect(player.spd).toBe(jobs.rogue.spd + 3)
    expect(warrior.atk).toBe(jobs.warrior.atk)
    expect(warrior.spd).toBe(jobs.warrior.spd)
  })

  it('전투 효과가 실린다', () => {
    const { game } = makeGame('steady-hand')
    expect(game.player.pierce).toBe(4)
    const swift = makeGame('swift-step').game
    expect(swift.player.guardEvery).toBe(4)
  })

  it('특성을 바꾸면 체력 비율이 유지된다', () => {
    const { game } = makeGame('balanced')
    game.player.hp = Math.floor(game.player.maxHp / 2)
    game.setTrait('firm-stance') // hp +20
    expect(game.player.maxHp).toBe(jobs.rogue.hp + 20)
    // 절반이었으니 절반 근처여야 한다 — 껐다 켜서 회복하는 악용 차단
    expect(game.player.hp / game.player.maxHp).toBeCloseTo(0.5, 1)
  })

  it('특성을 되돌리면 원래 능력치로 돌아온다', () => {
    const { game } = makeGame('balanced')
    const before = { atk: game.player.atk, spd: game.player.spd }
    game.setTrait('swift-step')
    game.setTrait('balanced')
    expect(game.player.atk).toBe(before.atk)
    expect(game.player.spd).toBe(before.spd)
  })

  it('이득만 챙기고 대가를 피할 수 없다 — 준비하는 자리에서만 바꾼다', () => {
    const { game } = makeGame('balanced')
    game.start() // 인트로 대사 → 필드
    while (game.mode === 'dialogue') game.advanceDialogue()
    expect(game.mode).toBe('field')

    // 필드 한복판에서는 거부한다. 넓게 보다가 전투 직전에 갈아 끼우는 길을 막는다
    expect(game.field.atCheckpoint).toBe(false)
    expect(game.canChangeTrait().ok).toBe(false)
    expect(game.setTrait('narrow-focus')).toBe(false)
    expect(game.currentTraitId).toBe('balanced')

    // 쉼터에서는 허용한다
    game.field.pos = { ...game.stage.checkpoint }
    expect(game.canChangeTrait().ok).toBe(true)
    expect(game.setTrait('narrow-focus')).toBe(true)
    expect(game.currentTraitId).toBe('narrow-focus')
  })

  it('타이틀에서는 자유롭게 고를 수 있다', () => {
    const { game } = makeGame('balanced')
    expect(game.mode).toBe('title')
    expect(game.canChangeTrait().ok).toBe(true)
    expect(game.setTrait('swift-step')).toBe(true)
  })

  it('바꾸면 알림이 나간다', () => {
    const { game, bus } = makeGame('balanced')
    const seen: string[] = []
    bus.on((e) => {
      if (e.type === 'traitChanged') seen.push(e.name)
    })
    game.setTrait('quick-turn')
    expect(seen).toEqual(['짧은 호흡'])
  })
})

describe('지각 반경', () => {
  it('기본 특성은 맵 전체를 안다', () => {
    const { game } = makeGame('balanced')
    expect(game.field.isKnown({ x: 10, y: 1 })).toBe(true)
    expect(game.field.knownEncounters().length).toBe(game.field.alive.size)
  })

  it('좁은 지각은 먼 곳을 모른다', () => {
    const { game } = makeGame('narrow-focus')
    expect(game.perceptionRadius).toBe(4)
    // 시작점 (1,8) 기준 보스 (10,1)은 걸어서 16칸
    expect(game.field.isKnown({ x: 10, y: 1 })).toBe(false)
    expect(game.field.knownEncounters().length).toBeLessThan(game.field.alive.size)
  })

  it('요약이 모르는 곳의 위치를 말하지 않고, 모른다는 사실은 알린다', () => {
    const { game } = makeGame('narrow-focus')
    const text = game.field.summary()
    // 목표 문장에는 보스 이름이 나오지만, 위치 안내("...칸에 돌 골렘.")는 없어야 한다
    expect(text).not.toContain('에 돌 골렘.')
    expect(text).not.toContain('에 슬라임.')
    expect(text).toContain('알 수 없다')
  })

  it('반경 안의 몹은 위치까지 알려준다', () => {
    const { game } = makeGame('narrow-focus')
    game.field.pos = { x: 4, y: 7 } // 슬라임 조우 (4,6) 바로 아래
    expect(game.field.summary()).toContain('에 슬라임.')
  })

  it('쉼터와 목표는 어떤 특성에서도 항상 알려준다', () => {
    for (const id of Object.keys(TRAITS.traits)) {
      const { game } = makeGame(id)
      const text = game.field.summary()
      expect(text, id).toContain('쉼터')
      expect(text, id).toContain('목표')
    }
  })

  it('특성을 바꾸면 반경도 따라 바뀐다', () => {
    const { game } = makeGame('narrow-focus')
    expect(game.field.isKnown({ x: 10, y: 1 })).toBe(false)
    game.setTrait('balanced')
    expect(game.field.isKnown({ x: 10, y: 1 })).toBe(true)
  })
})
