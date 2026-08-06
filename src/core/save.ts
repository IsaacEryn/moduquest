import { allChestIds, allEncounters, resolveArea } from './layout'
import { levelForXp } from './stats'
import { resolveTraitId } from './traits'
import type { EquipSlot, GameData, SaveSnapshot, StageData } from './types'

export const SAVE_VERSION = 5
export const SLOT_COUNT = 3

const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'armor', 'shoes', 'gloves']

/**
 * 저장·복원 규칙. 무엇이 진행도인가는 게임 규칙이므로 코어에 두고,
 * 읽고 쓰는 일(localStorage·네트워크)은 바깥이 맡는다.
 *
 * 저장값에는 자유 문자열을 넣지 않는다 — 숫자·불리언과 src/data에 이미 있는 id만.
 * 그래서 불러온 값이 화면에 문자열로 나가는 경로가 아예 없다.
 */

/** 얼마나 나아갔는지. 되돌아가지 않는 값이라 두 기록을 시계 없이 비교할 수 있다 */
export function progressScore(s: SaveSnapshot): number {
  return (
    s.stageIndex * 1000 +
    s.clearedStages.length * 100 +
    s.field.defeated.length * 10 +
    (s.field.checkpointReached ? 5 : 0)
  )
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : fallback
}

/**
 * 저장값은 신뢰하지 않는다. 검증 기준은 게임 데이터에서 끌어오므로
 * 데이터가 바뀌면 검증도 함께 따라간다.
 * 읽을 수 없으면 null을 돌려주고, 호출자가 사용자에게 알린다.
 */
/**
 * 옛 버전은 살려서 읽는다 — 기록을 지우지 않는 것이 관대한 설계다.
 * v1에는 파티 구성과 경험치가 없었으니 기본 구성과 스테이지 기준 경험치를 채운다.
 */
function migrateV1(r: Record<string, unknown>, data: GameData): Record<string, unknown> {
  const stageIndex = clampInt(r.stageIndex, 0, data.stages.length - 1, 0)
  const oldParty = Array.isArray(r.party) ? (r.party as Record<string, unknown>[]) : []
  return {
    ...r,
    // 다음 단계(v2 마이그레이션)가 이어받도록 반드시 2를 적는다.
    // 현재 버전을 적으면 "v3라고 주장하는 v2 모양"이 되어 체인이 끊긴다
    schemaVersion: 2,
    party: oldParty.map((p) => ({ job: p?.id, hp: p?.hp })),
    xp: data.progression.stageEntryXp[stageIndex] ?? 0,
  }
}

/** v2에는 장비가 없었다 — 빈 손으로 이어받는다 */
function migrateV2(r: Record<string, unknown>): Record<string, unknown> {
  const party = Array.isArray(r.party) ? (r.party as Record<string, unknown>[]) : []
  return {
    ...r,
    schemaVersion: 3,
    party: party.map((p) => ({ ...p, equipment: {} })),
  }
}

/**
 * v3에는 구역이 없었다. 저장된 짧은 id가 이 스테이지에서 정확히 한 구역에만 있으면
 * 그 구역 것으로 승격하고, 여러 구역에 걸치면 어느 것인지 알 수 없으므로 버린다.
 * 구역이 하나뿐인 스테이지는 전부 살아나고, 다시 그린 스테이지는 저절로 정리된다.
 */
function migrateV3(r: Record<string, unknown>, data: GameData): Record<string, unknown> {
  const stageIndex = clampInt(r.stageIndex, 0, data.stages.length - 1, 0)
  const stage = data.stages[stageIndex]
  const rawField = (r.field ?? {}) as Record<string, unknown>

  /** 짧은 id → 그 id를 가진 구역들 */
  const owners = (short: string, kind: 'enc' | 'chest'): string[] =>
    stage.areas
      .filter((a) =>
        kind === 'enc'
          ? [...a.encounters, ...(a.boss ? [a.boss] : [])].some((e) => e.id === short)
          : (a.chests ?? []).some((c) => c.id === short),
      )
      .map((a) => a.id)

  let lost = false
  const promote = (ids: unknown, kind: 'enc' | 'chest'): string[] => {
    if (!Array.isArray(ids)) return []
    const out: string[] = []
    for (const id of ids) {
      if (typeof id !== 'string') continue
      const areas = owners(id, kind)
      if (areas.length === 1) out.push(`${areas[0]}-${id}`)
      else lost = true
    }
    return out
  }

  const defeated = promote(rawField.defeated, 'enc')
  const openedChests = promote(rawField.openedChests, 'chest')
  // 지도를 다시 그린 스테이지라면 옛 좌표와 쉼터 기록은 지금의 그것이 아니다
  const keep = !lost && stage.areas.length === 1
  return {
    ...r,
    // 다음 단계가 이어받도록 반드시 4를 적는다. 현재 버전을 적으면 체인이 끊긴다
    schemaVersion: 4,
    layoutKey: 0,
    variants: [],
    field: {
      ...rawField,
      areaId: stage.areas[0].id,
      enteredFrom: null,
      defeated,
      openedChests,
      checkpointReached: keep && rawField.checkpointReached === true,
      pos: keep ? rawField.pos : undefined,
    },
  }
}

