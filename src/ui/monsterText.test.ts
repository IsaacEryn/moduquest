import { describe, expect, it } from 'vitest'
import { monsterResistLine, resistBadge, resistLine } from './monsterText'
import { resistTagOf } from '../core/resist'
import monsters from '../data/monsters.json'
import type { MonsterData } from '../core/types'

const MONSTERS = monsters as unknown as Record<string, MonsterData>

describe('약점 문구', () => {
  it('치우침이 없으면 아무 말도 하지 않는다', () => {
    expect(resistLine(undefined)).toBeNull()
    expect(resistLine({ physical: 1, magic: 1 })).toBeNull()
    expect(resistBadge(undefined)).toBeNull()
    expect(resistBadge({ physical: 1, magic: 1 })).toBeNull()
  })

  it('꼬리표는 잘라 만들지 않는다 — 어디서도 끝나지 않는 말이 되지 않게', () => {
    expect(resistBadge({ physical: 0.7, magic: 1.3 })).toBe('물리 강함 · 마법 약함')
    expect(resistBadge({ physical: 1.3, magic: 0.6 })).toBe('물리 약함 · 마법 강함')
    expect(resistBadge({ physical: 0.8, magic: 1 })).toBe('물리 강함')
  })

  it('강한 쪽을 먼저 말한다 — 그래야 반대로 가자는 판단이 이어진다', () => {
    expect(resistLine({ physical: 0.7, magic: 1.3 })).toBe('물리에 강하고 마법에 약하다')
    expect(resistLine({ physical: 1.3, magic: 0.6 })).toBe('마법에 강하고 물리에 약하다')
  })

  it('한쪽만 치우쳐도 말한다', () => {
    expect(resistLine({ physical: 0.8, magic: 1 })).toBe('물리에 강하다')
    expect(resistLine({ physical: 1, magic: 1.5 })).toBe('마법에 약하다')
  })

  it('판정은 코어와 같은 함수를 쓴다 — 말과 소리가 갈라지지 않게', () => {
    const resist = { physical: 0.7, magic: 1.3 }
    expect(resistTagOf(resist, 'physical')).toBe('strong')
    expect(resistTagOf(resist, 'magic')).toBe('weak')
    expect(resistTagOf(undefined, 'magic')).toBeNull()
  })

  it('데이터의 몹마다 문장이 배율과 맞는다', () => {
    // 손으로 적은 문장이 아니라 조립한 문장이어야 배율을 고쳤을 때 따라온다
    for (const [id, m] of Object.entries(MONSTERS)) {
      const line = monsterResistLine(m.name, m.resist)
      if (!m.resist) {
        expect(line, id).toBeNull()
        continue
      }
      expect(line, id).toContain(m.name)
      if (m.resist.physical < 1) expect(line, id).toContain('물리에 강하')
      if (m.resist.magic > 1) expect(line, id).toContain('마법에 약하')
      if (m.resist.magic < 1) expect(line, id).toContain('마법에 강하')
      if (m.resist.physical > 1) expect(line, id).toContain('물리에 약하')
    }
  })

  it('배우는 순서대로 배치돼 있다 — 숲의 잡몹은 치우침이 없다', () => {
    // 전투 자체를 익히는 구간에서 상성까지 요구하지 않는다.
    // 첫 상성은 돌덩이 보스에서 만나는 것이 이 게임의 학습 곡선이다
    expect(MONSTERS.slime.resist).toBeUndefined()
    expect(MONSTERS.goblin.resist).toBeUndefined()
    expect(MONSTERS.boss_golem.resist).toBeDefined()
  })
})
