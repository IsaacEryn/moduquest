import type { EventBus } from './events'
import { toward } from './korean'
import type { ResolvedArea, ResolvedExit, Route } from './layout'
import type { Dir, EncounterData, Pos } from './types'

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

const ORDINAL = ['첫째', '둘째', '셋째', '넷째', '다섯째']

export class Field {
  pos: Pos
  checkpointReached = false

  /** 지금 걷고 있는 구역. 좌표 판정은 전부 이 안에서만 일어난다 */
  private area: ResolvedArea
  /**
   * 없앤 조우와 연 상자 — 구역을 넘어도 스테이지 내내 누적된다.
   * "살아 있는 것"이 아니라 "없앤 것"을 들고 다니는 이유는, 살아 있는 목록을
   * 구역마다 갈아 끼우다 보면 다른 구역 것을 잊거나 끌고 다니기 때문이다.
   */
  private defeatedIdSet = new Set<string>()
  private opened = new Set<string>()
  /** 어느 문으로 들어왔나 — 부활 지점과 되돌아가기 안내에 쓴다 */
  private enteredFrom: string | null = null
  /** 쉼터를 밟은 구역. 죽으면 여기로 돌아온다 */
  private checkpointArea: string | null = null
  /**
   * 밟아 본 칸. 어디를 이미 지났는지 헷갈리는 것은 난이도가 아니라 부담이라
   * 특성이 아니라 기본 기능으로 둔다. 옵션에서 끌 수 있다.
   */
  private steppedOn = new Set<string>()

  /** 걸어서 이 거리 안만 알 수 있다. null이면 지도 전체를 안다 */
  private radius: number | null

  constructor(
    area: ResolvedArea,
    private monsterNames: Record<string, string>,
    private bus: EventBus,
    radius: number | null = null,
    /**
     * 만나면 큰 싸움이 되는 몹들. 이름만으로는 세다는 것을 알 수 없어서,
     * 밟기 전에 들리도록 요약과 이동 안내에 표시를 붙인다.
     * 지나칠 수 있는 관문이라면 더더욱 — 모르고 밟으면 고른 것이 아니다.
     */
    private bossIds: Set<string> = new Set(),
  ) {
    this.area = area
    this.pos = area.entryAt(null)
    this.radius = radius
    this.markStep()
  }

  setPerceptionRadius(radius: number | null): void {
    this.radius = radius
  }

  /** 지나온 길 표시를 쓸지. 옵션이 정하고 세 렌즈가 함께 따른다 */
  showTrail = true

  /**
   * 지도만 갈아 끼운다. 없앤 조우·연 상자는 그대로 —
   * 새로 만들면 되돌아갈 때마다 상자가 부활한다.
   */
  enterArea(area: ResolvedArea, fromExitId: string | null): void {
    this.area = area
    this.enteredFrom = fromExitId
    this.pos = area.entryAt(fromExitId)
    this.markStep()
  }

  private markStep(): void {
    this.steppedOn.add(`${this.area.areaId}|${this.pos.x},${this.pos.y}`)
  }

  /** 이 칸을 이미 밟았는지 — 렌더러가 발자국을 그리는 판정 */
  hasStepped(p: Pos): boolean {
    return this.steppedOn.has(`${this.area.areaId}|${p.x},${p.y}`)
  }

  /** 아직 안 가 본 이웃 칸의 방향들 — 둘러보기가 "새 길"을 알려 준다 */
  freshDirections(): Dir[] {
    return (Object.keys(DELTA) as Dir[]).filter((d) => {
      const p = { x: this.pos.x + DELTA[d].x, y: this.pos.y + DELTA[d].y }
      return !this.isWall(p) && !this.hasStepped(p)
    })
  }

  get currentArea(): ResolvedArea {
    return this.area
  }

  get areaId(): string {
    return this.area.areaId
  }

  get entered(): string | null {
    return this.enteredFrom
  }

