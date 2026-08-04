import type { Combatant, TraitData, TraitsFile } from './types'

/**
 * 특성 적용은 순수 함수다 — 같은 입력이면 같은 결과.
 * 능력치가 0 이하로 내려가지 않도록 데이터의 limits로 막는다.
 */
export function resolveTrait(traits: TraitsFile, id: string | null): TraitData {
  return traits.traits[id ?? ''] ?? traits.traits[traits.default]
}

/** 모르는 id는 조용히 기본값으로 — 저장값을 신뢰하지 않는다 */
export function resolveTraitId(traits: TraitsFile, id?: string | null): string {
  return id && traits.traits[id] ? id : traits.default
}

export interface TraitStats {
  hp: number
  atk: number
  def: number
  spd: number
}

/** 기본 능력치에 특성 보정을 더한다. 하한은 limits.minStat */
export function applyStats(
  base: TraitStats,
  trait: TraitData,
  limits: TraitsFile['limits'],
): TraitStats {
  const floor = (v: number) => Math.max(limits.minStat, v)
  return {
    hp: floor(base.hp + trait.stats.hp),
    atk: floor(base.atk + trait.stats.atk),
    def: floor(base.def + trait.stats.def),
    spd: floor(base.spd + trait.stats.spd),
  }
}

/** 특성의 전투 효과를 Combatant에 싣는다 */
export function applyCombat(c: Combatant, trait: TraitData): void {
  c.pierce = trait.combat.pierce
  c.guardEvery = trait.combat.guardEvery
  c.cooldownDelta = trait.combat.cooldownDelta
  c.hitsSinceDeflect = 0
}

/** 지각 반경. 데이터가 limits.minRadius보다 좁아도 그 아래로는 내려가지 않는다 */
export function perceptionRadius(
  trait: TraitData,
  limits: TraitsFile['limits'],
): number | null {
  const r = trait.perception.radius
  return r === null ? null : Math.max(limits.minRadius, r)
}
