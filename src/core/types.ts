export interface SkillData {
  id: string
  name: string
  cooldown: number
  description: string
  duration?: number
  multiplier?: number
  healRatio?: number
}

export interface JobData {
  name: string
  role: string
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
}

export interface StageData {
  id: string
  title: string
  objective: string
  map: {
    width: number
    height: number
    tiles: number[][]
    start: Pos
  }
  encounters: EncounterData[]
  checkpoint: Pos
  boss: EncounterData
  script: {
    intro: DialogueLine[]
    firstBattle: DialogueLine[]
    beforeBoss: DialogueLine[]
    clear: DialogueLine[]
  }
}

export interface GameData {
  jobs: Record<string, JobData>
  monsters: Record<string, MonsterData>
  stage: StageData
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
}

export type PlayerAction =
  | { kind: 'attack'; targetId: string }
  | { kind: 'skill'; targetId?: string }
  | { kind: 'defend' }

export interface Options {
  captions: boolean
  lowStim: boolean
  volume: number
  textLarge: boolean
}
