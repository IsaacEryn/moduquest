import { describe, expect, it } from 'vitest'
import { EventBus, type GameEvent } from './events'
import { Field } from './field'
import { resolveArea, type ResolvedArea } from './layout'
import type { StageData } from './types'
import stage1 from '../data/stages/stage1.json'

const NAMES = { slime: '슬라임', goblin: '고블린', boss_golem: '돌 골렘' }
const STAGE1 = stage1 as StageData
const area1 = () => resolveArea(STAGE1, 'a', 0)

function setup(area: ResolvedArea = area1()) {
  const bus = new EventBus()
  const events: GameEvent[] = []
  bus.on((e) => events.push(e))
  const field = new Field(area, NAMES, bus)
  return { field, events }
}

describe('필드 이동', () => {
  it('바닥으로는 이동하고 이동 이벤트가 난다', () => {
    const { field, events } = setup()
    field.move('east')
    expect(field.pos).toEqual({ x: 2, y: 8 })
    expect(events.at(-1)).toMatchObject({ type: 'moved', dir: 'east' })
  })

  it('벽으로는 이동하지 않고 막힘 이벤트가 난다', () => {
    const { field, events } = setup()
    field.move('north') // (1,7)은 벽
    expect(field.pos).toEqual({ x: 1, y: 8 })
    expect(events.at(-1)).toMatchObject({ type: 'blocked', dir: 'north' })
  })

  it('맵 밖은 벽으로 취급한다', () => {
    const { field } = setup()
    expect(field.isWall({ x: -1, y: 0 })).toBe(true)
    expect(field.isWall({ x: 0, y: 99 })).toBe(true)
  })
})

describe('조우', () => {
  it('몹 인접 칸에 들어서면 조우가 반환된다', () => {
    const { field } = setup()
    field.move('east')
    field.move('east')
    field.move('east') // (4,8)
    const encounter = field.move('north') // (4,7) — e1(4,6) 인접
    expect(encounter?.id).toBe('a-e1')
  })

  it('몹이 있는 칸으로 이동하려 하면 이동 없이 조우가 시작된다', () => {
    const { field } = setup()
    field.move('east')
    field.move('east')
    field.move('east')
    field.move('north') // (4,7)
    const encounter = field.move('north') // e1 칸 자체
    expect(encounter?.id).toBe('a-e1')
    expect(field.pos).toEqual({ x: 4, y: 7 })
  })

  it('처치된 조우는 다시 등장하지 않는다', () => {
    const { field } = setup()
    field.removeEncounter('a-e1')
    field.move('east')
    field.move('east')
    field.move('east')
    expect(field.move('north')).toBeUndefined()
  })
})

describe('체크포인트', () => {
  it('쉼터 도착이 기록되고 이벤트가 난다', () => {
    const { field, events } = setup()
    field.pos = { x: 8, y: 2 }
    field.move('east') // (9,2) 쉼터
    expect(field.checkpointReached).toBe(true)
    expect(events.some((e) => e.type === 'checkpoint')).toBe(true)
  })

  it('몹과 인접한 쉼터도 조우 시작 전에 기록된다', () => {
    // 쉼터 (10,2)는 보스 (10,1)과 인접 — 조우가 먼저 반환돼도 기록은 남아야 한다
    const area = area1()
    area.checkpoint = { x: 10, y: 2 }
    const { field } = setup(area)
    field.pos = { x: 9, y: 2 }
    const encounter = field.move('east')
    expect(encounter?.id).toBe('a-boss')
    expect(field.checkpointReached).toBe(true)
  })

  it('부활 위치는 쉼터 도달 여부를 따른다', () => {
    const { field } = setup()
    field.respawn()
    expect(field.pos).toEqual({ x: 1, y: 8 }) // 시작점
    field.checkpointReached = true
    field.respawn()
    expect(field.pos).toEqual({ x: 9, y: 2 }) // 쉼터
  })
})

describe('주변 요약', () => {
  it('목표와 몹 방향이 포함된다', () => {
    const { field } = setup()
    const text = field.summary(STAGE1.objective)
    expect(text).toContain('목표')
    expect(text).toContain('슬라임')
  })
})