/** v4에는 마을이 없었다 — 빈 지갑으로 이어받는다 */
function migrateV4(r: Record<string, unknown>): Record<string, unknown> {
  return {
    ...r,
    // 다음 단계가 이어받도록 반드시 5를 적는다. 현재 버전을 적으면 체인이 끊긴다
    schemaVersion: 5,
    gold: 0,
    materials: 0,
    upgrades: [],
  }
}

export function sanitizeSnapshot(raw: unknown, data: GameData): SaveSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  let r = raw as Record<string, unknown>

  if (r.schemaVersion === 1) r = migrateV1(r, data)
  if (r.schemaVersion === 2) r = migrateV2(r)
  if (r.schemaVersion === 3) r = migrateV3(r, data)
  if (r.schemaVersion === 4) r = migrateV4(r)
  // 모르는 상위 버전은 되살리려 하지 않는다 — 조용히 새 게임을 시작하면 사라진 걸 모른다
  if (r.schemaVersion !== SAVE_VERSION) return null

  const stageIndex = clampInt(r.stageIndex, 0, data.stages.length - 1, 0)
  const stage = data.stages[stageIndex]

  // 지도부터 확정한다 — 어느 변형의 어느 구역인지 모르면 좌표를 검증할 수 없다
  const layoutKey = clampInt(r.layoutKey, 0, 999, 0)
  const stageIds = new Set(data.stages.map((s) => s.id))
  const seenStages = new Set<string>()
  const variants = (Array.isArray(r.variants) ? r.variants : [])
    .filter((v): v is { stage: string; variant: number } => {
      const id = (v as { stage?: unknown })?.stage
      if (typeof id !== 'string' || !stageIds.has(id) || seenStages.has(id)) return false
      seenStages.add(id)
      return true
    })
    .map((v) => {
      const target = data.stages.find((s) => s.id === v.stage) as StageData
      return { stage: v.stage, variant: clampInt(v.variant, 0, target.variantCount - 1, 0) }
    })

  const rawField = (r.field ?? {}) as Record<string, unknown>
  const variantIndex = variants.find((v) => v.stage === stage.id)?.variant ?? 0
  const areaId =
    typeof rawField.areaId === 'string' && stage.areas.some((a) => a.id === rawField.areaId)
      ? rawField.areaId
      : stage.areas[0].id
  const area = resolveArea(stage, areaId, variantIndex)

  const enteredFrom =
    typeof rawField.enteredFrom === 'string' &&
    area.exits.some((e) => e.id.endsWith(`-${rawField.enteredFrom as string}`))
      ? (rawField.enteredFrom as string)
      : null

  const rawPos = (rawField.pos ?? {}) as Record<string, unknown>
  const fallback = area.entryAt(enteredFrom)
  let pos = {
    x: clampInt(rawPos.x, 0, area.width - 1, fallback.x),
    y: clampInt(rawPos.y, 0, area.height - 1, fallback.y),
  }
  // 벽 위나 문 위에서 시작하면 이동 판정이 무너지거나 서 있는 채로 전이가 안 된다
  if (area.tiles[pos.y]?.[pos.x] !== 0) pos = { ...fallback }
  if (area.exits.some((e) => e.pos.x === pos.x && e.pos.y === pos.y)) pos = { ...fallback }

  // 없앤 조우는 스테이지 전체에서 찾는다 — 지금 구역만 보면 다른 구역 몹이 부활한다
  const encounterIds = new Set(allEncounters(stage).map((e) => e.id))
  const defeated = Array.isArray(rawField.defeated)
    ? [...new Set(rawField.defeated.filter((id): id is string => encounterIds.has(id as string)))]
    : []

  // 장비 검증에는 레벨이 필요하다 — xp를 먼저 확정하고 레벨을 유도한다
  const xp = clampInt(r.xp, 0, 999999, 0)
  const level = levelForXp(data.progression.xpTable, xp)
  /** 무효 자리에서 밀려난 장비 — 지우지 않고 가방으로 돌려준다 */
  const returned: string[] = []

  const chestIds = new Set(allChestIds(stage))
  const openedChests = Array.isArray(rawField.openedChests)
    ? [...new Set(rawField.openedChests.filter((id): id is string => chestIds.has(id as string)))]
    : []

  // 인벤토리·처치 수: 실재하는 id만, 개수는 상한을 둔다.
  // 상한은 게임 규칙과 같은 곳(데이터)에서 읽는다 — 예전에는 여기에 99를 따로 적어
  // 두어, 규칙을 바꾸면 검증만 옛 수를 붙들고 있었다
  const stackMax = data.progression.itemStackMax
  const itemIds = new Set(Object.keys(data.items))
  const seenItems = new Set<string>()
  const inventory = (Array.isArray(r.inventory) ? r.inventory : [])
    .filter((e): e is { item: string; count: number } => {
      const item = (e as { item?: unknown })?.item
      if (typeof item !== 'string' || !itemIds.has(item) || seenItems.has(item)) return false
      seenItems.add(item)
      return true
    })
    .map((e) => ({ item: e.item, count: clampInt(e.count, 1, stackMax, 1) }))

  const monsterIds = new Set(Object.keys(data.monsters))
  const seenMonsters = new Set<string>()
  const kills = (Array.isArray(r.kills) ? r.kills : [])
    .filter((e): e is { monster: string; count: number } => {
      const monster = (e as { monster?: unknown })?.monster
      if (typeof monster !== 'string' || !monsterIds.has(monster) || seenMonsters.has(monster))
        return false
      seenMonsters.add(monster)
      return true
    })
    .map((e) => ({ monster: e.monster, count: clampInt(e.count, 1, 99999, 1) }))

  /** 장비 슬롯 검증: 실재 · 장비 종류 · 슬롯 일치 · 레벨 조건. 어긋나면 가방으로 강등 */
  const sanitizeEquipment = (rawEq: unknown): Partial<Record<EquipSlot, string>> => {
    const out: Partial<Record<EquipSlot, string>> = {}
    if (!rawEq || typeof rawEq !== 'object') return out
    for (const slot of EQUIP_SLOTS) {
      const id = (rawEq as Record<string, unknown>)[slot]
      if (typeof id !== 'string') continue
      const item = data.items[id]
      if (!item || item.kind !== 'equipment') continue // 실재하지 않으면 되살릴 것도 없다
      if (item.slot !== slot || (item.minLevel ?? 1) > level) {
        returned.push(id)
        continue
      }
      out[slot] = id
    }
    return out
  }

  // 파티 구성: 실재하는 직업 · 정원수 · 중복 없음이 아니면 기본 구성으로 되돌린다
  const jobIds = new Set(Object.keys(data.jobs))
  const rawParty = Array.isArray(r.party) ? (r.party as Record<string, unknown>[]) : []
  let party = rawParty
    .filter(
      (p): p is Record<string, unknown> =>
        !!p && typeof p === 'object' && jobIds.has((p as { job?: string }).job as string),
    )
    .map((p) => ({
      job: p.job as string,
      hp: clampInt(p.hp, 0, 9999, 1),
      equipment: sanitizeEquipment(p.equipment),
    }))
  if (
    party.length !== data.party.length ||
    new Set(party.map((p) => p.job)).size !== party.length
  ) {
    // 구성이 무너져도 장비는 살린다 — 유효한 장비 id를 가방으로 옮기고 빈 손으로 시작
    for (const p of party) for (const id of Object.values(p.equipment)) if (id) returned.push(id)
    party = data.party.map((p) => ({ job: p.job, hp: 9999, equipment: {} }))
  }

  const scriptKeys = new Set(Object.keys(stage.script))
  const seenDialogues = Array.isArray(r.seenDialogues)
    ? [...new Set(r.seenDialogues.filter((k): k is string => scriptKeys.has(k as string)))]
    : []

  // 무효 자리에서 밀려난 장비를 가방에 합류시킨다 — 파티 검증이 끝난 뒤에야 목록이 완성된다
  for (const id of returned) {
    const row = inventory.find((e) => e.item === id)
    if (row) row.count = Math.min(stackMax, row.count + 1)
    else inventory.push({ item: id, count: 1 })
  }

  // 마을 지갑. 강화 단계는 (직업, 능력치) 한 쌍에 하나뿐이고 상한을 넘지 않는다
  const gold = clampInt(r.gold, 0, 99999, 0)
  const materials = clampInt(r.materials, 0, 9999, 0)
  const upgradeStats = new Set<string>(data.economy.upgrade.stats)
  const maxUpgrade = data.economy.upgrade.maxLevel
  const seenUpgrades = new Set<string>()
  const upgrades = (Array.isArray(r.upgrades) ? r.upgrades : [])
    .filter((u): u is { job: string; stat: string; level: number } => {
      const row = u as { job?: unknown; stat?: unknown }
      if (typeof row?.job !== 'string' || !jobIds.has(row.job)) return false
      if (typeof row?.stat !== 'string' || !upgradeStats.has(row.stat)) return false
      const key = `${row.job}-${row.stat}`
      if (seenUpgrades.has(key)) return false
      seenUpgrades.add(key)
      return true
    })
    .map((u) => ({ job: u.job, stat: u.stat, level: clampInt(u.level, 1, maxUpgrade, 1) }))

  const clearedStages = Array.isArray(r.clearedStages)
    ? [...new Set(r.clearedStages.filter((id): id is string => stageIds.has(id as string)))]
    : []

  return {
    schemaVersion: SAVE_VERSION,
    stageIndex,
    traitId: resolveTraitId(data.traits, typeof r.traitId === 'string' ? r.traitId : null),
    layoutKey,
    variants,
    field: {
      areaId,
      pos,
      enteredFrom,
      checkpointReached: rawField.checkpointReached === true,
      defeated,
      openedChests,
    },
    inventory,
    kills,
    party,
    xp,
    gold,
    materials,
    upgrades,
    seenDialogues,
    clearedStages,
    updatedAt: clampInt(r.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  }
}
