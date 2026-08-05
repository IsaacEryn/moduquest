import { levelForXp } from './stats'
import { resolveTraitId } from './traits'
import type { EquipSlot, GameData, SaveSnapshot } from './types'

export const SAVE_VERSION = 3
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

export function sanitizeSnapshot(raw: unknown, data: GameData): SaveSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  let r = raw as Record<string, unknown>

  if (r.schemaVersion === 1) r = migrateV1(r, data)
  if (r.schemaVersion === 2) r = migrateV2(r)
  // 모르는 상위 버전은 되살리려 하지 않는다 — 조용히 새 게임을 시작하면 사라진 걸 모른다
  if (r.schemaVersion !== SAVE_VERSION) return null

  const stageIndex = clampInt(r.stageIndex, 0, data.stages.length - 1, 0)
  const stage = data.stages[stageIndex]

  const rawField = (r.field ?? {}) as Record<string, unknown>
  const rawPos = (rawField.pos ?? {}) as Record<string, unknown>
  let pos = {
    x: clampInt(rawPos.x, 0, stage.map.width - 1, stage.map.start.x),
    y: clampInt(rawPos.y, 0, stage.map.height - 1, stage.map.start.y),
  }
  // 벽 위에서 시작하면 이동 판정이 무너진다
  if (stage.map.tiles[pos.y]?.[pos.x] !== 0) pos = { ...stage.map.start }

  const encounterIds = new Set([...stage.encounters.map((e) => e.id), stage.boss.id])
  const defeated = Array.isArray(rawField.defeated)
    ? [...new Set(rawField.defeated.filter((id): id is string => encounterIds.has(id as string)))]
    : []

  // 장비 검증에는 레벨이 필요하다 — xp를 먼저 확정하고 레벨을 유도한다
  const xp = clampInt(r.xp, 0, 999999, 0)
  const level = levelForXp(data.progression.xpTable, xp)
  /** 무효 자리에서 밀려난 장비 — 지우지 않고 가방으로 돌려준다 */
  const returned: string[] = []

  const chestIds = new Set((stage.chests ?? []).map((c) => c.id))
  const openedChests = Array.isArray(rawField.openedChests)
    ? [...new Set(rawField.openedChests.filter((id): id is string => chestIds.has(id as string)))]
    : []

  // 인벤토리·처치 수: 실재하는 id만, 개수는 상한을 둔다
  const itemIds = new Set(Object.keys(data.items))
  const seenItems = new Set<string>()
  const inventory = (Array.isArray(r.inventory) ? r.inventory : [])
    .filter((e): e is { item: string; count: number } => {
      const item = (e as { item?: unknown })?.item
      if (typeof item !== 'string' || !itemIds.has(item) || seenItems.has(item)) return false
      seenItems.add(item)
      return true
    })
    .map((e) => ({ item: e.item, count: clampInt(e.count, 1, 99, 1) }))

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
    if (row) row.count = Math.min(99, row.count + 1)
    else inventory.push({ item: id, count: 1 })
  }

  const stageIds = new Set(data.stages.map((s) => s.id))
  const clearedStages = Array.isArray(r.clearedStages)
    ? [...new Set(r.clearedStages.filter((id): id is string => stageIds.has(id as string)))]
    : []

  return {
    schemaVersion: SAVE_VERSION,
    stageIndex,
    traitId: resolveTraitId(data.traits, typeof r.traitId === 'string' ? r.traitId : null),
    field: { pos, checkpointReached: rawField.checkpointReached === true, defeated, openedChests },
    inventory,
    kills,
    party,
    xp,
    seenDialogues,
    clearedStages,
    updatedAt: clampInt(r.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  }
}
