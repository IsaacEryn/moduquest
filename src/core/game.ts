import { Battle, type StepResult } from './battle'
import type { EventBus, GameMode } from './events'
import { Field } from './field'
import { SAVE_VERSION } from './save'
import {
  applyCombat,
  applyStats,
  perceptionRadius,
  resolveTrait,
  resolveTraitId,
} from './traits'
import type {
  Combatant,
  DialogueLine,
  Dir,
  EncounterData,
  GameData,
  PlayerAction,
  SaveSnapshot,
  StageData,
  TraitData,
  TraitsFile,
} from './types'

/** NPC·몹 턴 사이 간격(ms). 낭독이 따라올 시간을 준다. */
const TURN_DELAY = 900

/**
 * 턴 진행 타이머의 추상화. 코어는 실행 환경(브라우저·테스트·향후 원격 턴)을
 * 모르므로 스케줄러를 주입받는다.
 */
export interface TurnScheduler {
  schedule(fn: () => void, delayMs: number): unknown
  cancel(handle: unknown): void
}

export class Game {
  mode: GameMode = 'title'
  field: Field
  battle: Battle | null = null
  party: Combatant[]

  private dialogueQueue: DialogueLine[] = []
  private dialogueIndex = 0
  private afterDialogue: (() => void) | null = null
  private currentEncounter: EncounterData | null = null
  private seenDialogues = new Set<string>()
  private turnTimer: unknown = null
  private traitId: string
  private stageIndex = 0
  private clearedStages = new Set<string>()
  private readonly monsterNames: Record<string, string>

  constructor(
    private data: GameData,
    private bus: EventBus,
    private scheduler: TurnScheduler,
    traitId?: string | null,
    /** 저장 시각 — 코어가 시계를 직접 읽지 않도록 주입받는다 */
    private now: () => number = () => 0,
  ) {
    this.traitId = resolveTraitId(data.traits, traitId)
    this.party = this.buildParty()
    this.monsterNames = Object.fromEntries(
      Object.entries(data.monsters).map(([id, m]) => [id, m.name]),
    )
    this.field = new Field(this.stage, this.monsterNames, bus, this.perceptionRadius)
  }

  /**
   * 파티는 party.json이 정한다. 배치 순서가 몹의 공격 순서 기준이 된다.
   * 특성은 플레이어 자신에게만 적용된다 — 내가 고른 플레이 스타일이기 때문이다.
   */
  private buildParty(): Combatant[] {
    const trait = this.trait
    return this.data.party.map(({ job, isPlayer }) => {
      const j = this.data.jobs[job]
      const base = { hp: j.hp, atk: j.atk, def: j.def, spd: j.spd }
      const s = isPlayer ? applyStats(base, trait, this.data.traits.limits) : base
      const c: Combatant = {
        id: job,
        name: j.name,
        side: 'ally',
        isPlayer,
        hp: s.hp,
        maxHp: s.hp,
        atk: s.atk,
        def: s.def,
        spd: s.spd,
        skill: j.skill,
        cooldownLeft: 0,
        defending: false,
        sprite: j.sprite ?? job,
      }
      if (isPlayer) applyCombat(c, trait)
      return c
    })
  }

  // --- 특성 ---

  get trait(): TraitData {
    return resolveTrait(this.data.traits, this.traitId)
  }

  get traits(): TraitsFile {
    return this.data.traits
  }

  /** 특성과 스테이지 어둠 중 좁은 쪽을 쓴다 */
  get perceptionRadius(): number | null {
    const byTrait = perceptionRadius(this.trait, this.data.traits.limits)
    const byStage = this.stage.map.darkness?.radius ?? null
    if (byTrait === null) return byStage
    if (byStage === null) return byTrait
    return Math.min(byTrait, byStage)
  }

