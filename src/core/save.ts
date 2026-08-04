import type { GameData, SaveSnapshot } from './types'
import { resolveTraitId } from './traits'

export const SAVE_VERSION = 1
export const SLOT_COUNT = 3

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
export function sanitizeSnapshot(raw: unknown, data: GameData): SaveSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>

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

  const jobIds = new Set(data.party.map((p) => p.job))
  const partyHp = Array.isArray(r.party)
    ? r.party
        .filter(
          (p): p is { id: string; hp: number } =>
            !!p && typeof p === 'object' && jobIds.has((p as { id?: string }).id ?? ''),
        )
        .map((p) => ({ id: p.id, hp: clampInt(p.hp, 0, 9999, 1) }))
    : []

  const scriptKeys = new Set(Object.keys(stage.script))
  const seenDialogues = Array.isArray(r.seenDialogues)
    ? [...new Set(r.seenDialogues.filter((k): k is string => scriptKeys.has(k as string)))]
    : []

  const stageIds = new Set(data.stages.map((s) => s.id))
  const clearedStages = Array.isArray(r.clearedStages)
    ? [...new Set(r.clearedStages.filter((id): id is string => stageIds.has(id as string)))]
    : []

  return {
    schemaVersion: SAVE_VERSION,
    stageIndex,
    traitId: resolveTraitId(data.traits, typeof r.traitId === 'string' ? r.traitId : null),
    field: { pos, checkpointReached: rawField.checkpointReached === true, defeated },
    party: partyHp,
    seenDialogues,
    clearedStages,
    updatedAt: clampInt(r.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  }
}
