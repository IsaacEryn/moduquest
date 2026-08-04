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
    }
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

  playerAction(action: PlayerAction): StepResult {
    const actor = this.currentActor
    if (action.kind === 'attack') {
      const target = this.enemies.find((e) => e.id === action.targetId)
      if (target) this.attack(actor, target)
    } else if (action.kind === 'skill' && actor.skill) {
      // 도적 급습: 배수 공격
      const target = this.enemies.find((e) => e.id === action.targetId)
      if (target) {
        this.attack(actor, target, actor.skill.multiplier ?? 1)
        actor.cooldownLeft = actor.skill.cooldown
      }
    } else if (action.kind === 'defend') {
      actor.defending = true
      this.bus.emit({ type: 'defended', actor })
    }
    return this.afterAction()
  }

  private npcAct(actor: Combatant): void {
    const skill = actor.skill
    if (skill?.id === 'heal') {
      const hurt = this.aliveAllies()
        .filter((a) => a.hp / a.maxHp < 0.5)
        .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
      if (hurt.length > 0 && actor.cooldownLeft === 0) {
        const target = hurt[0]
        const amount = Math.min(
          Math.floor(target.maxHp * (skill.healRatio ?? 0)),
          target.maxHp - target.hp,
        )
        target.hp += amount
        actor.cooldownLeft = skill.cooldown
        this.bus.emit({ type: 'healed', actor, target, amount })
        return
      }
    }
    if (skill?.id === 'taunt') {
      const inDanger = this.aliveAllies().some(
        (a) => a !== actor && a.hp / a.maxHp < 0.4,
      )
      if (inDanger && actor.cooldownLeft === 0) {
        this.tauntRounds = skill.duration ?? 2
        this.tauntTarget = actor
        actor.cooldownLeft = skill.cooldown
        this.bus.emit({ type: 'taunted', actor, duration: this.tauntRounds })
        return
      }
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

  private attack(actor: Combatant, target: Combatant, multiplier = 1): void {
    let damage = Math.max(1, actor.atk * multiplier - target.def)
    if (target.defending) damage = Math.floor(damage / 2)
    target.hp = Math.max(0, target.hp - damage)
    this.bus.emit({ type: 'attacked', actor, target, damage })
    if (target.hp === 0) this.bus.emit({ type: 'downed', target })
  }

  private afterAction(): StepResult {
    if (this.aliveEnemies().length === 0) {
      // 승리: 파티 전원(쓰러진 동료 포함) 최대 체력의 30% 회복
      for (const a of this.allies) {
        a.hp = Math.min(a.maxHp, a.hp + Math.floor(a.maxHp * 0.3))
        a.defending = false
      }
      this.bus.emit({ type: 'victory', boss: this.isBossBattle })
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

  /** R 키: 전황 요약 */
  summary(): string {
    const side = (list: Combatant[]) =>
      list.map((c) => `${c.name} ${c.hp > 0 ? c.hp : '쓰러짐'}`).join(', ')
    return `아군: ${side(this.allies)}. 적: ${side(this.aliveEnemies())}.`
  }
}
