import { describe, expect, it } from 'vitest'
import { MAP_SIZE, resolveArea, scopedId } from './layout'
import type { AreaData, AreaVariant, Pos, StageData, TraitsFile } from './types'
import monsters from '../data/monsters.json'
import stage1 from '../data/stages/stage1.json'
import stage2 from '../data/stages/stage2.json'
import stage3 from '../data/stages/stage3.json'
import traitsFile from '../data/traits.json'

const STAGES = [stage1, stage2, stage3] as StageData[]
const TRAITS = traitsFile as TraitsFile

/** 스테이지 × 구역 × 변형을 전부 펼친 목록 — 지도 한 장이 검사 단위다 */
const MAPS: { id: string; stage: StageData; area: AreaData; v: AreaVariant }[] = STAGES.flatMap(
  (stage) =>
    stage.areas.flatMap((area) =>
      area.variants.map((v, i) => ({ id: `${stage.id}/${area.id}/v${i + 1}`, stage, area, v })),
    ),
)

const AREAS = STAGES.flatMap((stage) => stage.areas.map((area) => ({ stage, area })))

const isFloor = (v: AreaVariant, p: Pos) =>
  p.y >= 0 &&
  p.y < MAP_SIZE.height &&
  p.x >= 0 &&
  p.x < MAP_SIZE.width &&
  v.tiles[p.y][p.x] === 0

const manhattan = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/** 조우 칸은 이기면 지나갈 수 있으므로 통행 가능으로 본다 */
function reachable(v: AreaVariant, from: Pos, to: Pos): boolean {
  const seen = new Set<string>()
  const queue: Pos[] = [from]
  while (queue.length > 0) {
    const p = queue.shift()!
    const key = `${p.x},${p.y}`
    if (seen.has(key)) continue
    seen.add(key)
    if (p.x === to.x && p.y === to.y) return true
    for (const d of [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: -1, y: 0 },
    ]) {
      const n = { x: p.x + d.x, y: p.y + d.y }
      if (isFloor(v, n)) queue.push(n)
    }
  }
  return false
}

/** 구역이 선언한 짧은 id 전부 — 변형은 이 자리들을 빠짐없이 채워야 한다 */
const declaredIds = (area: AreaData) => [
  ...area.encounters.map((e) => e.id),
  ...(area.chests ?? []).map((c) => c.id),
  ...area.exits.map((e) => e.id),
  ...(area.boss ? [area.boss.id] : []),
]

