import type { Combatant, DamageType, TraitData, TraitsFile } from './types'

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
  patk: number
  matk: number
  pdef: number
  mdef: number
  spd: number
}

/**
 * 기본 능력치에 특성 보정을 더한다. 하한은 limits.minStat.
 *
 * 특성 데이터에는 여전히 `atk`·`def` 한 쌍만 있다. 특성은 플레이 스타일이지 속성이
 * 아니므로 물리·마법으로 갈라 적지 않는다 — 대신 여기서 **공격 보정은 주력 타입에,
 * 방어 보정은 양쪽에** 얹는다. 그래야 마법사가 어떤 특성을 골라도 손해가 아니고,
 * "누구나 아무거나 고를 수 있다"가 수치 위에서도 참이 된다.
 */
export function applyStats(
  base: TraitStats,
  trait: TraitData,
  limits: TraitsFile['limits'],
  mainType: DamageType,
): TraitStats {
  const floor = (v: number) => Math.max(limits.minStat, v)
  const magic = mainType === 'magic'
  const mainAtk = floor((magic ? base.matk : base.patk) + trait.stats.atk)
  // 반대쪽은 원래 값 그대로. 양손잡이만 주력에 비례해 끌어올린다
  const other = magic ? base.patk : base.matk
  const offAtk = floor(
    trait.offhand ? Math.max(other, Math.floor(mainAtk * trait.offhand)) : other,
  )
  return {
    hp: floor(base.hp + trait.stats.hp),
    patk: magic ? offAtk : mainAtk,
    matk: magic ? mainAtk : offAtk,
    pdef: floor(base.pdef + trait.stats.def),
    mdef: floor(base.mdef + trait.stats.def),
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
