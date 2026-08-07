import type { EventBus } from './events'
import type { Combatant, DamageType, MonsterData, PlayerAction, SkillData } from './types'

export type StepResult = 'waiting-player' | 'continue' | 'victory' | 'defeat'

/**
 * 턴제 전투. 모든 규칙은 결정적 — 무작위 요소가 없다.
 * 아군 Combatant는 스테이지 전역에서 유지되는 객체를 그대로 참조하므로
 * 전투 결과(HP·쿨다운)가 필드로 이어진다.
 */
export class Battle {
  order: Combatant[]
  private turnIndex = 0
  private tauntRounds = 0
  private tauntTarget: Combatant | null = null
  readonly enemies: Combatant[]
  readonly isBossBattle: boolean

  constructor(
    private allies: Combatant[],
    enemyIds: string[],
    monsters: Record<string, MonsterData>,
    private bus: EventBus,
    /** 승리했을 때 돌아오는 최대 체력의 비율 — 수치는 데이터가 쥔다 */
    private victoryHealRatio = 0.3,
  ) {
    this.enemies = enemyIds.map((id, i) => {
      const m = monsters[id]
      return {
        id: `${id}-${i}`,
        name: m.name,
        side: 'enemy' as const,
        isPlayer: false,
        hp: m.hp,
        maxHp: m.hp,
        mainType: m.attackType ?? 'physical',
        patk: m.patk,
        matk: m.matk,
        pdef: m.pdef,
        mdef: m.mdef,
        spd: m.spd,
        resist: m.resist,
        pattern: m.pattern,
        turnsTaken: 0,
        mp: 0,
        maxMp: 0,
        mpRegen: 0,
        skills: [],
        cooldowns: [],
        defending: false,
        sprite: m.sprite,
        ai: m.ai,
        isBoss: m.isBoss,
      }
    })
    // 같은 몹이 여럿이면 "슬라임 1, 슬라임 2"로 구분 — 대상 선택과 낭독 모두를 위해
    const nameCount = new Map<string, number>()
    for (const e of this.enemies) nameCount.set(e.name, (nameCount.get(e.name) ?? 0) + 1)
    const nameIndex = new Map<string, number>()
    for (const e of this.enemies) {
      if ((nameCount.get(e.name) ?? 0) > 1) {
        const n = (nameIndex.get(e.name) ?? 0) + 1
        nameIndex.set(e.name, n)
        e.name = `${e.name} ${n}`
      }
    }
    this.isBossBattle = enemyIds.some((id) => monsters[id].isBoss)

    // 속도 내림차순, 동률이면 아군 우선 — 매 라운드 같은 순서
    this.order = [...this.allies, ...this.enemies].sort((a, b) => {
      if (a.spd !== b.spd) return b.spd - a.spd
      if (a.side !== b.side) return a.side === 'ally' ? -1 : 1
      return 0
    })

    for (const a of this.allies) {
      a.cooldowns = a.skills.map(() => 0)
      a.defending = false
      a.hitsSinceDeflect = 0
      // 마력은 전투 자원이다 — 매 전투를 가득 채우고 시작한다
      a.mp = a.maxMp
    }
  }

  /** 전투 시작 알림. UI가 화면을 준비한 뒤에 호출해야 안내가 유실되지 않는다. */
  begin(): void {
    this.bus.emit({ type: 'battleStart', enemies: this.enemies, order: this.order })
  }

  get currentActor(): Combatant {
    return this.order[this.turnIndex]
  }

  /**
   * 전투의 지금을 결정적 문자열 하나로. 함께 하기의 어긋남 감지가 쓴다 —
   * 저장 스냅샷에는 전투가 담기지 않아서, 이것이 없으면 두 화면이 완전히 다른
   * 전투를 하고 있어도 "같은 세계"라는 답이 나온다.
   */
  fingerprint(): string {
    const one = (c: Combatant) =>
      [
        c.id,
        `${c.hp}/${c.maxHp}`,
        `${c.mp}`,
        c.cooldowns.join('.'),
        c.defending ? 'D' : '-',
        `${c.hitsSinceDeflect ?? 0}`,
      ].join(':')
    return [
      `turn${this.turnIndex}`,
      `taunt${this.tauntRounds}:${this.tauntTarget?.id ?? '-'}`,
      ...this.order.map(one),
    ].join('|')
  }

  private aliveAllies(): Combatant[] {
    return this.allies.filter((c) => c.hp > 0)
  }