describe('지도 한 장의 정합성', () => {
  it('모든 지도가 같은 크기다', () => {
    // 캔버스는 한 번만 만들어진다. 크기가 다르면 잘리거나 빈 배경이 남는다
    for (const m of MAPS) {
      expect(m.v.tiles.length, m.id).toBe(MAP_SIZE.height)
      for (const row of m.v.tiles) expect(row.length, m.id).toBe(MAP_SIZE.width)
    }
    for (const s of STAGES) expect(s.size, s.id).toEqual(MAP_SIZE)
  })

  it('타일 값은 바닥과 벽뿐이다', () => {
    // 저장 검증이 "0이 아니면 못 선다"로 판정하므로 다른 값이 들어오면 조용히 막힌다
    for (const m of MAPS) {
      for (const row of m.v.tiles) for (const c of row) expect([0, 1], m.id).toContain(c)
    }
  })

  it.each(MAPS)('$id — 선언한 자리가 전부 있고, 없는 자리는 없다', (m) => {
    const declared = declaredIds(m.area).sort()
    expect(Object.keys(m.v.places).sort()).toEqual(declared)
  })

  it.each(MAPS)('$id — 모든 자리가 바닥 위에 있다', (m) => {
    for (const [id, p] of Object.entries(m.v.places)) expect(isFloor(m.v, p), id).toBe(true)
    if (m.v.start) expect(isFloor(m.v, m.v.start), '시작').toBe(true)
    if (m.v.checkpoint) expect(isFloor(m.v, m.v.checkpoint), '쉼터').toBe(true)
  })

  it.each(MAPS)('$id — 쉼터와 보스가 최소 2칸 떨어져 있다', (m) => {
    // 1칸이면 쉼터 도착과 조우가 같은 이동에서 일어나 보스 전 대사가 통째로 유실된다
    if (!m.v.checkpoint || !m.area.boss) return
    expect(manhattan(m.v.checkpoint, m.v.places[m.area.boss.id])).toBeGreaterThanOrEqual(2)
  })

  it.each(MAPS)('$id — 문이 조우와 붙어 있지 않다', (m) => {
    // 문 옆에서 전투가 나면 이긴 뒤 문 위에 선 채로 전이가 일어나지 않는다
    for (const exit of m.area.exits) {
      for (const e of m.area.encounters) {
        expect(
          manhattan(m.v.places[exit.id], m.v.places[e.id]),
          `${exit.id} vs ${e.id}`,
        ).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it.each(MAPS)('$id — 서는 자리 어디에서든 모든 곳에 갈 수 있다', (m) => {
    const area = resolveArea(m.stage, m.area.id, m.area.variants.indexOf(m.v))
    const froms = [
      ...(m.v.start ? [m.v.start] : []),
      ...m.area.exits.map((e) => area.entryAt(e.id)),
    ]
    const targets = [...Object.values(m.v.places), ...(m.v.checkpoint ? [m.v.checkpoint] : [])]
    for (const from of froms) {
      for (const t of targets) {
        expect(reachable(m.v, from, t), `(${from.x},${from.y}) → (${t.x},${t.y})`).toBe(true)
      }
    }
  })
})

describe('구역과 변형', () => {
  it('변형 수가 스테이지가 정한 만큼이다', () => {
    for (const { stage, area } of AREAS) {
      expect(stage.variantCount, stage.id).toBeGreaterThanOrEqual(1)
      expect(area.variants.length, `${stage.id}/${area.id}`).toBe(stage.variantCount)
    }
  })

  it('한 구역의 변형들은 좌표만 다르다', () => {
    // 조우 구성·보상·어둠은 구역이 갖는다. 그래서 지도를 새로 그려도 난이도가 흔들릴 수 없다.
    // 남는 것은 "자리 이름표가 같은가"뿐이다
    for (const { stage, area } of AREAS) {
      const keys = new Set(area.variants.map((v) => Object.keys(v.places).sort().join(',')))
      expect(keys.size, `${stage.id}/${area.id}`).toBe(1)
      const cp = new Set(area.variants.map((v) => (v.checkpoint ? 'yes' : 'no')))
      expect(cp.size, `${stage.id}/${area.id} 쉼터`).toBe(1)
      const st = new Set(area.variants.map((v) => (v.start ? 'yes' : 'no')))
      expect(st.size, `${stage.id}/${area.id} 시작`).toBe(1)
    }
  })

  it('쉼터와 보스는 스테이지마다 하나뿐이고 같은 구역에 있다', () => {
    for (const stage of STAGES) {
      const withCheckpoint = stage.areas.filter((a) => a.variants.some((v) => v.checkpoint))
      const withBoss = stage.areas.filter((a) => a.boss)
      expect(withCheckpoint.length, `${stage.id} 쉼터`).toBe(1)
      expect(withBoss.length, `${stage.id} 보스`).toBe(1)
      expect(withCheckpoint[0].id, stage.id).toBe(withBoss[0].id)
    }
  })

  it('시작 구역은 첫 구역 하나뿐이다', () => {
    for (const stage of STAGES) {
      const withStart = stage.areas.filter((a) => a.variants.some((v) => v.start))
      expect(withStart.map((a) => a.id), stage.id).toEqual([stage.areas[0].id])
    }
  })

  it('문이 서로를 가리킨다', () => {
    // 한쪽만 열린 문은 되돌아올 수 없는 길이 된다
    for (const stage of STAGES) {
      for (const area of stage.areas) {
        for (const exit of area.exits) {
          const [toArea, toExit] = exit.to.split(':')
          const dest = stage.areas.find((a) => a.id === toArea)
          expect(dest, `${stage.id}/${area.id}/${exit.id} → ${toArea}`).toBeDefined()
          const pair = dest!.exits.find((e) => e.id === toExit)
          expect(pair, `${stage.id}/${area.id}/${exit.id}의 짝`).toBeDefined()
          expect(pair!.to, `${stage.id}/${exit.to}`).toBe(`${area.id}:${exit.id}`)
        }
      }
    }
  })

  it('첫 구역에서 모든 구역과 보스에 갈 수 있다', () => {
    for (const stage of STAGES) {
      const seen = new Set([stage.areas[0].id])
      const queue = [stage.areas[0].id]
      while (queue.length > 0) {
        const id = queue.shift()!
        for (const exit of stage.areas.find((a) => a.id === id)?.exits ?? []) {
          const to = exit.to.split(':')[0]
          if (seen.has(to)) continue
          seen.add(to)
          queue.push(to)
        }
      }
      expect(seen.size, `${stage.id} — 외딴 구역이 있다`).toBe(stage.areas.length)
    }
  })

  it('울림 탑에는 보스로 가는 길이 둘이고, 한쪽에 보물이 있다', () => {
    // 갈림길이 실제로 갈림길인지 — 한 길만 이어지면 "고르기"가 성립하지 않는다
    const stage = STAGES.find((s) => s.id === 'stage3')!
    const bossArea = stage.areas.find((a) => a.boss)!.id
    const paths: string[][] = []
    const walk = (at: string, path: string[]) => {
      if (at === bossArea) {
        paths.push(path)
        return
      }
      for (const exit of stage.areas.find((a) => a.id === at)?.exits ?? []) {
        const to = exit.to.split(':')[0]
        if (path.includes(to)) continue
        walk(to, [...path, to])
      }
    }
    walk(stage.areas[0].id, [stage.areas[0].id])
    expect(paths.length).toBeGreaterThanOrEqual(2)
    const withChest = paths.filter((p) =>
      p.some((id) => (stage.areas.find((a) => a.id === id)?.chests ?? []).length > 0),
    )
    expect(withChest.length, '보물을 지나는 길이 없다').toBeGreaterThanOrEqual(1)
    const lengths = new Set(paths.map((p) => p.length))
    expect(lengths.size, '길이가 같으면 지름길이 아니다').toBeGreaterThan(1)
  })
})

describe('스테이지 데이터 정합성', () => {
  it.each(AREAS)('$stage.id/$area.id — 참조하는 몹이 전부 존재한다', ({ area }) => {
    const ids = [...area.encounters, ...(area.boss ? [area.boss] : [])].flatMap((e) => e.monsters)
    for (const id of ids) expect(monsters, id).toHaveProperty(id)
  })

  it('조우·상자 id가 스테이지 안에서 유일하다', () => {
    // 저장은 평평한 문자열 배열이라, 겹치면 다른 구역 것이 함께 죽거나 열린다
    for (const stage of STAGES) {
      const ids = stage.areas.flatMap((a) => declaredIds(a).map((id) => scopedId(a.id, id)))
      expect(new Set(ids).size, stage.id).toBe(ids.length)
    }
  })

  it.each(AREAS)('$stage.id/$area.id — 대사 키가 전부 실재한다', ({ stage, area }) => {
    for (const e of area.encounters) {
      if (e.dialogue) expect(stage.script, `${e.id} → ${e.dialogue}`).toHaveProperty(e.dialogue)
    }
  })

  it('스테이지마다 관례적 대사가 있다', () => {
    for (const s of STAGES) {
      for (const key of ['intro', 'beforeBoss', 'clear']) {
        expect(s.script, `${s.id}/${key}`).toHaveProperty(key)
      }
    }
  })

  it('스테이지 id가 겹치지 않는다', () => {
    const ids = STAGES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('구역 어둠이 어떤 특성의 반경보다도 넓다', () => {
    // 어둠이 특성 반경보다 좁으면 그 특성의 대가만 사라지고 이득은 남는다.
    // "이득과 대가는 한 묶음"이 데이터 하나로 무너지는 지점이다
    const traitRadii = Object.values(TRAITS.traits)
      .map((t) => t.perception.radius)
      .filter((r): r is number => r !== null)
    for (const { stage, area } of AREAS) {
      const d = area.darkness?.radius
      if (d === undefined) continue
      for (const r of traitRadii) {
        expect(d, `${stage.id}/${area.id} vs 특성 반경 ${r}`).toBeGreaterThan(r)
      }
    }
  })
})