  /**
   * 특성을 바꿀 수 있는 곳인지.
   * 이득과 대가는 한 묶음이어야 한다 — 아무 데서나 바꿀 수 있으면 필드에서는 넓게 보다가
   * 전투 직전에만 갈아 끼워 대가 없이 이득만 챙길 수 있다. 그래서 준비하는 자리
   * (타이틀과 쉼터)에서만 허용한다.
   */
  canChangeTrait(): { ok: boolean; reason?: string } {
    if (this.mode === 'title') return { ok: true }
    if (this.mode === 'battle') {
      return { ok: false, reason: '전투 중에는 특성을 바꿀 수 없다.' }
    }
    if (this.mode === 'field' && this.field.atCheckpoint) return { ok: true }
    return {
      ok: false,
      reason: '특성은 쉼터에서만 바꿀 수 있다. 이득과 대가는 한 묶음이기 때문이다.',
    }
  }

  setTrait(id: string): boolean {
    if (!this.canChangeTrait().ok) return false
    const next = resolveTraitId(this.data.traits, id)
    if (next === this.traitId) return false

    const player = this.player
    const ratio = player.hp / player.maxHp
    this.traitId = next

    const trait = this.trait
    const j = this.data.jobs[player.id]
    const s = applyStats(
      { hp: j.hp, atk: j.atk, def: j.def, spd: j.spd },
      trait,
      this.data.traits.limits,
    )
    player.maxHp = s.hp
    player.hp = Math.max(1, Math.min(s.hp, Math.round(s.hp * ratio)))
    player.atk = s.atk
    player.def = s.def
    player.spd = s.spd
    applyCombat(player, trait)

    this.field.setPerceptionRadius(this.perceptionRadius)
    this.bus.emit({ type: 'traitChanged', name: trait.name, description: trait.summary })
    return true
  }

  get currentTraitId(): string {
    return this.traitId
  }

  get player(): Combatant {
    const p = this.party.find((c) => c.isPlayer)
    if (!p) throw new Error('파티에 플레이어가 없다 — party.json을 확인할 것')
    return p
  }

  // --- 스테이지 ---

  get stage(): StageData {
    return this.data.stages[this.stageIndex]
  }

  get currentStageIndex(): number {
    return this.stageIndex
  }

  get stageCount(): number {
    return this.data.stages.length
  }

  get hasNextStage(): boolean {
    return this.stageIndex + 1 < this.stageCount
  }

  stageAt(index: number): StageData | undefined {
    return this.data.stages[index]
  }

  /**
   * 지정한 스테이지를 처음부터 시작한다.
   * 진행 중이던 것을 남김없이 정리하는 것이 이 메서드의 핵심이다 —
   * 특히 턴 타이머가 남으면 새 스테이지에서 전투가 저절로 진행된다.
   */
  startStage(index: number): void {
    if (index < 0 || index >= this.stageCount) return

    this.clearTurnTimer()
    this.battle = null
    this.currentEncounter = null
    this.paused = false
    this.pausedMidTurn = false
    this.dialogueQueue = []
    this.dialogueIndex = 0
    this.afterDialogue = null
    this.seenDialogues.clear()
    this.bus.emit({ type: 'battleEnd' })

    this.stageIndex = index
    this.party = this.buildParty()
    this.field = new Field(this.stage, this.monsterNames, this.bus, this.perceptionRadius)

    this.bus.emit({
      type: 'stageStart',
      index,
      total: this.stageCount,
      title: this.stage.title,
      objective: this.stage.objective,
    })
    this.showDialogue(this.stage.script['intro'] ?? [], () => {
      this.setMode('field')
      this.bus.emit({
        type: 'fieldSummary',
        text: '화살표 키나 화면의 방향 버튼으로 움직인다. 둘러보기를 누르면 주변을 알려준다.',
      })
    })
  }

  nextStage(): void {
    if (this.hasNextStage) this.startStage(this.stageIndex + 1)
  }

  restartStage(): void {
    this.startStage(this.stageIndex)
  }

  returnToTitle(): void {
    this.clearTurnTimer()
    this.battle = null
    this.currentEncounter = null
    this.paused = false
    this.pausedMidTurn = false
    this.dialogueQueue = []
    this.dialogueIndex = 0
    this.afterDialogue = null
    this.bus.emit({ type: 'battleEnd' })
    this.setMode('title')
  }

  // --- 저장·복원 ---

  /** 저장 가능한 상태인지. 전투·대사 중에는 복원이 어렵고 낭독 맥락도 끊긴다 */
  get canSave(): boolean {
    return this.mode === 'field'
  }

