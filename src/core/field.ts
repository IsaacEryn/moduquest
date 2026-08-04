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

  /** 걸어서 이 거리 안만 알 수 있다. null이면 맵 전체를 안다 */
  private radius: number | null

  constructor(
    private stage: StageData,
    private monsterNames: Record<string, string>,
    private bus: EventBus,
    radius: number | null = null,
  ) {
    this.pos = { ...stage.map.start }
    this.alive = new Map(
      [...stage.encounters, stage.boss].map((e) => [e.id, e]),
    )
    this.radius = radius
  }

  setPerceptionRadius(radius: number | null): void {
    this.radius = radius
  }

  get atCheckpoint(): boolean {
    const cp = this.stage.checkpoint
    return this.pos.x === cp.x && this.pos.y === cp.y
  }

  /**
   * 아는 곳인지 — 세 렌즈(그림·글·소리)가 전부 이 판정을 통과한 것만 다룬다.
   * 화면에만 안개를 걸면 낭독과 텍스트 기록으로 새어 나간다.
   */
  isKnown(p: Pos): boolean {
    if (this.radius === null) return true
    return Math.abs(p.x - this.pos.x) + Math.abs(p.y - this.pos.y) <= this.radius
  }

  /** 지금 아는 조우만 */
  knownEncounters(): EncounterData[] {
    return [...this.alive.values()].filter((e) => this.isKnown(e.pos))
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

    // 체크포인트 판정을 조우 판정보다 먼저 — 몹 옆에 배치된 쉼터도 기록돼야 한다
    const cp = this.stage.checkpoint
    if (!this.checkpointReached && this.pos.x === cp.x && this.pos.y === cp.y) {
      this.checkpointReached = true
      this.bus.emit({ type: 'checkpoint' })
    }

    return this.adjacentEncounter()
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

  /** 저장된 진행도를 되돌린다. 전달값은 이미 검증된 것만 온다 */
  restore(pos: Pos, checkpointReached: boolean, defeated: string[]): void {
    this.pos = { ...pos }
    this.checkpointReached = checkpointReached
    for (const id of defeated) this.alive.delete(id)
  }

  get defeatedIds(): string[] {
    const all = [...this.stage.encounters.map((e) => e.id), this.stage.boss.id]
    return all.filter((id) => !this.alive.has(id))
  }

  respawn(): void {
    this.pos = this.checkpointReached
      ? { ...this.stage.checkpoint }
      : { ...this.stage.map.start }
  }

  private describeDistance(to: Pos): string {
    const dx = to.x - this.pos.x
    const dy = to.y - this.pos.y
    const dist: string[] = []
    if (dy !== 0) dist.push(`${dy < 0 ? '북쪽' : '남쪽'} ${Math.abs(dy)}칸`)
    if (dx !== 0) dist.push(`${dx > 0 ? '동쪽' : '서쪽'} ${Math.abs(dx)}칸`)
    return dist.join(' ')
  }

  /**
   * R 키: 주변 요약.
   * 지각 반경이 있으면 아는 것만 말하되, 모른다는 사실 자체는 반드시 알린다 —
   * 조용히 빠지면 정보 누락이지만 밝히면 게임 규칙이다.
   * 쉼터와 목표는 어떤 특성에서도 항상 알려준다. 길을 잃는 건 재미가 아니다.
   */
  summary(): string {
    const parts: string[] = [`지금 위치 동 ${this.pos.x}, 남 ${this.pos.y}.`]
    for (const e of this.knownEncounters()) {
      parts.push(`${this.describeDistance(e.pos)}에 ${this.encounterName(e)}.`)
    }
    const cp = this.stage.checkpoint
    if (!(this.pos.x === cp.x && this.pos.y === cp.y)) {
      parts.push(`${this.describeDistance(cp)}에 쉼터.`)
    }
    if (this.radius !== null) {
      // 왜 좁아졌는지 스테이지가 이유를 주면 함께 말한다
      const note = this.stage.map.darkness?.note
      parts.push(
        `${note ? `${note} ` : ''}걸어서 ${this.radius}칸 안만 알 수 있다. 그 밖은 알 수 없다.`,
      )
    }
    parts.push(`목표: ${this.stage.objective}`)
    return parts.join(' ')
  }
}
