import { describe, expect, it } from 'vitest'
import { EventBus } from './events'
import { Field } from './field'
import { nextVariant, resolveArea } from './layout'
import type { StageData } from './types'
import stage1 from '../data/stages/stage1.json'
import stage2 from '../data/stages/stage2.json'
import stage3 from '../data/stages/stage3.json'

const STAGE1 = stage1 as StageData
const STAGE2 = stage2 as StageData
const STAGE3 = stage3 as StageData
const NAMES = { slime: '슬라임', goblin: '고블린', cave_bat: '굴박쥐', echo_shard: '울림 조각' }

describe('지도 변형 고르기 — 무작위가 아니라 순환이다', () => {
  it('자리마다 다른 지도로 시작한다', () => {
    // 첫 진입은 layoutKey % 장수. 자리를 바꾸면 다른 지도를 만난다
    expect(nextVariant(STAGE2, 0, null)).toBe(0)
    expect(nextVariant(STAGE2, 1, null)).toBe(1)
    expect(nextVariant(STAGE2, 2, null)).toBe(0) // 두 장이므로 다시 처음
  })

  it('다시 할 때마다 다음 장으로 넘어간다', () => {
    const seq: number[] = []
    let prev: number | null = null
    for (let i = 0; i < 5; i++) {
      prev = nextVariant(STAGE2, 0, prev)
      seq.push(prev)
    }
    expect(seq).toEqual([0, 1, 0, 1, 0])
  })

  it('같은 입력이면 언제나 같은 답이다', () => {
    for (let key = 0; key < 4; key++) {
      for (const prev of [null, 0, 1]) {
        const once = nextVariant(STAGE3, key, prev)
        expect(nextVariant(STAGE3, key, prev)).toBe(once)
      }
    }
  })

  it('변형이 한 장뿐이면 늘 그 한 장이다', () => {
    expect(nextVariant(STAGE1, 0, null)).toBe(0)
    expect(nextVariant(STAGE1, 7, 0)).toBe(0)
  })
})

describe('구역 해석', () => {
  it('짧은 id에 구역 접두사를 붙인다', () => {
    const area = resolveArea(STAGE2, 'a', 0)
    expect(area.encounters.map((e) => e.id)).toEqual(['a-e1', 'a-e2'])
    expect(area.chests.map((c) => c.id)).toEqual(['a-t1'])
    expect(area.exits.map((e) => e.id)).toEqual(['a-deeper'])
  })

  it('문 앞에 설 자리를 유도한다', () => {
    const area = resolveArea(STAGE2, 'b', 0)
    const entry = area.entryAt('back')
    expect(area.tiles[entry.y][entry.x]).toBe(0)
    // 들어온 문 바로 옆이다 — 문 위에 서면 곧장 되돌아간다
    const door = area.exits.find((e) => e.id === 'b-back')!.pos
    expect(Math.abs(entry.x - door.x) + Math.abs(entry.y - door.y)).toBe(1)
  })

  it('쉼터와 보스가 다른 구역이면 어느 문으로 가는지 알려 준다', () => {
    const first = resolveArea(STAGE2, 'a', 0)
    expect(first.checkpointRoute.here).toBe(false)
    expect(first.bossRoute.here).toBe(false)
    if (!first.bossRoute.here) {
      expect(first.bossRoute.viaExitId).toBe('deeper')
      expect(first.bossRoute.areaName).toBe('굴 안쪽')
    }
    const last = resolveArea(STAGE2, 'c', 0)
    expect(last.checkpointRoute.here).toBe(true)
    expect(last.bossRoute.here).toBe(true)
  })

  it('갈림길에서는 가까운 쪽 문을 가리킨다', () => {
    const fork = resolveArea(STAGE3, 'b', 0)
    // 좁은 틈이 보스에게 곧장 간다 — 넓은 길은 한 구역을 더 지난다
    if (!fork.bossRoute.here) expect(fork.bossRoute.viaExitId).toBe('narrow')
  })
})

describe('구역을 오가도 진행이 남는다', () => {
  it('열었던 상자가 되돌아가도 부활하지 않는다', () => {
    const bus = new EventBus()
    const a = resolveArea(STAGE2, 'a', 0)
    const field = new Field(a, NAMES, bus)
    const chest = a.chests[0]
    expect(field.openChestAt(chest.pos)).toBeDefined()
    expect(field.openedChestIds).toEqual(['a-t1'])

    // 다른 구역에 갔다가 돌아온다 — Field를 새로 만들지 않는 것이 요점이다
    field.enterArea(resolveArea(STAGE2, 'b', 0), 'back')
    field.enterArea(resolveArea(STAGE2, 'a', 0), 'deeper')
    expect(field.openChestAt(chest.pos)).toBeUndefined()
    expect(field.knownChests()).toEqual([])
  })

  it('잡은 몹이 되살아나지 않고, 다른 구역 몹은 그대로 있다', () => {
    const bus = new EventBus()
    const field = new Field(resolveArea(STAGE2, 'a', 0), NAMES, bus)
    field.removeEncounter('a-e1')
    expect([...field.alive.keys()]).toEqual(['a-e2'])

    field.enterArea(resolveArea(STAGE2, 'b', 0), 'back')
    expect([...field.alive.keys()]).toEqual(['b-e1', 'b-e2'])

    field.enterArea(resolveArea(STAGE2, 'a', 0), 'deeper')
    expect([...field.alive.keys()]).toEqual(['a-e2'])
  })

  it('좌표가 겹쳐도 다른 구역 것이 끌려오지 않는다', () => {
    const bus = new EventBus()
    const b = resolveArea(STAGE2, 'b', 0)
    const field = new Field(b, NAMES, bus)
    // 다른 구역의 조우 자리를 그대로 짚어도 지금 구역 것만 본다
    const other = resolveArea(STAGE2, 'a', 0).encounters[0].pos
    const here = field.encounterAt(other)
    if (here) expect(here.id.startsWith('b-')).toBe(true)
  })
})