  snapshot(): SaveSnapshot {
    return {
      schemaVersion: SAVE_VERSION,
      stageIndex: this.stageIndex,
      traitId: this.traitId,
      field: {
        pos: { ...this.field.pos },
        checkpointReached: this.field.checkpointReached,
        defeated: this.field.defeatedIds,
      },
      party: this.party.map((c) => ({ id: c.id, hp: c.hp })),
      seenDialogues: [...this.seenDialogues],
      clearedStages: [...this.clearedStages],
      updatedAt: this.now(),
    }
  }

  /** 검증을 마친 스냅샷만 받는다 — 검사 책임은 sanitizeSnapshot이 진다 */
  restore(s: SaveSnapshot): void {
    this.clearTurnTimer()
    this.battle = null
    this.currentEncounter = null
    this.paused = false
    this.pausedMidTurn = false
    this.dialogueQueue = []
    this.dialogueIndex = 0
    this.afterDialogue = null
    this.bus.emit({ type: 'battleEnd' })

    this.stageIndex = s.stageIndex
    this.traitId = s.traitId
    this.clearedStages = new Set(s.clearedStages)
    this.seenDialogues = new Set(s.seenDialogues)
    this.party = this.buildParty()
    for (const saved of s.party) {
      const c = this.party.find((p) => p.id === saved.id)
      if (c) c.hp = Math.min(c.maxHp, Math.max(0, saved.hp))
    }
    this.field = new Field(this.stage, this.monsterNames, this.bus, this.perceptionRadius)
    this.field.restore(s.field.pos, s.field.checkpointReached, s.field.defeated)

    this.bus.emit({
      type: 'stageStart',
      index: this.stageIndex,
      total: this.stageCount,
      title: this.stage.title,
      objective: this.stage.objective,
    })
    this.setMode('field')
    this.bus.emit({ type: 'fieldSummary', text: this.field.summary() })
  }

  get clearedStageIds(): string[] {
    return [...this.clearedStages]
  }

  // --- 흐름 ---

  start(): void {
    this.startStage(0)
  }

  private setMode(mode: GameMode): void {
    this.mode = mode
    this.bus.emit({ type: 'mode', mode })
  }

  private showDialogue(lines: DialogueLine[], after: () => void): void {
    if (lines.length === 0) {
      after()
      return
    }
    this.dialogueQueue = lines
    this.dialogueIndex = 0
    this.afterDialogue = after
    this.setMode('dialogue')
    this.emitDialogueLine()
  }

  private emitDialogueLine(): void {
    this.bus.emit({
      type: 'dialogue',
      line: this.dialogueQueue[this.dialogueIndex],
      last: this.dialogueIndex === this.dialogueQueue.length - 1,
    })
  }

  advanceDialogue(): void {
    if (this.mode !== 'dialogue') return
    this.dialogueIndex += 1
    if (this.dialogueIndex < this.dialogueQueue.length) {
      this.emitDialogueLine()
    } else {
      const after = this.afterDialogue
      this.afterDialogue = null
      after?.()
    }
  }

  // --- 필드 ---

  moveField(dir: Dir): void {
    if (this.mode !== 'field') return
    const wasAtCheckpoint = this.field.checkpointReached
    const encounter = this.field.move(dir)
    if (encounter) {
      this.enterBattle(encounter)
      return
    }
    // 쉼터에 처음 도착하면 보스 전 대사
    if (!wasAtCheckpoint && this.field.checkpointReached) {
      this.showDialogue(this.stage.script['beforeBoss'] ?? [], () =>
        this.setMode('field'),
      )
    }
  }

  /** 조우에 보스 몹이 포함되는지 — 렌더러의 표시용 */
  isBossEncounter(encounter: EncounterData): boolean {
    return encounter.monsters.some((id) => this.data.monsters[id]?.isBoss)
  }

  /** 몹 id의 스프라이트 키 — 렌더러가 데이터를 직접 뒤지지 않게 한다 */
  spriteOfMonster(id: string): string | undefined {
    return this.data.monsters[id]?.sprite
  }

  fieldSummary(): void {
    if (this.mode !== 'field') return
    this.bus.emit({ type: 'fieldSummary', text: this.field.summary() })
  }

