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
  /** 소모 마력. 없으면 0 — 마력을 쓰지 않는 몸 기술이다 */
  mpCost?: number
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
  /** 최대 마력. 0이면 마력을 쓰지 않는 직업 */
  mp: number
  /** 라운드마다 돌아오는 마력 — 확률이 아니라 정해진 양이다 */
  mpRegen: number
  atk: number
  def: number
  spd: number
  /** 배열 순서가 NPC의 사용 우선순위다 */
  skills: SkillData[]
  advantages: Record<string, number>
}

/**
 * 몹이 누구를 노리는가. 도발은 어느 쪽이든 덮어쓴다 — 그래야 탱커가 의미를 갖는다.
 * - front: 배치 순서상 첫 생존 아군. 앞에 보이는 것을 친다
 * - weakest: 체력 비율이 가장 낮은 아군. 쓰러뜨릴 수 있는 쪽을 노린다
 * - breaker: 방어가 가장 낮은 아군. 가장 아프게 들어가는 쪽을 고른다
 */
export type MonsterAi = 'front' | 'weakest' | 'breaker'

export interface MonsterData {
  name: string
  sprite: string
  /** 생략하면 front — 하급 몹의 기본값이다 */
  ai?: MonsterAi
  hp: number
  atk: number
  def: number
  spd: number
  /** 처치 시 파티가 얻는 경험치 — 고정값이라 결정적이다 */
  xp?: number
  /**
   * 드랍 순환 목록. N번째 처치는 drops[(N-1) % 길이]를 준다(null = 없음).
   * 확률처럼 보이지만 셀 수 있는 규칙이다.
   * 보스는 다르다: 첫 처치는 firstDrops 전부(고정 보상), 재처치부터 이 순환을 탄다 —
   * "고급이 더 자주"는 순환에서 고급 칸을 더 많이 배치하는 것으로 번역된다.
   */
  drops?: (string | null)[]
  /** 보스 전용 — 처음 잡았을 때 반드시 주는 것들 */
  firstDrops?: string[]
  isBoss?: boolean
}

export type ItemKind = 'consumable' | 'equipment' | 'keepsake'
export type EquipSlot = 'weapon' | 'armor' | 'shoes' | 'gloves'
/** 능력치 묶음 — 장비·세트·오라가 같은 모양을 쓴다 */
export interface StatBlock {
  hp?: number
  mp?: number
  atk?: number
  def?: number
  spd?: number
}

/** 세트 — 같은 세트를 pieces개 이상 착용하면 보너스가 붙는다 */
export interface SetData {
  name: string
  pieces: number
  bonus: StatBlock
}

export interface ItemData {
  name: string
  /** 맛과 이야기만 담는다 — 수치는 필드에서 조립해 두 곳이 어긋나지 않게 */
  description: string
  kind: ItemKind
  // 소모품 효과 — 조합 가능. 체력은 어디서나, 마력·대기 감소는 전투에서만 의미가 있다
  heal?: number
  mana?: number
  /** 대상의 모든 기술 남은 대기를 즉시 이만큼 줄인다 (바닥은 0) */
  cooldownCut?: number
  // 장비
  slot?: EquipSlot
  /** 1 일반 · 2 정련 · 3 울림 */
  tier?: 1 | 2 | 3
  stats?: StatBlock
  /** 오라 — 착용자를 제외한 파티 전원에게 적용. "함께"의 수치화다 */
  allyStats?: StatBlock
  /** 이 레벨부터 착용할 수 있다 */
  minLevel?: number
  set?: string
  /**
   * 착용 시 형상 변화 — 아이템은 색만 주고, 어느 픽셀이 그 슬롯인지는
   * 스프라이트 쪽(slotKeys)이 선언한다. 직업마다 팔레트 글자가 달라서다.
   */
  recolor?: { primary: string; secondary?: string }
}

/** 강화할 수 있는 능력치 — 마력은 뺀다. 특성이 마력을 건드리지 않는 것과 같은 결이다 */
export type UpgradeStat = 'hp' | 'atk' | 'def' | 'spd'

/**
 * 마을 경제. 가격에도 확률이 없다 — 여기 적힌 수가 곧 게임 안의 수이고,
 * 도움말이 이 표를 그대로 옮겨 적는다.
 */
export interface EconomyData {
  /** 처치 경험치 1당 받는 동전. 몹마다 값을 따로 두지 않아 경험치 밸런스와 자동으로 맞는다 */
  goldPerXp: number
  shop: {
    /** 파는 물건과 값. 여기 없는 것은 상점에 없다 */
    stock: Record<string, number>
  }
  /** 되파는 값. 소모품은 한 값, 장비는 등급으로 정한다 */
  sell: { consumable: number; byTier: Record<string, number> }
  /** 장비를 분해해 얻는 강화 재료 수 */
  dismantle: { byTier: Record<string, number> }
  upgrade: {
    stats: UpgradeStat[]
    /** 한 단계당 오르는 양 */
    gainPerLevel: Record<UpgradeStat, number>
    maxLevel: number
    /** costs[n]이 n+1단계로 올리는 값. 길이는 maxLevel과 같다 */
    costs: { gold: number; materials: number }[]
  }
}