  private aliveEnemies(): Combatant[] {
    return this.enemies.filter((c) => c.hp > 0)
  }

  /**
   * 턴 하나를 진행한다. 플레이어 차례면 'waiting-player'를 반환하고
   * playerAction() 호출을 기다린다.
   */
  step(): StepResult {
    const actor = this.currentActor
    if (actor.hp <= 0) return this.advance()

    actor.defending = false
    this.bus.emit({ type: 'turnStart', actor })

    if (actor.isPlayer) {
      this.bus.emit({ type: 'playerTurn', actor })
      return 'waiting-player'
    }

    if (actor.side === 'ally') this.npcAct(actor)
    else this.enemyAct(actor)
    return this.afterAction()
  }

  /**
   * 플레이어 행동. 규칙 검증은 UI가 아니라 여기가 최종 책임진다 —
   * 내 차례가 아니거나 쿨다운 중이면 null을 반환하고 아무 일도 일어나지 않는다.
   */
  playerAction(action: PlayerAction, seat = 0): StepResult | null {
    const actor = this.currentActor
    if (!actor.isPlayer || actor.hp <= 0) return null
    // 함께 하기 — 자기 자리의 차례에만 행동한다. 남의 자리 입력은 조용히 거절되므로
    // 원격에서 온 부정·중복 액션도 모든 화면에서 같은 결론(무시)에 도달한다
    if (actor.seat !== undefined && actor.seat !== seat) return null
    if (action.kind === 'attack') {
      const target = this.findAlive(this.opponentsOf(actor), action.targetId)
      if (!target) return null
      this.attack(actor, target)
    } else if (action.kind === 'skill') {
      if (!this.useSkill(actor, action.skillIndex, action.targetId)) return null
    } else if (action.kind === 'defend') {
      actor.defending = true
      this.bus.emit({ type: 'defended', actor })
    } else {
      return null
    }
    return this.afterAction()
  }

  /**
   * 플레이어의 아이템 사용. 아이템이 무엇인지는 코어 밖(Game)이 알고,
   * 여기는 턴 규칙(내 차례인가, 대상이 살아 있는가)만 책임진다.
   * 세 효과가 전부 무의미하면(체력·마력 가득, 줄일 대기 없음) null —
   * 실수 조작이 턴과 아이템의 손해가 되지 않게 한다.
   */
  playerUseItem(
    targetId: string,
    effect: { heal?: number; mana?: number; cooldownCut?: number },
    itemName: string,
    seat = 0,
  ): StepResult | null {
    const actor = this.currentActor
    if (!actor.isPlayer || actor.hp <= 0) return null
    if (actor.seat !== undefined && actor.seat !== seat) return null
    const target = this.findAlive(this.allies, targetId)
    if (!target) return null

    const healed = Math.min(effect.heal ?? 0, target.maxHp - target.hp)
    const mana = Math.min(effect.mana ?? 0, target.maxMp - target.mp)
    const wantCut = effect.cooldownCut ?? 0
    const canCut = wantCut > 0 && target.cooldowns.some((c) => c > 0)
    if (healed <= 0 && mana <= 0 && !canCut) return null

    target.hp += healed
    target.mp += mana
    if (canCut) {
      target.cooldowns = target.cooldowns.map((c) => Math.max(0, c - wantCut))
    }
    this.bus.emit({
      type: 'itemUsed',
      name: itemName,
      target,
      healed,
      mana,
      cooldownCut: canCut ? wantCut : 0,
    })
    return this.afterAction()
  }

