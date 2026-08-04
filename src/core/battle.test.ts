import { describe, expect, it } from 'vitest'
import { Battle, type StepResult } from './battle'
import { EventBus, type GameEvent } from './events'
import type { Combatant, MonsterData } from './types'

const MONSTERS: Record<string, MonsterData> = {
  slime: { name: '슬라임', sprite: 'slime', hp: 40, atk: 10, def: 4, spd: 5 },
  golem: { name: '돌 골렘', sprite: 'golem', hp: 160, atk: 16, def: 9, spd: 4, isBoss: true },
}

function ally(partial: Partial<Combatant> & { id: string }): Combatant {
  return {
    name: partial.id,
    side: 'ally',
    isPlayer: false,
    hp: 100,
    maxHp: 100,
    atk: 10,
    def: 5,
    spd: 5,
    cooldownLeft: 0,
    defending: false,
    ...partial,
  }
}

function rogue(): Combatant {
  return ally({
    id: 'rogue',
    name: '도적',
    isPlayer: true,
    hp: 90,
    maxHp: 90,
    atk: 18,
    def: 6,
    spd: 12,
    skill: {
      id: 'ambush',
      name: '급습',
      kind: 'damage',
      targeting: 'enemy',
      cooldown: 2,
      multiplier: 2,
      description: '',
    },
  })
}

function warrior(): Combatant {
  return ally({
    id: 'warrior',
    name: '전사',
    hp: 120,
    maxHp: 120,
    atk: 14,
    def: 10,
    spd: 6,
    skill: {
      id: 'taunt',
      name: '도발',
      kind: 'taunt',
      targeting: 'self',
      cooldown: 3,
      duration: 2,
      description: '',
    },
  })
}

function healer(): Combatant {
  return ally({
    id: 'healer',
    name: '힐러',
    hp: 80,
    maxHp: 80,
    atk: 8,
    def: 7,
    spd: 9,
    skill: {
      id: 'heal',
      name: '치유',
      kind: 'heal',
      targeting: 'ally',
      cooldown: 2,
      healRatio: 0.4,
      description: '',
    },
  })
}

function setup(allies: Combatant[], enemyIds: string[]) {
  const bus = new EventBus()
  const events: GameEvent[] = []
  bus.on((e) => events.push(e))
  const battle = new Battle(allies, enemyIds, MONSTERS, bus)
  return { battle, events }
}

/** 플레이어 차례가 오거나 전투가 끝날 때까지 진행 */
function advanceToPlayer(battle: Battle): StepResult {
  for (let i = 0; i < 100; i++) {
    const r = battle.step()
    if (r !== 'continue') return r
  }
  throw new Error('전투가 수렴하지 않음')
}

describe('턴 순서', () => {
  it('속도 내림차순, 동률이면 아군 우선', () => {
    const h = healer()
    h.spd = 5 // 슬라임과 동률
    const { battle } = setup([rogue(), warrior(), h], ['slime', 'slime'])
    expect(battle.order.map((c) => c.name)).toEqual([
      '도적',
      '전사',
      '힐러',
      '슬라임 1',
      '슬라임 2',
    ])
  })

  it('같은 몹이 여럿이면 번호로 구분한다', () => {
    const { battle } = setup([rogue()], ['slime', 'slime'])
    expect(battle.enemies.map((e) => e.name)).toEqual(['슬라임 1', '슬라임 2'])
  })
})