  // --- 전투 ---

  private enterBattle(encounter: EncounterData): void {
    const begin = () => {
      this.currentEncounter = encounter
      this.battle = new Battle(
        this.party,
        encounter.monsters,
        this.data.monsters,
        this.bus,
      )
      // 화면(전투 UI)이 먼저 준비돼야 시작 안내가 로그·낭독에 실린다
      this.setMode('battle')
      this.battle.begin()
      this.stepBattle()
    }
    const dialogueKey = encounter.dialogue
    if (dialogueKey && !this.seenDialogues.has(dialogueKey)) {
      this.seenDialogues.add(dialogueKey)
      this.showDialogue(this.stage.script[dialogueKey] ?? [], begin)
    } else {
      begin()
    }
  }

  private stepBattle(): void {
    if (!this.battle) return
    this.handleStep(this.battle.step())
  }

  playerAction(action: PlayerAction): void {
    if (!this.battle || this.mode !== 'battle') return
    const result = this.battle.playerAction(action)
    // null이면 규칙상 무효한 입력(내 차례 아님, 쿨다운 등) — 아무 일도 없다
    if (result !== null) this.handleStep(result)
  }

  private handleStep(result: StepResult): void {
    if (!this.battle) return
    switch (result) {
      case 'victory':
        return this.onVictory()
      case 'defeat':
        return this.onDefeat()
      case 'waiting-player':
        // 플레이어 입력을 기다린다 — 타이머를 걸지 않는다
        return this.clearTurnTimer()
      case 'continue':
        // 다음 턴으로 — 낭독이 따라오도록 간격을 두고 진행
        this.clearTurnTimer()
        this.turnTimer = this.scheduler.schedule(() => this.stepBattle(), TURN_DELAY)
        return
      default: {
        const never: never = result
        throw new Error(`처리되지 않은 전투 상태: ${never}`)
      }
    }
  }

  private clearTurnTimer(): void {
    if (this.turnTimer !== null) {
      this.scheduler.cancel(this.turnTimer)
      this.turnTimer = null
    }
  }

  // --- 일시정지 (옵션 화면이 열려 있는 동안) ---

  private paused = false
  private pausedMidTurn = false

  pause(): void {
    if (this.paused) return
    this.paused = true
    if (this.turnTimer !== null) {
      this.pausedMidTurn = true
      this.clearTurnTimer()
    }
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    if (this.pausedMidTurn) {
      this.pausedMidTurn = false
      this.turnTimer = this.scheduler.schedule(() => this.stepBattle(), TURN_DELAY)
    }
  }

  battleSummary(): void {
    if (!this.battle || this.mode !== 'battle') return
    this.bus.emit({ type: 'battleSummary', text: this.battle.summary() })
  }

  private onVictory(): void {
    const wasBoss = this.battle?.isBossBattle ?? false
    if (this.currentEncounter) this.field.removeEncounter(this.currentEncounter.id)
    this.endBattle()
    if (wasBoss) {
      this.clearedStages.add(this.stage.id)
      this.showDialogue(this.stage.script['clear'] ?? [], () => {
        this.setMode('clear')
        this.bus.emit({
          type: 'stageClear',
          index: this.stageIndex,
          total: this.stageCount,
          hasNext: this.hasNextStage,
        })
      })
    } else {
      this.setMode('field')
      // 전투 후 위치 감각을 되찾도록 주변을 알려준다
      this.bus.emit({ type: 'fieldSummary', text: this.field.summary() })
    }
  }

  private onDefeat(): void {
    this.endBattle()
    // 관대한 재시작: 체크포인트에서 전원 완전 회복, 페널티 없음
    for (const a of this.party) {
      a.hp = a.maxHp
      a.cooldownLeft = 0
      a.defending = false
    }
    this.field.respawn()
    this.setMode('field')
    // 순간이동한 위치를 반드시 알려준다 — 공간 지도를 잃지 않도록
    this.bus.emit({ type: 'fieldSummary', text: this.field.summary() })
  }

  private endBattle(): void {
    this.clearTurnTimer()
    this.battle = null
    this.currentEncounter = null
    this.bus.emit({ type: 'battleEnd' })
  }

}