  /**
   * 스킬 실행 — 동작은 skill.kind와 targeting이 결정하므로 새 스킬은 데이터로만 추가한다.
   * 전체 대상(-all)은 대상별로 개별 계산해 결정성을 지킨다.
   * 규칙상 불가(쿨다운, 대상 없음)면 false를 반환하고 아무 일도 일어나지 않는다.
   */
  private useSkill(actor: Combatant, skillIndex: number, targetId?: string): boolean {
    const skill = actor.skills[skillIndex]
    if (!skill) return false
    if ((actor.cooldowns[skillIndex] ?? 0) > 0) return false
    if ((skill.mpCost ?? 0) > actor.mp) return false

    switch (skill.kind) {
      case 'damage': {
        if (skill.targeting === 'enemy-all') {
          const pool = this.opponentsOf(actor).filter((c) => c.hp > 0)
          if (pool.length === 0) return false
          for (const target of pool) {
            this.attack(
              actor,
              target,
              skill.multiplier ?? 1,
              skill.pierce ?? 0,
              skill.name,
              skill.damageType,
            )
          }
        } else {
          const target = this.findAlive(this.opponentsOf(actor), targetId)
          if (!target) return false
          this.attack(
            actor,
            target,
            skill.multiplier ?? 1,
            skill.pierce ?? 0,
            skill.name,
            skill.damageType,
          )
        }
        break
      }
      case 'heal': {
        const pool = this.sideOf(actor).filter((c) => c.hp > 0)
        if (skill.targeting === 'ally-all') {
          for (const target of pool) this.healTarget(actor, target, skill)
        } else {
          // 대상 미지정이면 체력 비율이 가장 낮은 아군
          const target = targetId
            ? this.findAlive(pool, targetId)
            : [...pool].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]
          if (!target) return false
          this.healTarget(actor, target, skill)
        }
        break
      }
      case 'taunt': {
        this.tauntRounds = skill.duration ?? 2
        this.tauntTarget = actor
        this.bus.emit({ type: 'taunted', actor, duration: this.tauntRounds })
        break
      }
    }
    actor.cooldowns[skillIndex] = Math.max(0, skill.cooldown + (actor.cooldownDelta ?? 0))
    actor.mp = Math.max(0, actor.mp - (skill.mpCost ?? 0))
    this.bus.emit({ type: 'manaSpent', actor, cost: skill.mpCost ?? 0, left: actor.mp })
    return true
  }

  /** 지금 이 스킬을 쓸 수 있는지 — 쿨다운과 마력을 한 곳에서 판정한다 */
  static canUse(c: Combatant, index: number): boolean {
    const skill = c.skills[index]
    if (!skill) return false
    return (c.cooldowns[index] ?? 0) === 0 && (skill.mpCost ?? 0) <= c.mp
  }

  private healTarget(actor: Combatant, target: Combatant, skill: SkillData): void {
    const amount = Math.min(
      Math.floor(target.maxHp * (skill.healRatio ?? 0)),
      target.maxHp - target.hp,
    )
    target.hp += amount
    this.bus.emit({ type: 'healed', actor, target, amount })
  }

  private sideOf(c: Combatant): Combatant[] {
    return c.side === 'ally' ? this.allies : this.enemies
  }

  private opponentsOf(c: Combatant): Combatant[] {
    return c.side === 'ally' ? this.enemies : this.allies
  }

  private findAlive(pool: Combatant[], id?: string): Combatant | undefined {
    const c = pool.find((x) => x.id === id)
    return c && c.hp > 0 ? c : undefined
  }

  /**
   * 동료 NPC 규칙. 판단은 전부 결정적이라 같은 상황에서는 늘 같은 선택을 한다.
   *
   * - 치유는 상황을 구분한다: 한 명이 위중하면 그 한 명에게 크게,
   *   여럿이 다쳤으면 전체 치유로. 둘 다 아니면 아껴 둔다
   * - 전체 공격은 적이 둘 이상일 때만 — 하나 남은 적에게 쓰면 손해다
   * - 공격 대상은 체력이 가장 낮은 적. 먼저 쓰러뜨려야 맞는 횟수가 준다
   *
   * 스킬이 여럿이면 배열 앞에서부터 — 우선순위도 데이터다.
   */
  private npcAct(actor: Combatant): void {
    const allies = this.sideOf(actor).filter((c) => c.hp > 0)
    const enemies = this.opponentsOf(actor).filter((c) => c.hp > 0)
    const focus = this.weakest(enemies)
    const hurt = allies.filter((a) => a.hp / a.maxHp < 0.6).length
    const wounded = allies.filter((a) => a.hp / a.maxHp < 0.7).length

    for (let i = 0; i < actor.skills.length; i++) {
      if (!Battle.canUse(actor, i)) continue
      const skill = actor.skills[i]
      let shouldUse: boolean
      let targetId: string | undefined
      switch (skill.kind) {
        case 'heal':
          // 여럿이 상하면 전체로, 한 명이 크게 상하면 그 한 명에게.
          // 단일 치유는 대상을 비우면 전투가 비율이 가장 낮은 아군을 고른다
          shouldUse = skill.targeting === 'ally-all' ? wounded >= 2 : hurt >= 1
          break
        case 'taunt':
          // 동료가 상했을 때, 그리고 보스전에서는 먼저 나선다 — 강한 적이 약한 동료를
          // 노리는 규칙이므로 탱커가 미리 시선을 가져와야 의미가 있다
          shouldUse =
            this.tauntRounds === 0 &&
            (this.isBossBattle || allies.some((a) => a !== actor && a.hp / a.maxHp < 0.6))
          break
        case 'damage':
          shouldUse = skill.targeting !== 'enemy-all' || enemies.length >= 2
          if (skill.targeting === 'enemy') targetId = focus?.id
          break
      }
      if (shouldUse && this.useSkill(actor, i, targetId)) return
    }
    if (focus) this.attack(actor, focus)
  }

  /**
   * 지금 앞줄에 선 사람. 직업마다 정해진 줄이 있어서, 탱커가 파티에 있으면
   * 도발을 쓰지 않아도 하급 몹의 몫을 먼저 받는다. 앞줄이 쓰러지면 다음 사람이
   * 앞에 선다. 줄이 같으면 파티 순서 — 어느 쪽이든 결정적이어야 한다.
   */
  static frontOf(pool: Combatant[]): Combatant | undefined {
    let best: Combatant | undefined
    for (const c of pool) {
      if (!best || (c.frontOrder ?? Infinity) < (best.frontOrder ?? Infinity)) best = c
    }
    return best
  }

  /** 남은 체력이 가장 적은 쪽. 동률이면 앞선 순서 — 결정적이어야 한다 */
  private weakest(pool: Combatant[]): Combatant | undefined {
    let best: Combatant | undefined
    for (const c of pool) if (!best || c.hp < best.hp) best = c
    return best
  }

  /**
   * 몹의 표적 선택. 도발이 걸려 있으면 무엇이든 그쪽으로 — 도발이 규칙 위에 있어야
   * 탱커가 파티를 지킬 수 있다. 그 밖에는 몹의 등급(ai)이 정한다.
   */
  private enemyAct(actor: Combatant): void {
    if (this.tauntTarget && this.tauntTarget.hp > 0 && this.tauntRounds > 0) {
      this.attack(actor, this.tauntTarget)
      return
    }
    const alive = this.aliveAllies()
    let target: Combatant | undefined
    switch (actor.ai ?? 'front') {
      case 'weakest':
        // 비율로 본다 — 체력이 큰 전사보다 반쯤 닳은 마법사가 더 급하다
        target = this.pick(alive, (c) => c.hp / c.maxHp)
        break
      case 'breaker':
        // 자기가 때리는 쪽의 방어가 가장 얇은 사람 — 마법으로 치는 몹은 마법 방어를 본다.
        // "가장 아프게 들어가는 쪽"이라는 정의가 타입이 갈린 뒤에도 참이 되게 한다
        target = this.pick(alive, (c) => (actor.mainType === 'magic' ? c.mdef : c.pdef))
        break
      case 'front':
        target = Battle.frontOf(alive)
        break
    }
    if (target) this.attack(actor, target)
  }

  /** 점수가 가장 낮은 하나. 동률이면 앞선 순서 — 결정적이어야 한다 */
  private pick(pool: Combatant[], score: (c: Combatant) => number): Combatant | undefined {
    let best: Combatant | undefined
    let bestScore = Infinity
    for (const c of pool) {
      const s = score(c)
      if (s < bestScore) {
        best = c
        bestScore = s
      }
    }
    return best
  }

  /**
   * 피해 계산 순서: 흘림 판정 → 기본 피해(관통 반영) → 상성 배율 → 방어 시 절반 → 최소 1.
   * 흘림은 최소 1 규칙의 유일한 예외다.
   *
   * 물리와 마법은 서로 다른 방어에 막히고, 관통도 자기 쪽만 뚫는다 —
   * 급소 찌르기(관통 99)는 물리 방어를 전부 무시하지만 마법 방어에는 손대지 못한다.
   * 상성 배율은 방어를 뺀 뒤에 곱한다. "이 몹은 마법 피해를 1.3배로 받는다"가
   * 화면에 적힌 그대로 계산되어야 낭독과 실제가 어긋나지 않는다.
   */
  private attack(
    actor: Combatant,
    target: Combatant,
    multiplier = 1,
    extraPierce = 0,
    skillName?: string,
    damageType?: DamageType,
  ): void {
    if (this.tryDeflect(target)) {
      this.bus.emit({ type: 'deflected', actor, target })
      return
    }
    const type = damageType ?? actor.mainType
    const magic = type === 'magic'
    const atk = magic ? actor.matk : actor.patk
    const def = magic ? target.mdef : target.pdef
    const pierce = (actor.pierce ?? 0) + extraPierce
    const effectiveDef = Math.max(0, def - pierce)
    let damage = Math.max(1, Math.floor(atk * multiplier) - effectiveDef)
    const resist = target.resist ? target.resist[type] : 1
    if (resist !== 1) damage = Math.max(1, Math.floor(damage * resist))
    if (target.defending) damage = Math.max(1, Math.floor(damage / 2))
    target.hp = Math.max(0, target.hp - damage)
    this.bus.emit({ type: 'attacked', actor, target, damage, skillName, damageType: type })
    if (target.hp === 0) this.bus.emit({ type: 'downed', target })
  }

  /** N번째 피격이면 흘린다. 확률이 아니라 세는 규칙이라 미리 알 수 있다 */
  private tryDeflect(target: Combatant): boolean {
    const every = target.guardEvery ?? 0
    if (every <= 0) return false
    const hits = (target.hitsSinceDeflect ?? 0) + 1
    if (hits >= every) {
      target.hitsSinceDeflect = 0
      return true
    }
    target.hitsSinceDeflect = hits
    return false
  }

  /** 다음 피격을 흘리는지 — 상태 표시와 낭독용 */
  static willDeflect(c: Combatant): boolean {
    const every = c.guardEvery ?? 0
    return every > 0 && (c.hitsSinceDeflect ?? 0) + 1 >= every
  }

  private afterAction(): StepResult {
    if (this.aliveEnemies().length === 0) {
      // 승리: 파티 전원(쓰러진 동료 포함)이 정해진 비율만큼 회복한다
      const revived = this.allies.filter((a) => a.hp === 0)
      for (const a of this.allies) {
        a.hp = Math.min(a.maxHp, a.hp + Math.floor(a.maxHp * this.victoryHealRatio))
        a.defending = false
      }
      this.bus.emit({ type: 'victory', boss: this.isBossBattle, revived })
      return 'victory'
    }
    if (this.aliveAllies().length === 0) {
      this.bus.emit({ type: 'defeat' })
      return 'defeat'
    }
    return this.advance()
  }

  private advance(): StepResult {
    this.turnIndex += 1
    if (this.turnIndex >= this.order.length) {
      this.turnIndex = 0
      // 라운드 종료: 쿨다운 감소와 마력 회복. 회복량은 고정이라 몇 라운드 뒤에
      // 무엇을 쓸 수 있는지 미리 셀 수 있다
      for (const c of this.order) {
        c.cooldowns = c.cooldowns.map((v) => (v > 0 ? v - 1 : 0))
        if (c.maxMp > 0 && c.hp > 0) {
          c.mp = Math.min(c.maxMp, c.mp + c.mpRegen)
        }
      }
      if (this.tauntRounds > 0) {
        this.tauntRounds -= 1
        if (this.tauntRounds === 0) this.tauntTarget = null
      }
    }
    return 'continue'
  }

  /**
   * R 키: 전황 요약. 아군·적 같은 규칙으로 — 쓰러진 개체도 누락하지 않는다.
   * "나"는 화면마다 다르므로 보는 사람의 파티원 id를 받는다. 안 주면 솔로 규칙(isPlayer).
   */
  summary(viewerId?: string): string {
    // 누가 앞에 서 있는지는 다음 한 대가 어디로 갈지를 뜻한다 — 화면을 보지 않아도 알아야 한다
    const front = Battle.frontOf(this.aliveAllies())
    const mine = (c: Combatant) => (viewerId !== undefined ? c.id === viewerId : c.isPlayer)
    const side = (list: Combatant[]) =>
      list
        .map((c) => {
          const name = mine(c) ? '나' : c.name
          if (c.hp <= 0) return `${name} 쓰러짐`
          const deflect = Battle.willDeflect(c) ? ', 다음 피격 흘림' : ''
          const mana = c.maxMp > 0 ? `, 마력 ${c.mp}/${c.maxMp}` : ''
          const line = c.id === front?.id ? ' (앞줄)' : ''
          return `${name}${line} 체력 ${c.hp}/${c.maxHp}${mana}${deflect}`
        })
        .join(', ')
    return `아군: ${side(this.allies)}. 적: ${side(this.enemies)}.`
  }
}