describe('플레이어 행동 검증', () => {
  it('데미지는 공격력-방어력, 최소 1', () => {
    const { battle } = setup([rogue()], ['slime'])
    expect(advanceToPlayer(battle)).toBe('waiting-player')
    battle.playerAction({ kind: 'attack', targetId: battle.enemies[0].id })
    expect(battle.enemies[0].hp).toBe(40 - (18 - 4))
  })

  it('내 차례가 아니면 행동이 거부된다', () => {
    const w = warrior()
    w.spd = 20 // 전사가 먼저
    const { battle } = setup([rogue(), w], ['slime'])
    // 아직 전사(NPC) 차례 — 플레이어 행동은 무시돼야 한다
    const before = battle.enemies[0].hp
    const result = battle.playerAction({ kind: 'attack', targetId: battle.enemies[0].id })
    expect(result).toBeNull()
    expect(battle.enemies[0].hp).toBe(before)
  })

  it('쿨다운 중인 스킬은 거부된다', () => {
    const r = rogue()
    const { battle } = setup([r], ['golem'])
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'skill', targetId: battle.enemies[0].id })
    expect(r.cooldownLeft).toBe(2)
    advanceToPlayer(battle)
    const before = battle.enemies[0].hp
    expect(battle.playerAction({ kind: 'skill', targetId: battle.enemies[0].id })).toBeNull()
    expect(battle.enemies[0].hp).toBe(before)
  })

  it('치유 스킬을 가진 플레이어도 아군을 대상으로 스킬을 쓸 수 있다', () => {
    // 직업 선택 확장 대비 — 스킬 동작이 데이터(kind·targeting)로 결정되는지
    const h = healer()
    h.isPlayer = true
    h.spd = 20
    const w = warrior()
    w.hp = 50
    const { battle } = setup([h, w], ['slime'])
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'skill', targetId: 'warrior' })
    expect(w.hp).toBe(50 + Math.floor(120 * 0.4))
  })

  it('자기 대상 스킬(도발)은 대상 없이 실행된다', () => {
    const w = warrior()
    w.isPlayer = true
    w.spd = 20
    const r = rogue()
    r.isPlayer = false
    r.hp = 30 // 도발 없이는 몹이 첫 아군(전사)을 치므로 무관 — 도발 자체의 발동 확인
    const { battle, events } = setup([w, r], ['slime'])
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'skill' })
    expect(events.some((e) => e.type === 'taunted')).toBe(true)
    expect(w.cooldownLeft).toBe(3)
  })

  it('급습은 공격력 2배로 계산된다', () => {
    const { battle } = setup([rogue()], ['golem'])
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'skill', targetId: battle.enemies[0].id })
    expect(battle.enemies[0].hp).toBe(160 - (18 * 2 - 9))
  })

  it('방어하면 받는 피해가 절반이 된다', () => {
    const r = rogue()
    const { battle } = setup([r], ['slime'])
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'defend' })
    advanceToPlayer(battle) // 슬라임 턴 진행
    // 슬라임 공격: (10-6)/2 = 2
    expect(r.hp).toBe(90 - 2)
  })

  it('플레이어 대기 중 step을 다시 불러도 턴이 넘어가지 않는다', () => {
    const { battle } = setup([rogue()], ['slime'])
    expect(advanceToPlayer(battle)).toBe('waiting-player')
    expect(battle.step()).toBe('waiting-player')
    expect(battle.currentActor.isPlayer).toBe(true)
  })
})

describe('NPC·몹 규칙', () => {
  it('몹은 도발이 없으면 배치 순서상 첫 아군을 공격한다', () => {
    const r = rogue()
    const w = warrior()
    const { battle } = setup([r, w], ['slime'])
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'defend' })
    advanceToPlayer(battle)
    // 슬라임은 도적(첫 아군)을 공격: 방어로 (10-6)/2=2
    expect(r.hp).toBe(88)
    expect(w.hp).toBe(120)
  })

  it('도발이 걸리면 몹의 공격이 전사에게 간다', () => {
    const r = rogue()
    r.hp = 30 // 40% 미만 → 전사가 도발
    const w = warrior()
    const { battle } = setup([r, w], ['slime'])
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'defend' })
    advanceToPlayer(battle)
    // 전사 도발 → 슬라임은 전사 공격 (10-10=0 → 최소 1)
    expect(w.hp).toBe(119)
    expect(r.hp).toBe(30)
  })

  it('힐러는 체력 50% 미만인 아군을 먼저 치유한다', () => {
    const r = rogue()
    r.hp = 30
    const h = healer()
    const { battle } = setup([r, h], ['golem'])
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'defend' })
    advanceToPlayer(battle)
    // 힐러 치유: 30 + floor(90*0.4)=36 → 66. 이후 골렘이 도적 공격(방어): floor((16-6)/2)=5
    expect(r.hp).toBe(30 + 36 - 5)
  })
})

describe('승패', () => {
  it('승리하면 쓰러진 동료를 포함해 전원 30% 회복한다', () => {
    const r = rogue()
    const w = warrior()
    w.hp = 0
    const { battle, events } = setup([r, w], ['slime'])
    battle.enemies[0].hp = 1
    advanceToPlayer(battle)
    const result = battle.playerAction({ kind: 'attack', targetId: battle.enemies[0].id })
    expect(result).toBe('victory')
    expect(w.hp).toBe(36) // 120의 30% — 부활
    expect(r.hp).toBe(90) // 최대치 초과 없음
    expect(events.some((e) => e.type === 'victory')).toBe(true)
  })

  it('보스가 포함된 전투는 보스전으로 표시된다', () => {
    const { battle } = setup([rogue()], ['golem'])
    expect(battle.isBossBattle).toBe(true)
  })

  it('아군이 전멸하면 패배한다', () => {
    const r = rogue()
    r.hp = 1
    const { battle, events } = setup([r], ['slime'])
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'defend' })
    // 방어해도 (10-6)/2=2 피해 → 체력 1 → 0
    expect(advanceToPlayer(battle)).toBe('defeat')
    expect(events.some((e) => e.type === 'defeat')).toBe(true)
  })
})
