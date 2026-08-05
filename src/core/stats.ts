import { applyStats } from './traits'
import type {
  ItemData,
  JobData,
  ProgressionData,
  SetData,
  StatBlock,
  TraitData,
  TraitsFile,
} from './types'

/**
 * 능력치 계산의 단일 원천. 직업·성장·장비·세트·오라·특성이 전부 여기서 합쳐진다.
 * 계산 지점이 흩어지면 화면과 실제 수치가 어긋난다 — 상태창도 이 결과를 그대로 쓴다.
 */

export interface FullStats {
  hp: number
  mp: number
  atk: number
  def: number
  spd: number
}

/** 스탯의 출처별 내역 — 상태창이 "공격 21 (기본 18 + 장비 3)"을 이 값에서 조립한다 */
export interface StatBreakdown {
  base: FullStats
  /** 마을에서 올린 영구 강화 — 성장의 일부라 기본값 바로 뒤에 온다 */
  upgrade: FullStats
  equip: FullStats
  set: FullStats
  aura: FullStats
  total: FullStats
}

const ZERO: FullStats = { hp: 0, mp: 0, atk: 0, def: 0, spd: 0 }

function add(a: FullStats, b: StatBlock | undefined): FullStats {
  if (!b) return a
  return {
    hp: a.hp + (b.hp ?? 0),
    mp: a.mp + (b.mp ?? 0),
    atk: a.atk + (b.atk ?? 0),
    def: a.def + (b.def ?? 0),
    spd: a.spd + (b.spd ?? 0),
  }
}

/** 레벨은 경험치에서 유도한다 — 저장하지 않는 단일 진실 원천 */
export function levelForXp(xpTable: number[], xp: number): number {
  let level = 1
  for (let i = 1; i < xpTable.length; i++) {
    if (xp >= xpTable[i]) level = i + 1
  }
  return level
}

/** 같은 세트를 pieces개 이상 착용했을 때만 보너스 — 보너스는 착용자 본인에게만 */
export function setBonus(
  equipment: ItemData[],
  sets: Record<string, SetData>,
): FullStats {
  const counts = new Map<string, number>()
  for (const item of equipment) {
    if (item.set) counts.set(item.set, (counts.get(item.set) ?? 0) + 1)
  }
  let bonus = ZERO
  for (const [id, count] of counts) {
    const set = sets[id]
    if (set && count >= set.pieces) bonus = add(bonus, set.bonus)
  }
  return bonus
}

export function computeMemberStats(input: {
  job: JobData
  growth: ProgressionData['growth'][string] | undefined
  level: number
  /** 마을에서 올린 강화분 — 단계 × 단계당 증가는 Game이 계산해 넘긴다 */
  upgrade: StatBlock
  /** 본인이 착용 중인 장비 (데이터로 해석된 것) */
  equipment: ItemData[]
  /** 다른 파티원 장비의 오라 합 — 착용자 자신은 제외하고 들어온다 */
  auraFromOthers: StatBlock
  sets: Record<string, SetData>
  /** 플레이어가 아니면 null — 특성은 내가 고른 플레이 스타일이다 */
  trait: TraitData | null
  limits: TraitsFile['limits']
}): StatBreakdown {
  const { job, growth, level, equipment, sets, trait, limits } = input
  const upgrade = add(ZERO, input.upgrade)
  const lv = level - 1
  const base: FullStats = {
    hp: job.hp + (growth?.hp ?? 0) * lv,
    mp: job.mp + (growth?.mp ?? 0) * lv,
    atk: job.atk + (growth?.atk ?? 0) * lv,
    def: job.def + (growth?.def ?? 0) * lv,
    spd: job.spd + (growth?.spd ?? 0) * lv,
  }
  let equip = ZERO
  for (const item of equipment) equip = add(equip, item.stats)
  const set = setBonus(equipment, sets)
  const aura = add(ZERO, input.auraFromOthers)

  const sum = add(add(add(add(base, upgrade), equip), set), aura)
  let total = sum
  if (trait) {
    // 특성 보정과 하한(limits.minStat)은 마지막에 한 번만 — 마력은 특성이 건드리지 않는다
    const t = applyStats(
      { hp: sum.hp, atk: sum.atk, def: sum.def, spd: sum.spd },
      trait,
      limits,
    )
    total = { hp: t.hp, mp: sum.mp, atk: t.atk, def: t.def, spd: t.spd }
  }
  return { base, upgrade, equip, set, aura, total }
}
