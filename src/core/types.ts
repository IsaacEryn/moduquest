/** 스킬 동작은 kind가 결정한다 — 새 스킬은 코드 수정 없이 데이터로 추가한다 */
export type SkillKind = 'damage' | 'heal' | 'taunt'
/** 대상 선택 UI가 어느 목록을 보여줄지 결정한다 */
export type SkillTargeting = 'enemy' | 'ally' | 'self'

export interface SkillData {
  id: string
  name: string
  kind: SkillKind
  targeting: SkillTargeting
  cooldown: number
  description: string
  duration?: number
  multiplier?: number
  healRatio?: number
}

export interface JobData {
  name: string
  role: string
  /** 스프라이트 키 — 생략하면 직업 id를 쓴다 */
  sprite?: string
  hp: number
  atk: number
  def: number
  spd: number
  skill: SkillData
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

export interface GameData {
  jobs: Record<string, JobData>
  monsters: Record<string, MonsterData>
  party: PartyMemberData[]
  stage: StageData
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
  skill?: SkillData
  cooldownLeft: number
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
  | { kind: 'skill'; targetId?: string }
  | { kind: 'defend' }
