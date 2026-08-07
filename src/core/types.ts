/** 스킬 동작은 kind가 결정한다 — 새 스킬은 코드 수정 없이 데이터로 추가한다 */
export type SkillKind = 'damage' | 'heal' | 'taunt'

/**
 * 피해의 종류. 물리는 물리 방어에, 마법은 마법 방어에 막힌다.
 *
 * 규칙 하나로 관통한다: **"공격을 올린다"고 적힌 것은 그 캐릭터의 주력 타입에 얹힌다.**
 * 특성·마을 강화·동료 오라가 전부 그렇고, 타입을 명시하는 것은 장비뿐이다.
 * 그래서 마법사가 어떤 특성을 골라도 함정이 되지 않는다 — "누구나 아무거나 고를 수
 * 있다"는 원칙이 스탯이 늘어난 뒤에도 살아 있는 것은 이 규칙 덕분이다.
 */
export type DamageType = 'physical' | 'magic'
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
  /** 이 스킬만의 추가 관통 — 치명타의 결정적 번역. 대응하는 쪽 방어만 뚫는다 */
  pierce?: number
  /** 생략하면 시전자의 주력 타입 — 전사의 강타는 물리, 마법사의 화살은 마법이다 */
  damageType?: DamageType
}

export interface JobData {
  name: string
  role: string
  /**
   * 전투에서 서는 줄. 작을수록 앞이고, 하급 몹은 앞에 선 사람을 친다.
   * 도발이 없어도 탱커가 먼저 맞도록 하는 규칙이며, 앞줄이 쓰러지면 다음 사람이 앞에 선다.
   */
  frontOrder: number
  /** 어떤 렌즈로 즐기는가 — 직업 선택 화면의 안내 문구 */
  playstyle?: string
  /** 스프라이트 키 — 생략하면 직업 id를 쓴다 */
  sprite?: string
  hp: number
  /** 최대 마력. 0이면 마력을 쓰지 않는 직업 */
  mp: number
  /** 라운드마다 돌아오는 마력 — 확률이 아니라 정해진 양이다 */
  mpRegen: number
  /**
   * 이 직업이 무엇으로 싸우는가. 평타와 타입 없는 스킬이 이쪽으로 나가고,
   * 특성·강화·오라의 공격 보정도 여기에 얹힌다.
   */
  mainType: DamageType
  patk: number
  matk: number
  pdef: number
  mdef: number
  spd: number
  /** 배열 순서가 NPC의 사용 우선순위다 */
  skills: SkillData[]
}

/**
 * 몹이 누구를 노리는가. 도발은 어느 쪽이든 덮어쓴다 — 그래야 탱커가 의미를 갖는다.
 * - front: 배치 순서상 첫 생존 아군. 앞에 보이는 것을 친다
 * - weakest: 체력 비율이 가장 낮은 아군. 쓰러뜨릴 수 있는 쪽을 노린다
 * - breaker: 방어가 가장 낮은 아군. 가장 아프게 들어가는 쪽을 고른다
 */
export type MonsterAi = 'front' | 'weakest' | 'breaker'

/**
 * 몹이 받는 피해 배율. 1보다 크면 그 타입에 약하고, 작으면 강하다.
 * 확률이 아니라 고정 배율이라 한 번 배우면 영원히 같다 — 그래서 전술이 된다.
 */
export interface Resist {
  physical: number
  magic: number
}

/**
 * 보스의 큰 기술. every번째 턴마다 나가고, 그 직전 턴에 예고한다.
 *
 * 확률로 터지는 광역은 운이지만 세어서 오는 광역은 판단이다. 예고를 낭독·자막으로
 * 함께 내보내므로, 화면의 연출을 못 보는 사람도 막을지 치유할지를 똑같이 고를 수 있다.
 */
export interface MonsterPattern {
  /** 몇 번째 자기 턴마다 쓰는가 */
  every: number
  skill: SkillData
  /** 직전 턴에 내보내는 예고 문구 */
  warning: string
}