export interface ProgressionData {
  /** 레벨 n이 되는 데 필요한 누적 경험치. 길이가 곧 최대 레벨 */
  xpTable: number[]
  /** 스테이지 진입 시 최소 보장 경험치 — 마이그레이션과 밸런스 검증의 기준선 */
  stageEntryXp: number[]
  /** 직업별 레벨당 성장 */
  growth: Record<string, { hp: number; mp: number; atk: number; def: number; spd: number }>
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

/** 구역이 선언하는 조우. 자리(pos)는 변형이 정한다 */
export interface AreaEncounterData {
  id: string
  monsters: string[]
  /** 이 조우 직전에 1회 재생할 대사 스크립트 키 */
  dialogue?: string
}

/**
 * 구역과 구역을 잇는 문. 짝 출구를 가리키고, 상대도 반드시 이쪽을 가리킨다.
 * 이름과 note는 낭독용 — 갈림길을 "헤매기"가 아니라 "고르기"로 만드는 문장이다.
 */
export interface ExitData {
  id: string
  name: string
  note?: string
  /** '<구역id>:<출구id>' */
  to: string
}

/**
 * 손으로 그린 지도 한 장. **좌표만 담는다** — 조우 구성·상자 내용·어둠은 구역이 갖는다.
 * 그래서 "변형끼리 난이도가 같다"는 검사할 필요가 없는 명제가 된다.
 */
export interface AreaVariant {
  /** 0=바닥, 1=벽. 그 외 값은 없다 */
  tiles: number[][]
  /** 구역이 선언한 짧은 id → 자리. 조우·상자·출구·보스가 모두 여기 있다 */
  places: Record<string, Pos>
  /** 이 구역에 쉼터가 있으면 그 자리 */
  checkpoint?: Pos
  /** 스테이지 첫 구역의 시작 칸 */
  start?: Pos
  /** 문으로 들어왔을 때 서는 칸. 생략하면 문 칸의 인접 바닥에서 유도한다 */
  entries?: Record<string, Pos>
}

export interface AreaData {
  id: string
  /** 낭독용 이름 — "굴 입구" */
  name: string
  /**
   * 구역이 강제하는 지각 반경. 특성 반경과 작은 쪽을 쓴다.
   * note는 왜 좁아졌는지 낭독에 붙일 문구 — 이유 없이 정보가 줄면 누락이고,
   * 밝히면 게임 규칙이다.
   */
  darkness?: { radius: number; note: string }
  encounters: AreaEncounterData[]
  /** 밟으면 열리는 보물상자. 내용은 고정이다 */
  chests?: { id: string; items: string[] }[]
  exits: ExitData[]
  boss?: AreaEncounterData
  /** 길이가 stage.variantCount와 정확히 같다 */
  variants: AreaVariant[]
}

export interface StageData {
  id: string
  title: string
  objective: string
  clearMessage: string
  /** 모든 구역·변형이 공유한다. 캔버스가 한 번만 만들어지기 때문이다 */
  size: { width: number; height: number }
  /** 지도를 몇 장 돌려 쓰는가. 1 이상 */
  variantCount: number
  /** 0번이 시작 구역 */
  areas: AreaData[]
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
  /** 지도 순환의 자리 번호 — 같은 기록은 언제나 같은 지도를 낸다 */
  layoutKey: number
  /** 스테이지별로 걷고 있는 지도 변형. 현재 스테이지 것도 여기서 읽는다 */
  variants: { stage: string; variant: number }[]
  field: {
    /** 지금 서 있는 구역 */
    areaId: string
    pos: Pos
    /** 어느 문으로 들어왔나. 부활 지점과 돌아가기 안내에 쓴다 */
    enteredFrom: string | null
    checkpointReached: boolean
    defeated: string[]
    openedChests: string[]
  }
  inventory: { item: string; count: number }[]
  /** 몹 종별 처치 수 — 드랍 순환의 카운터 */
  kills: { monster: string; count: number }[]
  /**
   * 파티 구성과 남은 체력, 착용 장비. 0번이 플레이어.
   * 최대 체력·능력치는 직업·레벨·특성·장비에서 다시 계산한다 — 밸런스 수정이 저장값에 박히지 않게
   */
  party: { job: string; hp: number; equipment: Partial<Record<EquipSlot, string>> }[]
  /** 레벨은 저장하지 않는다 — 경험치에서 유도한다(단일 진실 원천) */
  xp: number
  /** 마을에서 쓰는 동전 */
  gold: number
  /** 장비를 분해해 모은 강화 재료 */
  materials: number
  /** 파티원별·능력치별 강화 단계. 올린 것만 들어간다 */
  upgrades: { job: string; stat: string; level: number }[]
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
  progression: ProgressionData
  items: Record<string, ItemData>
  sets: Record<string, SetData>
  economy: EconomyData
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
  /** 마력. 전투 자원이라 전투 밖에서는 늘 가득이고 저장하지 않는다 */
  mp: number
  maxMp: number
  mpRegen: number
  atk: number
  def: number
  spd: number
  /** 지금 쓸 수 있는(언락된) 스킬들. cooldowns는 같은 인덱스로 대응한다 */
  skills: SkillData[]
  cooldowns: number[]
  defending: boolean
  sprite?: string
  /** 몹의 표적 선택 규칙. 아군에게는 없다 */
  ai?: MonsterAi
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
  | { kind: 'item'; itemId: string; targetId: string }
  | { kind: 'defend' }