  /** 지금 구역에서 아직 살아 있는 조우 (보스 포함) */
  get alive(): Map<string, EncounterData> {
    const all = [...this.area.encounters, ...(this.area.boss ? [this.area.boss] : [])]
    return new Map(all.filter((e) => !this.defeatedIdSet.has(e.id)).map((e) => [e.id, e]))
  }

  get atCheckpoint(): boolean {
    const cp = this.area.checkpoint
    return !!cp && this.pos.x === cp.x && this.pos.y === cp.y
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

  /** 아직 안 연 상자 중 아는 것만 — 렌즈 셋 모두 이 목록으로 그린다 */
  knownChests(): { id: string; pos: Pos; items: string[] }[] {
    return this.area.chests.filter((c) => !this.opened.has(c.id) && this.isKnown(c.pos))
  }

  /**
   * 문은 어둠을 뚫는다. 쉼터와 같은 예외군 — 길을 잃는 건 재미가 아니고,
   * 어느 길이 있는지조차 모르면 "고르기"가 성립하지 않는다.
   */
  knownExits(): ResolvedExit[] {
    return this.area.exits
  }

  /** 지금 선 칸에 안 연 상자가 있으면 열고 돌려준다 — 밟는 것이 여는 것이다 */
  openChestAt(p: Pos): { id: string; pos: Pos; items: string[] } | undefined {
    const chest = this.area.chests.find(
      (c) => !this.opened.has(c.id) && c.pos.x === p.x && c.pos.y === p.y,
    )
    if (chest) this.opened.add(chest.id)
    return chest
  }

  /** 지금 선 칸이 문이면 그 문 */
  exitAt(p: Pos): ResolvedExit | undefined {
    return this.area.exits.find((e) => e.pos.x === p.x && e.pos.y === p.y)
  }

  get openedChestIds(): string[] {
    return [...this.opened]
  }

  isWall(p: Pos): boolean {
    const { width, height, tiles } = this.area
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
    this.markStep()
    this.bus.emit({ type: 'moved', dir, pos: { ...this.pos }, ahead: this.describeAdjacent() })
    // 쉼터 판정을 조우 판정보다 먼저 — 몹 옆에 놓인 쉼터도 기록돼야 한다
    this.reachCheckpoint()
    return this.adjacentEncounter()
  }

  /** 쉼터를 밟았는지 — 이동으로도 구역 전환으로도 도착할 수 있어 판정을 따로 뒀다 */
  reachCheckpoint(): boolean {
    if (this.checkpointReached || !this.atCheckpoint) return false
    this.checkpointReached = true
    this.checkpointArea = this.area.areaId
    this.bus.emit({ type: 'checkpoint' })
    return true
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
    const name = this.monsterNames[e.monsters[0]]
    return e.monsters.some((id) => this.bossIds.has(id)) ? `${name}(강한 기척)` : name
  }

  removeEncounter(id: string): void {
    this.defeatedIdSet.add(id)
  }

  /** 저장된 진행도를 되돌린다. 전달값은 이미 검증된 것만 온다 */
  restore(
    pos: Pos,
    checkpointReached: boolean,
    defeated: string[],
    openedChests: string[] = [],
    enteredFrom: string | null = null,
  ): void {
    this.pos = { ...pos }
    this.markStep()
    this.checkpointReached = checkpointReached
    this.enteredFrom = enteredFrom
    if (checkpointReached) this.checkpointArea = this.area.areaId
    for (const id of defeated) this.defeatedIdSet.add(id)
    for (const id of openedChests) this.opened.add(id)
  }

  get defeatedIds(): string[] {
    return [...this.defeatedIdSet]
  }

  /**
   * 죽었을 때 돌아갈 곳. 쉼터를 밟았으면 그 구역, 아니면 지금 구역의 입구다.
   * 스테이지 처음으로 되돌리지 않는 이유는 관대한 재시작 원칙 — 세 구역을
   * 다시 걷게 하는 건 벌이다.
   */
  respawnTarget(): { areaId: string; toCheckpoint: boolean } {
    if (this.checkpointReached && this.checkpointArea) {
      return { areaId: this.checkpointArea, toCheckpoint: true }
    }
    return { areaId: this.area.areaId, toCheckpoint: false }
  }

  /** 같은 구역 안에서의 부활 */
  respawn(): void {
    const cp = this.area.checkpoint
    this.pos =
      this.checkpointReached && cp ? { ...cp } : this.area.entryAt(this.enteredFrom)
    this.markStep()
  }

  private describeDistance(to: Pos): string {
    const dx = to.x - this.pos.x
    const dy = to.y - this.pos.y
    const dist: string[] = []
    if (dy !== 0) dist.push(`${dy < 0 ? '북쪽' : '남쪽'} ${Math.abs(dy)}칸`)
    if (dx !== 0) dist.push(`${dx > 0 ? '동쪽' : '서쪽'} ${Math.abs(dx)}칸`)
    return dist.length > 0 ? dist.join(' ') : '바로 여기'
  }

  /** 다른 구역에 있는 것으로 가는 길 — 거리 대신 어느 문인지를 말한다 */
  private describeRoute(what: string, route: Route): string | null {
    if (route.here) return null
    const exit = this.area.exits.find((e) => e.id.endsWith(`-${route.viaExitId}`))
    if (!exit) return `${what}는 ${route.areaName}에 있다.`
    return `${what}는 ${route.areaName}에 있다. ${toward(exit.name)} 간다.`
  }

  /** 지금 구역이 스테이지의 몇 번째인지 — "셋 중 둘째" */
  get where(): string {
    const { index, total, areaName } = this.area
    if (total <= 1) return areaName
    return `${total}구역 중 ${ORDINAL[index] ?? `${index + 1}번째`}, ${areaName}`
  }

  /**
   * R 키: 주변 요약.
   * 지각 반경이 있으면 아는 것만 말하되, 모른다는 사실 자체는 반드시 알린다 —
   * 조용히 빠지면 정보 누락이지만 밝히면 게임 규칙이다.
   * 쉼터·목표·문은 어떤 특성에서도 항상 알려준다. 길을 잃는 건 재미가 아니다.
   */
  summary(objective: string): string {
    const parts: string[] = [`${this.where}. 지금 위치 동 ${this.pos.x}, 남 ${this.pos.y}.`]
    for (const e of this.knownEncounters()) {
      parts.push(`${this.describeDistance(e.pos)}에 ${this.encounterName(e)}.`)
    }
    for (const c of this.knownChests()) {
      parts.push(`${this.describeDistance(c.pos)}에 보물상자.`)
    }
    for (const x of this.knownExits()) {
      const note = x.note ? ` ${x.note}` : ''
      parts.push(`${this.describeDistance(x.pos)}에 ${x.name}.${note}`)
    }
    const cp = this.area.checkpoint
    if (cp) {
      if (!(this.pos.x === cp.x && this.pos.y === cp.y)) {
        parts.push(`${this.describeDistance(cp)}에 쉼터.`)
      }
    } else {
      const line = this.describeRoute('쉼터', this.area.checkpointRoute)
      if (line) parts.push(line)
    }
    if (this.radius !== null) {
      // 왜 좁아졌는지 구역이 이유를 주면 함께 말한다
      const note = this.area.darkness?.note
      parts.push(
        `${note ? `${note} ` : ''}걸어서 ${this.radius}칸 안만 알 수 있다. 그 밖은 알 수 없다.`,
      )
    }
    if (this.showTrail) {
      const fresh = this.freshDirections()
      parts.push(
        fresh.length > 0
          ? `아직 가 보지 않은 쪽: ${fresh.map((d) => DIR_KO[d]).join(', ')}.`
          : '사방 모두 가 본 길이다.',
      )
    }
    parts.push(`목표: ${objective}`)
    return parts.join(' ')
  }
}
