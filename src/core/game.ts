import { Battle, type StepResult } from './battle'
import type { EventBus, GameMode } from './events'
import { Field } from './field'
import type {
  Combatant,
  DialogueLine,
  Dir,
  EncounterData,
  GameData,
  Options,
  PlayerAction,
} from './types'

const OPTIONS_KEY = 'moduquest-options'

const DEFAULT_OPTIONS: Options = {
  captions: true,
  lowStim: false,
  volume: 0.8,
  textLarge: false,
}

/** NPC·몹 턴 사이 간격(ms). 낭독이 따라올 시간을 준다. */
const TURN_DELAY = 900

export class Game {
  mode: GameMode = 'title'
  field: Field
  battle: Battle | null = null
  party: Combatant[]
  options: Options

  private dialogueQueue: DialogueLine[] = []
  private dialogueIndex = 0
  private afterDialogue: (() => void) | null = null
  private currentEncounter: EncounterData | null = null
  private firstBattleSeen = false
  private turnTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private data: GameData,
    private bus: EventBus,
  ) {
    this.party = this.buildParty()
    const monsterNames = Object.fromEntries(
      Object.entries(data.monsters).map(([id, m]) => [id, m.name]),
    )
    this.field = new Field(data.stage, monsterNames, bus)
    this.options = this.loadOptions()
  }

  /** 파티 구성: 플레이어=도적, 동료=전사·힐러. 배치 순서가 몹의 공격 순서 기준이 된다. */
  private buildParty(): Combatant[] {
    const make = (jobId: string, isPlayer: boolean): Combatant => {
      const j = this.data.jobs[jobId]
      return {
        id: jobId,
        name: j.name,
        side: 'ally',
        isPlayer,
        hp: j.hp,
        maxHp: j.hp,
        atk: j.atk,
        def: j.def,
        spd: j.spd,
        skill: j.skill,
        cooldownLeft: 0,
        defending: false,
      }
    }
    return [make('rogue', true), make('warrior', false), make('healer', false)]
  }

  get player(): Combatant {
    return this.party[0]
  }

  get stage() {
    return this.data.stage
  }

  // --- 흐름 ---

  start(): void {
    this.showDialogue(this.data.stage.script.intro, () => {
      this.setMode('field')
      this.bus.emit({
        type: 'fieldSummary',
        text: '화살표 키로 움직인다. R 키를 누르면 주변을 알려준다.',
      })
    })
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
      this.showDialogue(this.data.stage.script.beforeBoss, () => this.setMode('field'))
    }
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
      this.setMode('battle')
      this.stepBattle()
    }
    if (!this.firstBattleSeen && encounter.id === 'e1') {
      this.firstBattleSeen = true
      this.showDialogue(this.data.stage.script.firstBattle, begin)
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
        this.turnTimer = setTimeout(() => this.stepBattle(), TURN_DELAY)
        return
      default: {
        const never: never = result
        throw new Error(`처리되지 않은 전투 상태: ${never}`)
      }
    }
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer)
      this.turnTimer = null
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
      this.showDialogue(this.data.stage.script.clear, () => {
        this.setMode('clear')
        this.bus.emit({ type: 'stageClear' })
      })
    } else {
      this.setMode('field')
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
  }

  private endBattle(): void {
    this.clearTurnTimer()
    this.battle = null
    this.currentEncounter = null
    this.bus.emit({ type: 'battleEnd' })
  }

  restart(): void {
    window.location.reload()
  }

  // --- 옵션 ---

  private loadOptions(): Options {
    try {
      const raw = localStorage.getItem(OPTIONS_KEY)
      if (raw) return { ...DEFAULT_OPTIONS, ...JSON.parse(raw) }
    } catch {
      // 저장값이 깨졌으면 기본값으로
    }
    return { ...DEFAULT_OPTIONS }
  }

  setOption<K extends keyof Options>(key: K, value: Options[K]): void {
    this.options[key] = value
    localStorage.setItem(OPTIONS_KEY, JSON.stringify(this.options))
    this.bus.emit({ type: 'optionsChanged' })
  }
}