export interface MonsterData {
  name: string
  sprite: string
  /** 생략하면 front — 하급 몹의 기본값이다 */
  ai?: MonsterAi
  hp: number
  /** 무엇으로 때리는가 — 생략하면 물리 */
  attackType?: DamageType
  patk: number
  matk: number
  pdef: number
  mdef: number
  spd: number
  /** 생략하면 양쪽 1.0 — 치우침 없는 몸이다 */
  resist?: Resist
  /** 보스의 셈 기술. 하급 몹에게는 없다 */
  pattern?: MonsterPattern
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
/**
 * 능력치 묶음 — 장비·세트·오라가 같은 모양을 쓴다.
 * 여기서는 타입이 명시된다. 검은 물리 공격을, 지팡이는 마법 공격을 올린다.
 */
export interface StatBlock {
  hp?: number
  mp?: number
  patk?: number
  matk?: number
  pdef?: number
  mdef?: number
  spd?: number
}

/**
 * 오라가 주는 값 — 받는 사람이 여럿이라 타입을 명시하지 않는다.
 *
 * 장비는 자기 주인이 정해져 있으니 "이 지팡이는 마법 공격을 올린다"라고 적을 수
 * 있지만, 오라는 파티 전원에게 간다. 물리로 싸우는 동료와 마법으로 싸우는 동료가
 * 나란히 받는 값이므로, 여기 적힌 공격은 **각자의 주력**에 얹힌다.
 * 그래서 깃발 하나가 누구에게나 같은 만큼 힘이 된다.
 */
export interface AuraBlock {
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
  allyStats?: AuraBlock
  /** 이 레벨부터 착용할 수 있다 */
  minLevel?: number
  /** 이 직업들만 착용한다. 없으면 모두의 것 — 전용 장비는 그 직업다움을 세게 민다 */
  jobs?: string[]
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
  /**
   * 되파는 값. 소모품은 상점 값에 rate를 곱해서 정하고(작은 물약과 큰 물약이
   * 같은 값에 팔리지 않게), 장비는 등급으로 정한다.
   * consumable은 상점이 팔지 않는 소모품에만 쓰는 기본값이다.
   */
  sell: { rate: number; consumable: number; byTier: Record<string, number> }
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
  growth: Record<
    string,
    { hp: number; mp: number; patk: number; matk: number; pdef: number; mdef: number; spd: number }
  >
  /**
   * 승리했을 때 돌아오는 최대 체력의 비율 — 스테이지마다 다르다.
   *
   * 앞 스테이지는 넉넉하게 돌려주고 뒤로 갈수록 인색해진다. 물약이 쓸모를 갖는
   * 자리가 여기다. 한 수로 두었을 때는 이겼다 하면 늘 가득 차서, 물약이 마시는
   * 것이 아니라 파는 것이 됐다.
   */
  victoryHealRatio: number[]
  /**
   * NPC·몹 턴 사이 간격(ms). 낭독이 따라올 시간을 주는 값이라 밸런스이자 접근성이다 —
   * 여기 있어야 화면을 고치지 않고도 조절할 수 있다.
   */
  turnDelayMs: number
  /** 가방 한 칸에 담기는 개수 상한. 저장 검증도 같은 수를 읽는다 */
  itemStackMax: number
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
  /**
   * 어떤 사람에게 맞는지 — 장애 이름이 아니라 원하는 리듬과 상황으로 적는다.
   * 고르는 근거가 "무엇을 못 하는가"가 아니라 "어떻게 즐기고 싶은가"여야 한다.
   */
  fit: string
  category: TraitCategory
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

export type TraitCategory = 'basic' | 'combat' | 'challenge'

/** 특성 묶음의 이름과 안내 — 화면의 소제목이 여기서 나온다 */
export interface TraitCategoryData {
  name: string
  note: string
}

export interface TraitsFile {
  default: string
  limits: { minStat: number; minRadius: number }
  categories: Record<TraitCategory, TraitCategoryData>
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
  /**
   * 이 자리에 사람이 앉아 있는가(입력을 기다릴 대상인가).
   * "화면 앞의 나"인지는 여기서 판정하지 않는다 — 함께 하기에서는 세 자리 모두
   * 사람이지만 각자에게 "나"는 다르므로, 1인칭은 UI가 자기 좌석과 비교해 정한다.
   */
  isPlayer: boolean
  /** 파티에서의 자리 번호(0이 방장). 몹에게는 없다 */
  seat?: number
  hp: number
  maxHp: number
  /** 마력. 전투 자원이라 전투 밖에서는 늘 가득이고 저장하지 않는다 */
  mp: number
  maxMp: number
  mpRegen: number
  /** 평타와 타입 없는 스킬이 나가는 쪽 */
  mainType: DamageType
  patk: number
  matk: number
  pdef: number
  mdef: number
  spd: number
  /** 받는 피해 배율. 없으면 치우침 없음 */
  resist?: Resist
  /** 보스의 셈 기술과 지금까지 센 자기 턴 수 */
  pattern?: MonsterPattern
  turnsTaken?: number
  /** 지금 쓸 수 있는(언락된) 스킬들. cooldowns는 같은 인덱스로 대응한다 */
  skills: SkillData[]
  cooldowns: number[]
  defending: boolean
  sprite?: string
  /** 몹의 표적 선택 규칙. 아군에게는 없다 */
  ai?: MonsterAi
  /** 아군이 서는 줄. 작을수록 앞이다. 몹에게는 없다 */
  frontOrder?: number
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
