import { describe, expect, it } from 'vitest'
import { Battle, type StepResult } from './battle'
import { EventBus, type GameEvent } from './events'
import type { Combatant, MonsterData } from './types'

const MONSTERS: Record<string, MonsterData> = {
  slime: { name: '슬라임', sprite: 'slime', hp: 40, atk: 10, def: 4, spd: 5 },
  goblin: { name: '고블린', sprite: 'goblin', ai: 'weakest', hp: 60, atk: 12, def: 5, spd: 7 },
  golem: { name: '돌 골렘', sprite: 'golem', hp: 160, atk: 16, def: 9, spd: 4, isBoss: true },
  brute: { name: '망치잡이', sprite: 'golem', ai: 'breaker', hp: 90, atk: 14, def: 6, spd: 3 },
  boss_golem: {
    name: '큰 골렘', sprite: 'golem', ai: 'breaker',
    hp: 160, atk: 16, def: 9, spd: 4, isBoss: true,
  },
}

function ally(partial: Partial<Combatant> & { id: string }): Combatant {
  return {
    name: partial.id,
    side: 'ally',
    isPlayer: false,
    hp: 100,
    maxHp: 100,
    mp: 50,
    maxMp: 50,
    mpRegen: 5,
    atk: 10,
    def: 5,
    spd: 5,
    skills: [],
    cooldowns: [],
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
    skills: [{
      id: 'ambush',
      name: '급습',
      kind: 'damage',
      targeting: 'enemy',
      cooldown: 2,
      multiplier: 2,
      description: '',
    }],
    cooldowns: [0],
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
    skills: [{
      id: 'taunt',
      name: '도발',
      kind: 'taunt',
      targeting: 'self',
      cooldown: 3,
      duration: 2,
      description: '',
    }],
    cooldowns: [0],
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
    skills: [{
      id: 'heal',
      name: '치유',
      kind: 'heal',
      targeting: 'ally',
      cooldown: 2,
      healRatio: 0.4,
      description: '',
    }],
    cooldowns: [0],
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
    battle.playerAction({ kind: 'skill', skillIndex: 0, targetId: battle.enemies[0].id })
    expect(r.cooldowns[0]).toBe(2)
    advanceToPlayer(battle)
    const before = battle.enemies[0].hp
    expect(battle.playerAction({ kind: 'skill', skillIndex: 0, targetId: battle.enemies[0].id })).toBeNull()
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
    battle.playerAction({ kind: 'skill', skillIndex: 0, targetId: 'warrior' })
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
    battle.playerAction({ kind: 'skill', skillIndex: 0 })
    expect(events.some((e) => e.type === 'taunted')).toBe(true)
    expect(w.cooldowns[0]).toBe(3)
  })

  it('급습은 공격력 2배로 계산된다', () => {
    const { battle } = setup([rogue()], ['golem'])
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'skill', skillIndex: 0, targetId: battle.enemies[0].id })
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

  it('여럿이 다치면 전체 치유를, 한 명만 위중하면 단일 치유를 쓴다', () => {
    const bigHeal = {
      id: 'heal-all',
      name: '모두 치유',
      kind: 'heal' as const,
      targeting: 'ally-all' as const,
      cooldown: 3,
      healRatio: 0.25,
      description: '',
    }
    // 둘 다 70% 미만이지만 위중(50% 미만)은 아니다 → 전체 치유
    const r1 = rogue()
    r1.hp = 55 // 61%
    const h1 = healer()
    h1.hp = 50 // 62%
    h1.skills = [h1.skills[0], bigHeal]
    h1.cooldowns = [0, 0]
    const s1 = setup([r1, h1], ['golem'])
    advanceToPlayer(s1.battle)
    s1.battle.playerAction({ kind: 'defend' })
    advanceToPlayer(s1.battle)
    expect(s1.events.some((e) => e.type === 'healed' && e.target.id === 'healer')).toBe(true)

    // 한 명만 위중하고 나머지는 멀쩡 → 단일 치유가 그 한 명에게
    const r2 = rogue()
    r2.hp = 20 // 22%
    const h2 = healer()
    h2.skills = [h2.skills[0], bigHeal]
    h2.cooldowns = [0, 0]
    const s2 = setup([r2, h2], ['golem'])
    advanceToPlayer(s2.battle)
    s2.battle.playerAction({ kind: 'defend' })
    advanceToPlayer(s2.battle)
    const heals = s2.events.filter((e) => e.type === 'healed')
    expect(heals).toHaveLength(1)
    expect(heals[0]).toMatchObject({ target: { id: 'rogue' } })
  })

  it('중급 몹은 체력 비율이 낮은 아군을, 상급 몹은 방어가 얇은 아군을 노린다', () => {
    /** 플레이어가 한 번 방어하고 몹 턴까지 진행시킨 뒤, 몹이 누구를 쳤는지 */
    const enemyTargets = (allies: Combatant[], enemy: string) => {
      const s = setup(allies, [enemy])
      advanceToPlayer(s.battle)
      s.battle.playerAction({ kind: 'defend' })
      advanceToPlayer(s.battle)
      return s.events
        .filter((e) => e.type === 'attacked' && e.actor.side === 'enemy')
        .map((e) => (e as { target: Combatant }).target.id)
    }

    // 전사는 방어가 두껍고 체력이 가득, 도적은 절반이고 방어가 얇다
    const r1 = rogue()
    r1.hp = 45 // 50% — 도발이 걸리는 40% 선보다는 위
    expect(enemyTargets([warrior(), r1], 'goblin')).toEqual(['rogue'])

    // 체력은 둘 다 가득. 방어 6 < 10이라 도적이 표적 (보스가 아니라 도발이 안 걸린다)
    expect(enemyTargets([warrior(), rogue()], 'brute')).toEqual(['rogue'])

    // 도발은 어떤 등급이든 덮어쓴다 — 그래야 탱커가 파티를 지킬 수 있다.
    // 전사는 보스전이면 동료가 멀쩡해도 먼저 시선을 가져온다
    expect(enemyTargets([warrior(), rogue()], 'boss_golem')).toEqual(['warrior'])
  })

  it('동료는 체력이 가장 낮은 적부터 노린다', () => {
    const w = warrior()
    const { battle } = setup([rogue(), w], ['slime', 'slime'])
    const [a, b] = battle.enemies
    b.hp = 12 // 두 번째가 더 약하다
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'defend' })
    advanceToPlayer(battle)
    // 전사(14) − 슬라임 방어(4) = 10 → 두 번째 슬라임에게 갔다
    expect(b.hp).toBe(2)
    expect(a.hp).toBe(40)
  })
})

