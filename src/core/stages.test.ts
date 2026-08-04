import { describe, expect, it } from 'vitest'
import type { Pos, StageData, TraitsFile } from './types'
import monsters from '../data/monsters.json'
import stage1 from '../data/stages/stage1.json'
import stage2 from '../data/stages/stage2.json'
import stage3 from '../data/stages/stage3.json'
import traitsFile from '../data/traits.json'

const STAGES = [stage1, stage2, stage3] as StageData[]
const TRAITS = traitsFile as TraitsFile

const isFloor = (s: StageData, p: Pos) =>
  p.y >= 0 && p.y < s.map.height && p.x >= 0 && p.x < s.map.width && s.map.tiles[p.y][p.x] === 0

const manhattan = (a: Pos, b: Pos) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

/** 조우 칸은 이기면 지나갈 수 있으므로 통행 가능으로 본다 */
function reachable(s: StageData, from: Pos, to: Pos): boolean {
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
      if (isFloor(s, n)) queue.push(n)
    }
  }
  return false
}

describe('스테이지 데이터 정합성', () => {
  it('모든 스테이지의 맵 크기가 같다', () => {
    // 캔버스 크기와 전투 화면 배치가 384×320 기준으로 한 번만 확정된다
    const sizes = new Set(STAGES.map((s) => `${s.map.width}x${s.map.height}`))
    expect(sizes.size).toBe(1)
  })

  it.each(STAGES)('$id — 타일 배열이 선언한 크기와 맞는다', (s) => {
    expect(s.map.tiles.length).toBe(s.map.height)
    for (const row of s.map.tiles) expect(row.length).toBe(s.map.width)
  })

  it.each(STAGES)('$id — 시작·쉼터·조우·보스가 모두 바닥 위에 있다', (s) => {
    expect(isFloor(s, s.map.start), '시작').toBe(true)
    expect(isFloor(s, s.checkpoint), '쉼터').toBe(true)
    for (const e of s.encounters) expect(isFloor(s, e.pos), e.id).toBe(true)
    expect(isFloor(s, s.boss.pos), '보스').toBe(true)
  })

  it.each(STAGES)('$id — 쉼터와 보스가 최소 2칸 떨어져 있다', (s) => {
    // 1칸이면 쉼터 도착과 조우가 같은 이동에서 일어나 보스 전 대사가 통째로 유실된다
    expect(manhattan(s.checkpoint, s.boss.pos)).toBeGreaterThanOrEqual(2)
  })

  it.each(STAGES)('$id — 시작점에서 쉼터와 보스까지 갈 수 있다', (s) => {
    expect(reachable(s, s.map.start, s.checkpoint), '쉼터').toBe(true)
    expect(reachable(s, s.map.start, s.boss.pos), '보스').toBe(true)
  })

  it.each(STAGES)('$id — 참조하는 몹이 전부 존재한다', (s) => {
    const ids = [...s.encounters, s.boss].flatMap((e) => e.monsters)
    for (const id of ids) expect(monsters, id).toHaveProperty(id)
  })

  it.each(STAGES)('$id — 조우 id가 겹치지 않는다', (s) => {
    const ids = [...s.encounters.map((e) => e.id), s.boss.id]
    expect(new Set(ids).size).toBe(ids.length)
  })

  it.each(STAGES)('$id — 대사 키가 전부 실재한다', (s) => {
    for (const key of ['intro', 'beforeBoss', 'clear']) {
      expect(s.script, key).toHaveProperty(key)
    }
    for (const e of s.encounters) {
      if (e.dialogue) expect(s.script, `${e.id} → ${e.dialogue}`).toHaveProperty(e.dialogue)
    }
  })

  it('스테이지 id가 겹치지 않는다', () => {
    const ids = STAGES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('스테이지 어둠이 어떤 특성의 반경보다도 넓다', () => {
    // 어둠이 특성 반경보다 좁으면 그 특성의 대가만 사라지고 이득은 남는다.
    // "이득과 대가는 한 묶음"이 데이터 하나로 무너지는 지점이다
    const traitRadii = Object.values(TRAITS.traits)
      .map((t) => t.perception.radius)
      .filter((r): r is number => r !== null)
    for (const s of STAGES) {
      const d = s.map.darkness?.radius
      if (d === undefined) continue
      for (const r of traitRadii) expect(d, `${s.id} vs 특성 반경 ${r}`).toBeGreaterThan(r)
    }
  })
})
