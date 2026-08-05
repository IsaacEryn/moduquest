/** 스킬 동작은 kind가 결정한다 — 새 스킬은 코드 수정 없이 데이터로 추가한다 */
export type SkillKind = 'damage' | 'heal' | 'taunt'
/**
 * 대상 선택 UI가 어느 목록을 보여줄지 결정한다.
 * -all은 대상 선택 없이 그쪽 전원에게 — 대상별로 개별 계산해 결정성을 지킨다
 */
export type SkillTargeting = 'enemy' | 'ally' | 'self' | 'enemy-all' | 'ally-all'

export interface SkillData {
  id: string
  name: string
  kind: SkillKind
  targeting: SkillTargeting
  cooldown: number
  description: string
  /** 이 레벨부터 쓸 수 있다. 없으면 처음부터 */
  unlockLevel?: number
  duration?: number
  multiplier?: number
  healRatio?: number
  /** 이 스킬만의 추가 관통 — 치명타의 결정적 번역 */
  pierce?: number
}

export interface JobData {
  name: string
  role: string
  /** 어떤 렌즈로 즐기는가 — 직업 선택 화면의 안내 문구 */
  playstyle?: string
  /** 스프라이트 키 — 생략하면 직업 id를 쓴다 */
  sprite?: string
  hp: number
  atk: number
  def: number
  spd: number
  /** 배열 순서가 NPC의 사용 우선순위다 */
  skills: SkillData[]
  advantages: Record<string, number>
}

export interface MonsterData {
  name: string
  sprite: string
  hp: number
  atk: number
  def: number
  spd: number
  isBoss?: boolean
}

export interface Pos {
  x: number
  y: number
}

export interface DialogueLine {
  speaker: string
  text: string
}

export interface EncounterData {
  id: string
  pos: Pos
  monsters: string[]
  /** 이 조우 직전에 1회 재생할 대사 스크립트 키 (script의 키) */
  dialogue?: string
}

export interface StageData {
  id: string
  title: string
  objective: string
  clearMessage: string
  map: {
    width: number
    height: number
    tiles: number[][]
    start: Pos
    /**
     * 스테이지가 강제하는 지각 반경. 특성 반경과 작은 쪽을 쓴다.
     * note는 왜 좁아졌는지 낭독에 붙일 문구 — 이유 없이 정보가 줄면 누락이고,
     * 밝히면 게임 규칙이다.
     */
    darkness?: { radius: number; note: string }
  }
  encounters: EncounterData[]
  checkpoint: Pos
  boss: EncounterData
  /** 대사 묶음. intro·beforeBoss·clear는 관례적 키, 그 외는 조우가 참조 */
  script: Record<string, DialogueLine[]>
}

export interface PartyMemberData {
  job: string
  isPlayer: boolean
}

/**
 * 특성 — 이득과 대가가 함께 붙은 플레이 스타일.
 * 장애 유형이 아니라 기능으로 이름 붙이고, 누구나 아무거나 고를 수 있다.
 */
export interface TraitData {
  name: string
  summary: string
  category: 'basic' | 'combat' | 'challenge'
  stats: { hp: number; atk: number; def: number; spd: number }
  combat: {
    /** 상대 방어력을 이만큼 무시한다 */
    pierce: number
    /** N번째 피격을 흘린다(피해 0). 0이면 흘리지 않는다 */
    guardEvery: number
    /** 스킬 쿨다운 가감 */
    cooldownDelta: number
  }
  /** null이면 맵 전체를 안다 */
  perception: { radius: number | null }
}

export interface TraitsFile {
  default: string
  limits: { minStat: number; minRadius: number }
  traits: Record<string, TraitData>
}

/** 저장되는 진행도. 전부 숫자·불리언·데이터에 있는 id — 자유 문자열이 없다 */
export interface SaveSnapshot {
  schemaVersion: number
  stageIndex: number
  traitId: string
  field: { pos: Pos; checkpointReached: boolean; defeated: string[] }
  /** 최대 체력·능력치는 직업과 특성에서 다시 계산한다 — 밸런스 수정이 저장값에 박히지 않게 */
  party: { id: string; hp: number }[]
  seenDialogues: string[]
  clearedStages: string[]
  updatedAt: number
}

/** 슬롯 목록 표시용 요약 */
export interface SlotSummary {
  slot: number
  empty: boolean
  stageIndex?: number
  traitId?: string
  progress?: number
  updatedAt?: number
}

export interface GameData {
  jobs: Record<string, JobData>
  monsters: Record<string, MonsterData>
  party: PartyMemberData[]
  /** 배열 순서가 진행 순서다 — 같은 사실을 두 곳에 두지 않으려고 nextStageId를 두지 않는다 */
  stages: StageData[]
  traits: TraitsFile
}

export type Dir = 'north' | 'south' | 'east' | 'west'

/** 전투 참가자. 아군은 스테이지 내내 유지되는 객체를 전투가 직접 참조한다. */
export interface Combatant {
  id: string
  name: string
  side: 'ally' | 'enemy'
  isPlayer: boolean
  hp: number
  maxHp: number
  atk: number
  def: number
  spd: number
  /** 지금 쓸 수 있는(언락된) 스킬들. cooldowns는 같은 인덱스로 대응한다 */
  skills: SkillData[]
  cooldowns: number[]
  defending: boolean
  sprite?: string
  isBoss?: boolean
  /** 상대 방어력 무시량 */
  pierce?: number
  /** N번째 피격을 흘린다. 0·미지정이면 흘리지 않는다 */
  guardEvery?: number
  /** 마지막으로 흘린 뒤 맞은 횟수 */
  hitsSinceDeflect?: number
  /** 스킬 쿨다운 가감 */
  cooldownDelta?: number
}

export type PlayerAction =
  | { kind: 'attack'; targetId: string }
  | { kind: 'skill'; skillIndex: number; targetId?: string }
  | { kind: 'defend' }