describe('마력', () => {
  it('스킬은 마력을 소모하고, 모자라면 쓸 수 없다', () => {
    const r = rogue()
    r.skills[0].mpCost = 20
    const { battle, events } = setup([r], ['golem'])
    r.mp = 25 // 전투가 시작될 때 가득 차므로 그 뒤에 상황을 만든다
    advanceToPlayer(battle)

    expect(Battle.canUse(r, 0)).toBe(true)
    battle.playerAction({ kind: 'skill', skillIndex: 0, targetId: battle.enemies[0].id })
    expect(r.mp).toBe(5)
    expect(events.some((e) => e.type === 'manaSpent' && e.cost === 20 && e.left === 5)).toBe(true)

    // 쿨다운이 풀려도 마력이 모자라면 거부한다
    r.cooldowns[0] = 0
    expect(Battle.canUse(r, 0)).toBe(false)
    advanceToPlayer(battle)
    const before = battle.enemies[0].hp
    expect(
      battle.playerAction({ kind: 'skill', skillIndex: 0, targetId: battle.enemies[0].id }),
    ).toBeNull()
    expect(battle.enemies[0].hp).toBe(before) // 아무 일도 없었다
  })

  it('라운드가 끝나면 정해진 양만큼 돌아온다 — 최대치를 넘지 않는다', () => {
    const r = rogue()
    r.maxMp = 30
    r.mpRegen = 5
    const { battle } = setup([r], ['slime'])
    r.mp = 10
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'defend' }) // 라운드 한 바퀴
    advanceToPlayer(battle)
    expect(r.mp).toBe(15)

    r.mp = 28
    battle.playerAction({ kind: 'defend' })
    advanceToPlayer(battle)
    expect(r.mp).toBe(30) // 33이 아니다
  })

  it('전투를 시작하면 마력이 가득 찬다', () => {
    const r = rogue()
    r.mp = 3
    setup([r], ['slime'])
    expect(r.mp).toBe(r.maxMp)
  })
})

describe('흘리기와 관통', () => {
  it('N번째 피격만 흘린다', () => {
    const r = rogue()
    r.guardEvery = 3
    // 골렘은 체력이 넉넉해 전투가 일찍 끝나지 않는다. 골렘 공격 (16-6)=10
    const { battle, events } = setup([r], ['golem'])
    const strike = () => {
      advanceToPlayer(battle)
      battle.playerAction({ kind: 'attack', targetId: battle.enemies[0].id })
      advanceToPlayer(battle)
    }
    strike() // 1번째 피격 — 맞는다
    expect(r.hp).toBe(90 - 10)
    strike() // 2번째 — 맞는다
    expect(r.hp).toBe(90 - 20)
    strike() // 3번째 — 흘린다
    expect(r.hp).toBe(90 - 20)
    expect(events.some((e) => e.type === 'deflected')).toBe(true)
  })

  it('흘린 뒤에는 다시 처음부터 센다', () => {
    const r = rogue()
    r.guardEvery = 2
    r.hitsSinceDeflect = 0
    const { battle } = setup([r], ['slime'])
    for (let i = 0; i < 4; i++) {
      advanceToPlayer(battle)
      battle.playerAction({ kind: 'defend' })
      advanceToPlayer(battle)
    }
    // 2·4번째를 흘리므로 방어 상태로 2대만 맞는다: floor(4/2)=2씩
    expect(r.hp).toBe(90 - 4)
  })

  it('다음 피격을 흘리는지 미리 알 수 있다', () => {
    const r = rogue()
    r.guardEvery = 2
    r.hitsSinceDeflect = 1
    expect(Battle.willDeflect(r)).toBe(true)
    r.hitsSinceDeflect = 0
    expect(Battle.willDeflect(r)).toBe(false)
    // 흘리기가 없는 캐릭터는 항상 false
    expect(Battle.willDeflect(rogue())).toBe(false)
  })

  it('관통은 상대 방어를 무시하고, 방어력 아래로 내려가도 최소 1은 준다', () => {
    const r = rogue()
    r.pierce = 4
    const { battle } = setup([r], ['golem']) // 골렘 방어 9
    advanceToPlayer(battle)
    battle.playerAction({ kind: 'attack', targetId: battle.enemies[0].id })
    expect(battle.enemies[0].hp).toBe(160 - (18 - (9 - 4)))
  })

  it('전투가 새로 시작되면 흘리기 카운터가 초기화된다', () => {
    const r = rogue()
    r.guardEvery = 2
    r.hitsSinceDeflect = 1
    setup([r], ['slime'])
    expect(r.hitsSinceDeflect).toBe(0)
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
