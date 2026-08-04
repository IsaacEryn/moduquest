import type { EventBus } from './events'
import type { Combatant, MonsterData, PlayerAction } from './types'

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
        atk: m.atk,
        def: m.def,
        spd: m.spd,
        cooldownLeft: 0,
        defending: false,
        sprite: m.sprite,
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
      a.cooldownLeft = 0
      a.defending = false
      a.hitsSinceDeflect = 0
    }
  }

  /** 전투 시작 알림. UI가 화면을 준비한 뒤에 호출해야 안내가 유실되지 않는다. */
  begin(): void {
    this.bus.emit({ type: 'battleStart', enemies: this.enemies, order: this.order })
  }

  get currentActor(): Combatant {
    return this.order[this.turnIndex]
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
      this.bus.emit({ type: 'playerTurn' })
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
  playerAction(action: PlayerAction): StepResult | null {
    const actor = this.currentActor
    if (!actor.isPlayer || actor.hp <= 0) return null
    if (action.kind === 'attack') {
      const target = this.findAlive(this.opponentsOf(actor), action.targetId)
      if (!target) return null
      this.attack(actor, target)
    } else if (action.kind === 'skill') {
      if (!this.useSkill(actor, action.targetId)) return null
    } else if (action.kind === 'defend') {
      actor.defending = true
      this.bus.emit({ type: 'defended', actor })
    } else {
      return null
    }
    return this.afterAction()
  }

  /**
   * 스킬 실행 — 동작은 skill.kind가 결정하므로 새 스킬은 데이터로만 추가한다.
   * 규칙상 불가(쿨다운, 대상 없음)면 false를 반환하고 아무 일도 일어나지 않는다.
   */
  private useSkill(actor: Combatant, targetId?: string): boolean {
    const skill = actor.skill
    if (!skill || actor.cooldownLeft > 0) return false

    switch (skill.kind) {
      case 'damage': {
        const target = this.findAlive(this.opponentsOf(actor), targetId)
        if (!target) return false
        this.attack(actor, target, skill.multiplier ?? 1)
        break
      }
      case 'heal': {
        // 대상 미지정이면 체력 비율이 가장 낮은 아군
        const pool = this.sideOf(actor).filter((c) => c.hp > 0)
        const target = targetId
          ? this.findAlive(pool, targetId)
          : [...pool].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]
        if (!target) return false
        const amount = Math.min(
          Math.floor(target.maxHp * (skill.healRatio ?? 0)),
          target.maxHp - target.hp,
        )
        target.hp += amount
        this.bus.emit({ type: 'healed', actor, target, amount })
        break
      }
      case 'taunt': {
        this.tauntRounds = skill.duration ?? 2
        this.tauntTarget = actor
        this.bus.emit({ type: 'taunted', actor, duration: this.tauntRounds })
        break
      }
    }
    actor.cooldownLeft = Math.max(0, skill.cooldown + (actor.cooldownDelta ?? 0))
    return true
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

  /** 동료 NPC 규칙: 치유·도발은 필요할 때만, 그 외에는 공격 */
  private npcAct(actor: Combatant): void {
    const skill = actor.skill
    if (skill && actor.cooldownLeft === 0) {
      const allies = this.sideOf(actor).filter((c) => c.hp > 0)
      const shouldUse =
        (skill.kind === 'heal' && allies.some((a) => a.hp / a.maxHp < 0.5)) ||
        (skill.kind === 'taunt' &&
          allies.some((a) => a !== actor && a.hp / a.maxHp < 0.4))
      if (shouldUse && this.useSkill(actor)) return
    }
    const target = this.aliveEnemies()[0]
    if (target) this.attack(actor, target)
  }

  private enemyAct(actor: Combatant): void {
    // 도발 중이면 전사, 아니면 배치 순서상 첫 생존 아군
    const target =
      this.tauntTarget && this.tauntTarget.hp > 0 && this.tauntRounds > 0
        ? this.tauntTarget
        : this.aliveAllies()[0]
    if (target) this.attack(actor, target)
  }

  /**
   * 피해 계산 순서: 흘림 판정 → 기본 피해(관통 반영) → 방어 시 절반 → 최소 1.
   * 흘림은 최소 1 규칙의 유일한 예외다.
   */
  private attack(actor: Combatant, target: Combatant, multiplier = 1): void {
    if (this.tryDeflect(target)) {
      this.bus.emit({ type: 'deflected', actor, target })
      return
    }
    const effectiveDef = Math.max(0, target.def - (actor.pierce ?? 0))
    let damage = Math.max(1, Math.floor(actor.atk * multiplier) - effectiveDef)
    if (target.defending) damage = Math.max(1, Math.floor(damage / 2))
    target.hp = Math.max(0, target.hp - damage)
    this.bus.emit({ type: 'attacked', actor, target, damage })
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
      // 승리: 파티 전원(쓰러진 동료 포함) 최대 체력의 30% 회복
      const revived = this.allies.filter((a) => a.hp === 0)
      for (const a of this.allies) {
        a.hp = Math.min(a.maxHp, a.hp + Math.floor(a.maxHp * 0.3))
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
      // 라운드 종료: 쿨다운·도발 지속시간 감소
      for (const c of this.order) {
        if (c.cooldownLeft > 0) c.cooldownLeft -= 1
      }
      if (this.tauntRounds > 0) {
        this.tauntRounds -= 1
        if (this.tauntRounds === 0) this.tauntTarget = null
      }
    }
    return 'continue'
  }

  /** R 키: 전황 요약. 아군·적 같은 규칙으로 — 쓰러진 개체도 누락하지 않는다 */
  summary(): string {
    const side = (list: Combatant[]) =>
      list
        .map((c) => {
          const name = c.isPlayer ? '나' : c.name
          if (c.hp <= 0) return `${name} 쓰러짐`
          const deflect = Battle.willDeflect(c) ? ', 다음 피격 흘림' : ''
          return `${name} 체력 ${c.hp}/${c.maxHp}${deflect}`
        })
        .join(', ')
    return `아군: ${side(this.allies)}. 적: ${side(this.enemies)}.`
  }
}
