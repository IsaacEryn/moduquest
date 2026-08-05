import type { AreaData, AreaVariant, EncounterData, Pos, StageData } from './types'

/**
 * 지도 한 장의 크기. 모든 구역·모든 변형이 이 크기를 공유한다.
 *
 * 캔버스는 한 번만 만들어지고(scale.mode NONE) CSS도 이 비율로 굳어 있다.
 * 화면을 넓히는 대신 여러 장으로 나누는 것이 이 확장의 요지이기도 하다 —
 * 스크롤도 카메라도 없다는 성질이 이 게임의 접근성 자산이다.
 */
export const MAP_SIZE = { width: 12, height: 10 } as const

/** 북·남·동·서 고정 순서 — 입구 칸 유도가 결정적이어야 한다 */
const NEIGHBORS: Pos[] = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
]

export interface ResolvedExit {
  /** 스테이지 안에서 유일한 id ('a-shortcut') */
  id: string
  name: string
  note?: string
  pos: Pos
  toArea: string
  /** 도착 구역에서 짝이 되는 출구의 짧은 id */
  toExit: string
}

/** 다른 구역에 있는 것으로 가는 길 안내 */
export type Route = { here: true } | { here: false; viaExitId: string; areaName: string }

/**
 * 한 구역의 한 변형을 좌표까지 확정한 것. 여기부터는 '변형'이라는 개념이 없다 —
 * Field도 렌더러도 이 모양만 알면 된다.
 */
export interface ResolvedArea {
  areaId: string
  areaName: string
  /** 스테이지 안 몇 번째 구역인가 — "셋 중 둘째" 낭독용 */
  index: number
  total: number
  width: number
  height: number
  tiles: number[][]
  darkness?: { radius: number; note: string }
  /** id는 이미 '<구역id>-<짧은id>'로 조립돼 있다 */
  encounters: EncounterData[]
  boss: EncounterData | null
  chests: { id: string; pos: Pos; items: string[] }[]
  checkpoint: Pos | null
  exits: ResolvedExit[]
  start: Pos | null
  /** 들어온 문(짧은 id)에 맞는 자리. 모르는 문이면 시작점이나 첫 바닥으로 */
  entryAt(fromExitId: string | null): Pos
  /** 쉼터·보스가 이 구역에 없으면 어느 문으로 가야 하는지 */
  checkpointRoute: Route
  bossRoute: Route
}

/** 스테이지 안 전역 유일한 id로 조립한다 — 손으로 접두사를 쓰면 틀린다 */
export function scopedId(areaId: string, shortId: string): string {
  return `${areaId}-${shortId}`
}

function parseLink(to: string): { area: string; exit: string } {
  const [area, exit] = to.split(':')
  return { area, exit: exit ?? '' }
}

function isFloor(v: AreaVariant, p: Pos): boolean {
  return (
    p.y >= 0 &&
    p.y < v.tiles.length &&
    p.x >= 0 &&
    p.x < (v.tiles[0]?.length ?? 0) &&
    v.tiles[p.y][p.x] === 0
  )
}

/**
 * 다음에 쓸 지도 변형. 확률이 아니라 순환이다 —
 * 자리마다 다른 지도로 시작하고, 다시 할 때마다 다음 장으로 넘어간다.
 * 기록이 없으면 직전을 마지막 장으로 쳐서 첫 진입이 layoutKey % 장수가 되게 한다.
 */
export function nextVariant(stage: StageData, layoutKey: number, prev: number | null): number {
  const n = Math.max(1, stage.variantCount)
  const p = prev ?? n - 1
  return (((layoutKey + p + 1) % n) + n) % n
}

/** 구역 그래프에서 조건에 맞는 구역까지의 첫걸음(어느 문으로 나가는가) */
function findRoute(
  stage: StageData,
  fromAreaId: string,
  matches: (area: AreaData) => boolean,
): Route {
  const areas = new Map(stage.areas.map((a) => [a.id, a]))
  const here = areas.get(fromAreaId)
  if (here && matches(here)) return { here: true }

  // 너비 우선 — 첫걸음(출구)을 함께 들고 다닌다
  const queue: { areaId: string; firstExit: string }[] = []
  const seen = new Set<string>([fromAreaId])
  for (const exit of here?.exits ?? []) {
    const link = parseLink(exit.to)
    if (seen.has(link.area)) continue
    queue.push({ areaId: link.area, firstExit: exit.id })
    seen.add(link.area)
  }
  while (queue.length > 0) {
    const node = queue.shift()!
    const area = areas.get(node.areaId)
    if (!area) continue
    if (matches(area)) {
      return { here: false, viaExitId: node.firstExit, areaName: area.name }
    }
    for (const exit of area.exits) {
      const link = parseLink(exit.to)
      if (seen.has(link.area)) continue
      seen.add(link.area)
      queue.push({ areaId: link.area, firstExit: node.firstExit })
    }
  }
  return { here: false, viaExitId: '', areaName: '' }
}

