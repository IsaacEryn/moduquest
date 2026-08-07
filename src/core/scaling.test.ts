import { describe, expect, it } from 'vitest'
import { scaleMonsters } from './scaling'
import type { MonsterData, ProgressionData } from './types'
import monsters from '../data/monsters.json'
import progression from '../data/progression.json'

const MONSTERS = monsters as unknown as Record<string, MonsterData>
const CFG = (progression as unknown as ProgressionData).multiScaling

describe('멀티 몹 배율', () => {
  it('혼자면 아무것도 바뀌지 않는다 — 같은 객체를 그대로 돌려준다', () => {
    // 솔로가 이 기능 때문에 조금이라도 달라지면 안 된다
    expect(scaleMonsters(MONSTERS, 1, CFG)).toBe(MONSTERS)
    expect(scaleMonsters(MONSTERS, 0, CFG)).toBe(MONSTERS)
  })

  it('사람이 하나 늘 때마다 덧셈으로 쌓인다 — 몇 배씩 뛰지 않는다', () => {
    const two = scaleMonsters(MONSTERS, 2, CFG).slime
    const three = scaleMonsters(MONSTERS, 3, CFG).slime
    const base = MONSTERS.slime
    expect(two.hp).toBe(Math.floor(base.hp * (1 + CFG.hpPerExtraHuman)))
    expect(three.hp).toBe(Math.floor(base.hp * (1 + 2 * CFG.hpPerExtraHuman)))
    // 셋일 때가 둘일 때의 두 배가 되지는 않는다
    expect(three.hp).toBeLessThan(two.hp * 2)
  })

  it('체력 위주로 오른다 — 한 방이 갑자기 치명적이 되지 않게', () => {
    const two = scaleMonsters(MONSTERS, 2, CFG).goblin
    const base = MONSTERS.goblin
    const hpGain = two.hp / base.hp
    const atkGain = two.patk / base.patk
    expect(hpGain).toBeGreaterThan(atkGain)
  })

  it('속도·저항·패턴은 건드리지 않는다', () => {
    // 속도를 만지면 턴 순서가 바뀌어 "매 라운드 같은 순서"가 깨지고,
    // 저항과 패턴은 배우는 대상이라 인원에 따라 달라지면 외운 것이 틀린 것이 된다
    const scaled = scaleMonsters(MONSTERS, 3, CFG)
    for (const [id, m] of Object.entries(MONSTERS)) {
      expect(scaled[id].spd, `${id} 속도`).toBe(m.spd)
      expect(scaled[id].resist, `${id} 저항`).toEqual(m.resist)
      expect(scaled[id].pattern, `${id} 패턴`).toEqual(m.pattern)
      expect(scaled[id].drops, `${id} 드랍`).toEqual(m.drops)
      expect(scaled[id].xp, `${id} 경험치`).toBe(m.xp)
    }
  })

  it('원본을 고치지 않는다 — 사본만 돌려준다', () => {
    const beforeHp = MONSTERS.slime.hp
    scaleMonsters(MONSTERS, 3, CFG)
    expect(MONSTERS.slime.hp).toBe(beforeHp)
  })

  it('보상이 늘어나는 것보다는 완만하게 오른다', () => {
    // 셋이 걸으면 전리품·동전이 세 벌 나온다(addItemToAll·gainGold).
    // 몹이 그만큼 세지면 함께 하는 이유가 없어지므로, 체력은 그보다 덜 오른다 —
    // 여럿이 유리하되 시시하지는 않은 자리가 그 사이에 있다
    const three = scaleMonsters(MONSTERS, 3, CFG).bell_keeper
    const ratio = three.hp / MONSTERS.bell_keeper.hp
    expect(ratio).toBeGreaterThan(1)
    expect(ratio).toBeLessThan(3)
  })
})
