import type { EventBus } from './events'
import type { Dir, EncounterData, Pos, StageData } from './types'

const DELTA: Record<Dir, Pos> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
}

export const DIR_KO: Record<Dir, string> = {
  north: '북쪽',
  south: '남쪽',
  east: '동쪽',
  west: '서쪽',
}

export class Field {
  pos: Pos
  /** 아직 살아있는 조우 (보스 포함) */
  alive: Map<string, EncounterData>
  checkpointReached = false

  constructor(
    private stage: StageData,
    private monsterNames: Record<string, string>,
    private bus: EventBus,
  ) {
    this.pos = { ...stage.map.start }
    this.alive = new Map(
      [...stage.encounters, stage.boss].map((e) => [e.id, e]),
    )
  }

  isWall(p: Pos): boolean {
    const { width, height, tiles } = this.stage.map
    if (p.x < 0 || p.y < 0 || p.x >= width || p.y >= height) return true
    return tiles[p.y][p.x] === 1
  }

  encounterAt(p: Pos): EncounterData | undefined {
    for (const e of this.alive.values()) {
      if (e.pos.x === p.x && e.pos.y === p.y) return e
    }
    return undefined
  }

  /** 이동 시도. 전투가 시작되면 해당 조우를 반환한다. */
  move(dir: Dir): EncounterData | undefined {
    const next = { x: this.pos.x + DELTA[dir].x, y: this.pos.y + DELTA[dir].y }
    if (this.isWall(next) || this.encounterAt(next)) {
      if (this.encounterAt(next)) {
        // 몹이 있는 칸으로는 들어가지 않고 전투 시작
        return this.encounterAt(next)
      }
      this.bus.emit({ type: 'blocked', dir })
      return undefined
    }
    this.pos = next
    this.bus.emit({ type: 'moved', dir, pos: { ...this.pos }, ahead: this.describeAdjacent() })

    const adjacent = this.adjacentEncounter()
    if (adjacent) return adjacent

    const cp = this.stage.checkpoint
    if (!this.checkpointReached && this.pos.x === cp.x && this.pos.y === cp.y) {
      this.checkpointReached = true
      this.bus.emit({ type: 'checkpoint' })
    }
    return undefined
  }

  private adjacentEncounter(): EncounterData | undefined {
    for (const dir of Object.keys(DELTA) as Dir[]) {
      const p = { x: this.pos.x + DELTA[dir].x, y: this.pos.y + DELTA[dir].y }
      const e = this.encounterAt(p)
      if (e) return e
    }
    return undefined
  }

  /** 인접 칸에 몹이 있으면 이동 낭독에 덧붙일 문구 */
  private describeAdjacent(): string | null {
    const e = this.adjacentEncounter()
    if (!e) return null
    return this.encounterName(e)
  }

  encounterName(e: EncounterData): string {
    return this.monsterNames[e.monsters[0]]
  }

  removeEncounter(id: string): void {
    this.alive.delete(id)
  }

  respawn(): void {
    this.pos = this.checkpointReached
      ? { ...this.stage.checkpoint }
      : { ...this.stage.map.start }
  }

  /** R 키: 주변 요약 */
  summary(): string {
    const parts: string[] = [`지금 위치 동 ${this.pos.x}, 남 ${this.pos.y}.`]
    for (const e of this.alive.values()) {
      const dx = e.pos.x - this.pos.x
      const dy = e.pos.y - this.pos.y
      const dist: string[] = []
      if (dy !== 0) dist.push(`${dy < 0 ? '북쪽' : '남쪽'} ${Math.abs(dy)}칸`)
      if (dx !== 0) dist.push(`${dx > 0 ? '동쪽' : '서쪽'} ${Math.abs(dx)}칸`)
      parts.push(`${dist.join(' ')}에 ${this.encounterName(e)}.`)
    }
    const cp = this.stage.checkpoint
    if (!(this.pos.x === cp.x && this.pos.y === cp.y)) {
      const dx = cp.x - this.pos.x
      const dy = cp.y - this.pos.y
      const dist: string[] = []
      if (dy !== 0) dist.push(`${dy < 0 ? '북쪽' : '남쪽'} ${Math.abs(dy)}칸`)
      if (dx !== 0) dist.push(`${dx > 0 ? '동쪽' : '서쪽'} ${Math.abs(dx)}칸`)
      parts.push(`${dist.join(' ')}에 쉼터.`)
    }
    parts.push(`목표: ${this.stage.objective}`)
    return parts.join(' ')
  }
}