/**
 * 구역 + 변형 → 좌표까지 확정된 지도.
 * 짧은 id를 전역 유일 id로 조립하고, 쉼터·보스로 가는 길을 미리 풀어 둔다.
 * 길 안내를 여기서 끝내 두면 Field는 문장만 만들면 되고, 검증도 순수 함수로 내려온다.
 */
export function resolveArea(stage: StageData, areaId: string, variant: number): ResolvedArea {
  const index = Math.max(
    0,
    stage.areas.findIndex((a) => a.id === areaId),
  )
  const area = stage.areas[index]
  const v = area.variants[variant] ?? area.variants[0]
  const at = (shortId: string): Pos => v.places[shortId] ?? { x: 0, y: 0 }

  const exits: ResolvedExit[] = area.exits.map((e) => {
    const link = parseLink(e.to)
    return {
      id: scopedId(area.id, e.id),
      name: e.name,
      note: e.note,
      pos: at(e.id),
      toArea: link.area,
      toExit: link.exit,
    }
  })

  /** 문 앞에 설 자리 — 적어 두지 않았으면 인접 바닥에서 고정 순서로 고른다 */
  const entryFor = (shortExitId: string): Pos | null => {
    const declared = v.entries?.[shortExitId]
    if (declared) return declared
    const door = v.places[shortExitId]
    if (!door) return null
    for (const d of NEIGHBORS) {
      const p = { x: door.x + d.x, y: door.y + d.y }
      if (isFloor(v, p)) return p
    }
    return null
  }

  const firstFloor = (): Pos => {
    for (let y = 0; y < v.tiles.length; y++) {
      for (let x = 0; x < v.tiles[y].length; x++) {
        if (v.tiles[y][x] === 0) return { x, y }
      }
    }
    return { x: 0, y: 0 }
  }

  return {
    areaId: area.id,
    areaName: area.name,
    index,
    total: stage.areas.length,
    width: stage.size.width,
    height: stage.size.height,
    tiles: v.tiles,
    darkness: area.darkness,
    encounters: area.encounters.map((e) => ({
      id: scopedId(area.id, e.id),
      pos: at(e.id),
      monsters: e.monsters,
      dialogue: e.dialogue,
    })),
    boss: area.boss
      ? {
          id: scopedId(area.id, area.boss.id),
          pos: at(area.boss.id),
          monsters: area.boss.monsters,
          dialogue: area.boss.dialogue,
        }
      : null,
    chests: (area.chests ?? []).map((c) => ({
      id: scopedId(area.id, c.id),
      pos: at(c.id),
      items: c.items,
    })),
    checkpoint: v.checkpoint ?? null,
    exits,
    start: v.start ?? null,
    entryAt(fromExitId: string | null): Pos {
      if (fromExitId) {
        const p = entryFor(fromExitId)
        if (p) return p
      }
      return v.start ?? entryFor(area.exits[0]?.id ?? '') ?? firstFloor()
    },
    checkpointRoute: findRoute(stage, area.id, (a) =>
      a.variants.some((av) => av.checkpoint !== undefined),
    ),
    bossRoute: findRoute(stage, area.id, (a) => a.boss !== undefined),
  }
}

/** 스테이지 전체(모든 구역)의 조우·보스 — 밸런스 시뮬과 저장 검증이 쓴다 */
export function allEncounters(stage: StageData): { id: string; monsters: string[] }[] {
  return stage.areas.flatMap((a) => [
    ...a.encounters.map((e) => ({ id: scopedId(a.id, e.id), monsters: e.monsters })),
    ...(a.boss ? [{ id: scopedId(a.id, a.boss.id), monsters: a.boss.monsters }] : []),
  ])
}

/** 스테이지 전체의 상자 id */
export function allChestIds(stage: StageData): string[] {
  return stage.areas.flatMap((a) => (a.chests ?? []).map((c) => scopedId(a.id, c.id)))
}
