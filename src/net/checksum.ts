import type { SaveSnapshot } from '../core/types'

/**
 * 함께 하기의 어긋남 감지용 체크섬. 스냅샷을 정규형으로 만들어 해시한다.
 *
 * - updatedAt은 뺀다 — 화면마다 시계가 달라 유일하게 결정적이지 않은 값이다.
 * - 배열은 id 기준으로 정렬한다 — 중간에 합류한 화면은 Map 삽입 순서가 다를 수
 *   있는데, 순서는 게임 상태가 아니다.
 * 두 화면의 체크섬이 같으면 같은 세계를 보고 있는 것이다.
 */

export function canonicalSnapshot(s: SaveSnapshot): string {
  const sortBy = <T>(arr: T[], key: (x: T) => string): T[] =>
    [...arr].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0))
  const c = {
    schemaVersion: s.schemaVersion,
    stageIndex: s.stageIndex,
    traitIds: s.traitIds,
    layoutKey: s.layoutKey,
    variants: sortBy(s.variants, (v) => v.stage),
    field: {
      areaId: s.field.areaId,
      pos: s.field.pos,
      enteredFrom: s.field.enteredFrom,
      checkpointReached: s.field.checkpointReached,
      defeated: [...s.field.defeated].sort(),
      openedChests: [...s.field.openedChests].sort(),
    },
    bags: s.bags.map((bag) => sortBy(bag, (i) => i.item)),
    kills: sortBy(s.kills, (k) => k.monster),
    party: s.party.map((p) => ({
      job: p.job,
      hp: p.hp,
      equipment: Object.fromEntries(Object.entries(p.equipment).sort()),
    })),
    xp: s.xp,
    golds: s.golds,
    materials: s.materials,
    upgrades: sortBy(s.upgrades, (u) => `${u.job}-${u.stat}`),
    seenDialogues: [...s.seenDialogues].sort(),
    clearedStages: [...s.clearedStages].sort(),
    // updatedAt은 뺀다
  }
  return JSON.stringify(c)
}

/** FNV-1a 32비트 — 암호 해시가 아니라 어긋남 감지용이다 */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function snapshotChecksum(s: SaveSnapshot): number {
  return fnv1a(canonicalSnapshot(s))
}

/**
 * 세계 전체의 체크섬. 저장 스냅샷은 진행도만 담으므로 전투·길잡이·자리 조작자·
 * 대사 위치는 빠져 있다. 그것들까지 견줘야 "같은 세계를 보고 있다"가 참이 된다 —
 * live는 Game.liveFingerprint()가 만든다.
 */
export function worldChecksum(s: SaveSnapshot, live: string): number {
  return fnv1a(`${canonicalSnapshot(s)}##${live}`)
}
