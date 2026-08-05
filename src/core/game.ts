import { Battle, type StepResult } from './battle'
import type { EventBus, GameMode } from './events'
import { Field } from './field'
import { SAVE_VERSION } from './save'
import { nextVariant, resolveArea, type ResolvedArea } from './layout'
import { computeMemberStats, levelForXp, type StatBreakdown } from './stats'
import { applyCombat, perceptionRadius, resolveTrait, resolveTraitId } from './traits'
import type {
  Combatant,
  DialogueLine,
  Dir,
  EncounterData,
  EquipSlot,
  GameData,
  ItemData,
  JobData,
  PlayerAction,
  SaveSnapshot,
  SkillData,
  StageData,
  StatBlock,
  TraitData,
  TraitsFile,
  UpgradeStat,
} from './types'

/** 슬롯 고정 순서 — 상태창 표시와 텍스처 키 조립이 이 순서를 공유한다 */
export const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'armor', 'shoes', 'gloves']
export const SLOT_KO: Record<EquipSlot, string> = {
  weapon: '무기',
  armor: '갑옷',
  shoes: '신발',
  gloves: '장갑',
}

export const UPGRADE_STAT_KO: Record<UpgradeStat, string> = {
  hp: '체력',
  atk: '공격',
  def: '방어',
  spd: '속도',
}

/** 한 칸에 담기는 개수 상한. 저장 검증도 같은 수를 쓴다 */
export const ITEM_STACK_MAX = 99

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
  /** 현재 파티 구성. 0번이 플레이어다 */
  private partyJobs: string[]

  constructor(
    private data: GameData,
    private bus: EventBus,
    private scheduler: TurnScheduler,
    traitId?: string | null,
    /** 저장 시각 — 코어가 시계를 직접 읽지 않도록 주입받는다 */
    private now: () => number = () => 0,
    /** 지도 순환의 자리 번호. 코어는 이것이 저장 자리인지 모른다 */
    private layoutKeyOf: () => number = () => 0,
  ) {
    this.traitId = resolveTraitId(data.traits, traitId)
    this.partyJobs = data.party.map((p) => p.job)
    this.party = this.buildParty()
    this.monsterNames = Object.fromEntries(
      Object.entries(data.monsters).map(([id, m]) => [id, m.name]),
    )
    const area = this.resolveFirstArea()
    this.field = new Field(area, this.monsterNames, bus, this.radiusFor(area))
  }

  // --- 지도 구역과 변형 ---

  /** 이 모험의 지도 순환 자리 */
  private layoutKey = 0
  /** 스테이지별로 걷고 있는 변형 */
  private variantOf = new Map<string, number>()

  private get variantIndex(): number {
    return this.variantOf.get(this.stage.id) ?? 0
  }

  private resolveFirstArea(): ResolvedArea {
    return resolveArea(this.stage, this.stage.areas[0].id, this.variantIndex)
  }

  /**
   * 특성과 구역 어둠 중 좁은 쪽. Field가 생기기 전에도 필요해서 area를 직접 받는다 —
   * 생성자가 Field보다 먼저 반경을 알아야 하는 닭과 달걀 때문이다.
   */
  private radiusFor(area: ResolvedArea): number | null {
    const byTrait = perceptionRadius(this.trait, this.data.traits.limits)
    const byArea = area.darkness?.radius ?? null
    if (byTrait === null) return byArea
    if (byArea === null) return byTrait
    return Math.min(byTrait, byArea)
  }

  /**
   * 구역 전환 — 지도만 갈아 끼우는 가벼운 길이다.
   * 파티·경험치·본 대사·장비·처치 수·턴 타이머를 건드리지 않는다.
   * 무거운 초기화가 필요하면 startStage를 쓸 것.
   */
  private enterArea(
    areaId: string,
    fromExitId: string | null,
    reason: 'start' | 'exit' | 'respawn',
  ): void {
    const area = resolveArea(this.stage, areaId, this.variantIndex)
    const fromExitName =
      fromExitId === null
        ? null
        : (area.exits.find((e) => e.id.endsWith(`-${fromExitId}`))?.name ?? null)
    this.field.enterArea(area, fromExitId)
    this.field.setPerceptionRadius(this.radiusFor(area))
    this.bus.emit({
      type: 'areaChanged',
      areaId: area.areaId,
      areaName: area.areaName,
      index: area.index,
      total: area.total,
      fromExitName,
      reason,
    })
    this.bus.emit({ type: 'fieldSummary', text: this.field.summary(this.stage.objective) })
    // 입구 칸이 쉼터일 수도 있다 — move()를 거치지 않는 길이라 여기서도 판정한다
    if (this.field.reachCheckpoint()) this.beforeBossDialogue()
  }

  /** 쉼터에 처음 도착하면 보스 전 대사. 도착 판정 자체는 Field가 한다 */
  private beforeBossDialogue(): void {
    this.showDialogue(this.stage.script['beforeBoss'] ?? [], () => this.setMode('field'))
  }

  /**
   * 파티는 구성(partyJobs)이 정한다. 배치 순서가 몹의 공격 순서 기준이 된다.
   * 능력치 계산은 computeMemberStats 한 곳 — 상태창도 같은 함수를 읽는다.
   */
  private buildParty(): Combatant[] {
    const trait = this.trait
    return this.partyJobs.map((job, index) => {
      const isPlayer = index === 0
      const j = this.data.jobs[job]
      const s = this.breakdownFor(job).total
      const c: Combatant = {
        id: job,
        name: j.name,
        side: 'ally',
        isPlayer,
        hp: s.hp,
        maxHp: s.hp,
        mp: s.mp,
        maxMp: s.mp,
        mpRegen: j.mpRegen,
        atk: s.atk,
        def: s.def,
        spd: s.spd,
        skills: this.unlockedSkills(j),
        cooldowns: [],
        defending: false,
        sprite: j.sprite ?? job,
        frontOrder: j.frontOrder,
      }
      if (isPlayer) applyCombat(c, trait)
      return c
    })
  }

  /**
   * 파티를 다시 계산하되 체력 비율을 보존한다 — 특성·레벨·장비가 바뀌는 모든 길이
   * 여기를 지난다. 쓰러진 동료는 재계산으로 살아나지 않는다.
   * 전투 중에는 부르지 않는다 — 전투가 이전 객체를 직접 참조하기 때문이다.
   */
  private refreshParty(): void {
    const prev = this.party
    this.party = this.buildParty()
    for (const c of this.party) {
      const old = prev.find((p) => p.id === c.id)
      if (!old) continue
      if (old.hp <= 0) {
        c.hp = 0
        continue
      }
      c.hp = Math.max(1, Math.min(c.maxHp, Math.round(c.maxHp * (old.hp / old.maxHp))))
    }
  }

  // --- 특성 ---

  get trait(): TraitData {
    return resolveTrait(this.data.traits, this.traitId)
  }

  get traits(): TraitsFile {
    return this.data.traits
  }

  get jobs(): Record<string, JobData> {
    return this.data.jobs
  }

  /** 특성과 지금 구역의 어둠 중 좁은 쪽을 쓴다 */
  get perceptionRadius(): number | null {
    return this.radiusFor(this.field.currentArea)
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
    this.traitId = next
    // 전체 재계산 한 길로 — 예전엔 직업 기본값에서 다시 계산해 성장·장비가 날아갔다
    this.refreshParty()
    this.field.setPerceptionRadius(this.perceptionRadius)
    const trait = this.trait
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

  /** 지금 레벨에서 쓸 수 있는 스킬만 */
  private unlockedSkills(j: JobData): SkillData[] {
    const level = this.partyLevel
    return j.skills.filter((s) => (s.unlockLevel ?? 1) <= level)
  }

  // --- 경험치·레벨 ---

  private xp = 0

  get currentXp(): number {
    return this.xp
  }

  /** 레벨은 경험치에서 유도한다 — 두 값이 어긋날 일이 없다 */
  get partyLevel(): number {
    return levelForXp(this.data.progression.xpTable, this.xp)
  }

  /** 다음 레벨까지 남은 경험치. 최고 레벨이면 null */
  get xpToNext(): number | null {
    const table = this.data.progression.xpTable
    const next = table[this.partyLevel]
    return next === undefined ? null : next - this.xp
  }

  /**
   * 경험치를 더하고 레벨이 올랐으면 파티를 다시 계산한다.
   * 체력은 비율을 유지한다 — 레벨업이 곧 회복이 되지 않게.
   */
  private gainXp(amount: number): void {
    if (amount <= 0) return
    const before = this.partyLevel
    this.xp += amount
    this.bus.emit({
      type: 'xpGained',
      amount,
      total: this.xp,
      toNext: this.xpToNext,
    })
    const after = this.partyLevel
    if (after === before) return

    // 이번 레벨업으로 새로 열린 스킬 목록
    const unlocked: { jobName: string; skillName: string }[] = []
    for (const job of this.partyJobs) {
      for (const s of this.data.jobs[job].skills) {
        const lv = s.unlockLevel ?? 1
        if (lv > before && lv <= after) {
          unlocked.push({ jobName: this.data.jobs[job].name, skillName: s.name })
        }
      }
    }

    this.refreshParty()
    this.bus.emit({ type: 'levelUp', level: after, unlocked })
  }

  get currentPartyJobs(): string[] {
    return [...this.partyJobs]
  }

  // --- 장비 ---

  /** 파티원(직업 id)별 착용 장비. 직업은 파티에 하나뿐이라 키로 안전하다 */
  private equipment = new Map<string, Partial<Record<EquipSlot, string>>>()

  /** 착용 중인 장비를 데이터로 해석한다 */
  private equippedItems(job: string): ItemData[] {
    const eq = this.equipment.get(job)
    if (!eq) return []
    return Object.values(eq)
      .filter((id): id is string => !!id)
      .map((id) => this.data.items[id])
      .filter(Boolean)
  }

  /** 다른 파티원 장비의 오라 합 — 함께 걷는 사람이 나를 강하게 한다 */
  private auraFor(job: string): StatBlock {
    const out = { hp: 0, mp: 0, atk: 0, def: 0, spd: 0 }
    for (const other of this.partyJobs) {
      if (other === job) continue
      for (const item of this.equippedItems(other)) {
        const a = item.allyStats
        if (!a) continue
        out.hp += a.hp ?? 0
        out.mp += a.mp ?? 0
        out.atk += a.atk ?? 0
        out.def += a.def ?? 0
        out.spd += a.spd ?? 0
      }
    }
    return out
  }

  /** 능력치 내역 — buildParty와 상태창이 같은 결과를 읽는다 */
  private breakdownFor(job: string): StatBreakdown {
    const isPlayer = this.partyJobs[0] === job
    return computeMemberStats({
      job: this.data.jobs[job],
      growth: this.data.progression.growth[job],
      level: this.partyLevel,
      upgrade: this.upgradeStatsFor(job),
      equipment: this.equippedItems(job),
      auraFromOthers: this.auraFor(job),
      sets: this.data.sets,
      trait: isPlayer ? this.trait : null,
      limits: this.data.traits.limits,
    })
  }

  /** 상태창 표시용 — 계산과 표시가 어긋날 수 없도록 같은 함수를 쓴다 */
  statBreakdownOf(memberId: string): StatBreakdown | null {
    if (!this.partyJobs.includes(memberId)) return null
    return this.breakdownFor(memberId)
  }

  equipmentOf(memberId: string): Partial<Record<EquipSlot, string>> {
    return { ...(this.equipment.get(memberId) ?? {}) }
  }

  itemData(id: string): ItemData | undefined {
    return this.data.items[id]
  }

  /**
   * 파티원의 형상 변형 상태 — 렌더러가 텍스처 키를 만들 결정적 문자열과
   * 슬롯별 색을 준다. 리컬러가 없으면 null(기본 텍스처를 그대로 쓴다).
   */
  equipVariantOf(memberId: string): {
    variant: string
    recolors: Partial<Record<EquipSlot, { primary: string; secondary?: string }>>
  } | null {
    const eq = this.equipment.get(memberId)
    if (!eq) return null
    const recolors: Partial<Record<EquipSlot, { primary: string; secondary?: string }>> = {}
    const parts: string[] = []
    for (const slot of EQUIP_SLOTS) {
      const id = eq[slot]
      const item = id ? this.data.items[id] : undefined
      if (!item?.recolor) continue
      recolors[slot] = item.recolor
      parts.push(id as string)
    }
    if (parts.length === 0) return null
    return { variant: parts.join('+'), recolors }
  }

  setData(id: string) {
    return this.data.sets[id]
  }

  /** 입을 수 있는지 — 거절 이유를 돌려줘 UI가 그대로 낭독한다 */
  canEquip(memberId: string, itemId: string): { ok: boolean; reason?: string } {
    if (this.mode !== 'field' && this.mode !== 'title') {
      return { ok: false, reason: '지금은 장비를 바꿀 수 없다.' }
    }
    if (!this.partyJobs.includes(memberId)) return { ok: false }
    const item = this.data.items[itemId]
    if (!item || item.kind !== 'equipment' || !item.slot) {
      return { ok: false, reason: '입을 수 있는 것이 아니다.' }
    }
    if ((this.inventory.get(itemId) ?? 0) <= 0) return { ok: false, reason: '가방에 없다.' }
    if ((item.minLevel ?? 1) > this.partyLevel) {
      return { ok: false, reason: `${item.minLevel}레벨부터 입을 수 있다.` }
    }
    return { ok: true }
  }

  /** 착용. 슬롯이 차 있으면 맞교환 — 중간 상태 없이 한 동작이다 */
  equip(memberId: string, itemId: string): boolean {
    if (!this.canEquip(memberId, itemId).ok) return false
    const item = this.data.items[itemId]
    const slot = item.slot as EquipSlot
    this.consumeItem(itemId)
    const eq = this.equipment.get(memberId) ?? {}
    const prev = eq[slot]
    if (prev) this.addItem(prev)
    eq[slot] = itemId
    this.equipment.set(memberId, eq)
    this.refreshParty()
    const member = this.party.find((c) => c.id === memberId)
    this.bus.emit({
      type: 'equipChanged',
      memberName: member?.name ?? '',
      isPlayer: member?.isPlayer ?? false,
      slot,
      itemName: item.name,
      removedName: prev ? (this.data.items[prev]?.name ?? null) : null,
    })
    return true
  }

  unequip(memberId: string, slot: EquipSlot): boolean {
    if (this.mode !== 'field' && this.mode !== 'title') return false
    const eq = this.equipment.get(memberId)
    const id = eq?.[slot]
    if (!eq || !id) return false
    delete eq[slot]
    this.addItem(id)
    this.refreshParty()
    const member = this.party.find((c) => c.id === memberId)
    this.bus.emit({
      type: 'equipChanged',
      memberName: member?.name ?? '',
      isPlayer: member?.isPlayer ?? false,
      slot,
      itemName: null,
      removedName: this.data.items[id]?.name ?? null,
    })
    return true
  }

  // --- 마을 경제 ---

  private gold = 0
  private materials = 0
  /** 파티원(직업 id)별·능력치별 강화 단계. 올린 것만 들어간다 */
  private upgrades = new Map<string, Partial<Record<UpgradeStat, number>>>()

  get currentGold(): number {
    return this.gold
  }

  get currentMaterials(): number {
    return this.materials
  }

  /** 강화 단계를 실제 능력치로 편다 — 단계는 저장하고, 곱한 값은 저장하지 않는다 */
  private upgradeStatsFor(job: string): StatBlock {
    const up = this.upgrades.get(job)
    if (!up) return {}
    const gain = this.data.economy.upgrade.gainPerLevel
    const out: StatBlock = {}
    for (const stat of this.data.economy.upgrade.stats) {
      const level = up[stat] ?? 0
      if (level > 0) out[stat] = level * (gain[stat] ?? 0)
    }
    return out
  }

  /**
   * 마을에 들를 수 있는 곳인지. 특성과 같은 규칙이다 —
   * 준비하는 자리(쉼터)와 스테이지를 마친 뒤에만 들른다.
   */
  canVisitTown(): { ok: boolean; reason?: string } {
    if (this.mode === 'clear') return { ok: true }
    if (this.mode === 'field' && this.field.atCheckpoint) return { ok: true }
    return { ok: false, reason: '마을에는 쉼터에서만 들를 수 있다.' }
  }

  /** 상점 진열대. 파는 물건과 값은 데이터가 정하고, 없는 것은 팔지 않는다 */
  get shopStock(): {
    id: string
    name: string
    description: string
    price: number
    owned: number
  }[] {
    return Object.entries(this.data.economy.shop.stock)
      .filter(([id]) => this.data.items[id])
      .map(([id, price]) => ({
        id,
        name: this.data.items[id].name,
        description: this.data.items[id].description,
        price,
        owned: this.inventory.get(id) ?? 0,
      }))
  }

  canBuy(itemId: string): { ok: boolean; reason?: string } {
    if (!this.canVisitTown().ok) return { ok: false, reason: '마을에서만 살 수 있다.' }
    const price = this.data.economy.shop.stock[itemId]
    if (price === undefined || !this.data.items[itemId]) {
      return { ok: false, reason: '상점에 없는 물건이다.' }
    }
    if (this.gold < price) return { ok: false, reason: `동전이 ${price - this.gold}냥 모자라다.` }
    if ((this.inventory.get(itemId) ?? 0) >= ITEM_STACK_MAX) {
      return { ok: false, reason: `가방에 ${ITEM_STACK_MAX}개까지만 넣을 수 있다.` }
    }
    return { ok: true }
  }

  buy(itemId: string): boolean {
    if (!this.canBuy(itemId).ok) return false
    const price = this.data.economy.shop.stock[itemId]
    this.gold -= price
    this.addItem(itemId)
    this.bus.emit({
      type: 'bought',
      name: this.data.items[itemId].name,
      price,
      gold: this.gold,
    })
    return true
  }

  /**
   * 되파는 값. 팔 수 없는 것은 null이다.
   * 목록을 따로 두지 않고 아이템 자체에서 읽는다 — 추억의 물건과
   * 일행을 비추는 오라 장비는 다시 구할 길이 없어 손에서 놓지 못하게 한다.
   */
  sellValueOf(itemId: string): number | null {
    const item = this.data.items[itemId]
    if (!item) return null
    if (item.kind === 'consumable') return this.data.economy.sell.consumable
    if (item.kind !== 'equipment' || !item.tier) return null
    if (item.allyStats) return null
    return this.data.economy.sell.byTier[String(item.tier)] ?? null
  }

  /** 분해해 얻는 강화 재료 수. 장비만, 오라 장비는 제외 */
  dismantleYieldOf(itemId: string): number | null {
    const item = this.data.items[itemId]
    if (!item || item.kind !== 'equipment' || !item.tier) return null
    if (item.allyStats) return null
    return this.data.economy.dismantle.byTier[String(item.tier)] ?? null
  }

  /** 팔거나 분해할 수 없는 이유 — 두 곳이 같은 말을 하도록 한 군데서 만든다 */
  private partingReason(itemId: string): string {
    const item = this.data.items[itemId]
    if (!item) return '가방에 없다.'
    if (item.kind === 'keepsake') return '추억의 물건은 손에서 놓을 수 없다.'
    if (item.allyStats) return '일행을 비추는 물건은 손에서 놓을 수 없다.'
    return '이 물건에는 해당하지 않는다.'
  }

  canSell(itemId: string): { ok: boolean; reason?: string } {
    if (!this.canVisitTown().ok) return { ok: false, reason: '마을에서만 팔 수 있다.' }
    if ((this.inventory.get(itemId) ?? 0) <= 0) return { ok: false, reason: '가방에 없다.' }
    if (this.sellValueOf(itemId) === null) {
      return { ok: false, reason: this.partingReason(itemId) }
    }
    return { ok: true }
  }

  sell(itemId: string): boolean {
    if (!this.canSell(itemId).ok) return false
    const price = this.sellValueOf(itemId) as number
    this.consumeItem(itemId)
    this.gold += price
    this.bus.emit({ type: 'sold', name: this.data.items[itemId].name, price, gold: this.gold })
    return true
  }

  canDismantle(itemId: string): { ok: boolean; reason?: string } {
    if (!this.canVisitTown().ok) return { ok: false, reason: '마을에서만 분해할 수 있다.' }
    if ((this.inventory.get(itemId) ?? 0) <= 0) return { ok: false, reason: '가방에 없다.' }
    if (this.dismantleYieldOf(itemId) === null) {
      const item = this.data.items[itemId]
      if (item?.kind === 'consumable') return { ok: false, reason: '장비만 분해할 수 있다.' }
      return { ok: false, reason: this.partingReason(itemId) }
    }
    return { ok: true }
  }

  dismantle(itemId: string): boolean {
    if (!this.canDismantle(itemId).ok) return false
    const gainedMaterials = this.dismantleYieldOf(itemId) as number
    this.consumeItem(itemId)
    this.materials += gainedMaterials
    this.bus.emit({
      type: 'dismantled',
      name: this.data.items[itemId].name,
      gained: gainedMaterials,
      materials: this.materials,
    })
    return true
  }

  get upgradeStats(): UpgradeStat[] {
    return [...this.data.economy.upgrade.stats]
  }

  get upgradeMaxLevel(): number {
    return this.data.economy.upgrade.maxLevel
  }

  upgradeLevelOf(memberId: string, stat: UpgradeStat): number {
    return this.upgrades.get(memberId)?.[stat] ?? 0
  }

  /** 다음 단계로 올리는 값. 상한이면 null */
  upgradeCostOf(memberId: string, stat: UpgradeStat): { gold: number; materials: number } | null {
    const level = this.upgradeLevelOf(memberId, stat)
    return this.data.economy.upgrade.costs[level] ?? null
  }

  canUpgrade(memberId: string, stat: UpgradeStat): { ok: boolean; reason?: string } {
    if (!this.canVisitTown().ok) return { ok: false, reason: '마을에서만 강화할 수 있다.' }
    if (!this.partyJobs.includes(memberId)) return { ok: false }
    if (!this.data.economy.upgrade.stats.includes(stat)) return { ok: false }
    const cost = this.upgradeCostOf(memberId, stat)
    if (!cost) {
      return { ok: false, reason: `${this.data.economy.upgrade.maxLevel}단계까지 다 올렸다.` }
    }
    if (this.gold < cost.gold) {
      return { ok: false, reason: `동전이 ${cost.gold - this.gold}냥 모자라다.` }
    }
    if (this.materials < cost.materials) {
      return { ok: false, reason: `강화 재료가 ${cost.materials - this.materials}개 모자라다.` }
    }
    return { ok: true }
  }

  /** 강화는 되돌릴 수 없다. 체력은 비율을 유지한다 — 강화가 곧 회복이 되지 않게 */
  upgrade(memberId: string, stat: UpgradeStat): boolean {
    if (!this.canUpgrade(memberId, stat).ok) return false
    const cost = this.upgradeCostOf(memberId, stat) as { gold: number; materials: number }
    this.gold -= cost.gold
    this.materials -= cost.materials
    const up = this.upgrades.get(memberId) ?? {}
    const level = (up[stat] ?? 0) + 1
    up[stat] = level
    this.upgrades.set(memberId, up)
    this.refreshParty()
    const member = this.party.find((c) => c.id === memberId)
    this.bus.emit({
      type: 'upgraded',
      memberName: member?.name ?? '',
      statName: UPGRADE_STAT_KO[stat],
      level,
      gain: this.data.economy.upgrade.gainPerLevel[stat] ?? 0,
      gold: this.gold,
      materials: this.materials,
    })
    return true
  }

  private gainGold(amount: number): void {
    if (amount <= 0) return
    this.gold += amount
    this.bus.emit({ type: 'goldGained', amount, total: this.gold })
  }

  // --- 아이템·인벤토리 ---

  /** 파티 공유 인벤토리. id → 개수 */
  private inventory = new Map<string, number>()
  /** 몹 종별 처치 수 — 드랍 순환의 카운터. 스테이지를 넘어도 이어진다 */
  private kills = new Map<string, number>()

  /** 가방·전투 메뉴 표시용 목록. 개수 0은 목록에 없다 */
  get inventoryList(): {
    id: string
    name: string
    description: string
    count: number
    kind: ItemData['kind']
    /** 마력·기술 대기는 전투 밖에 존재하지 않는다 — 쓸 수 있는 곳이 곧 규칙이다 */
    usableInField: boolean
    usableInBattle: boolean
  }[] {
    return [...this.inventory.entries()]
      .filter(([, count]) => count > 0)
      .map(([id, count]) => {
        const item = this.data.items[id]
        const consumable = item.kind === 'consumable'
        return {
          id,
          name: item.name,
          description: item.description,
          count,
          kind: item.kind,
          usableInField: consumable && (item.heal ?? 0) > 0,
          usableInBattle:
            consumable &&
            ((item.heal ?? 0) > 0 || (item.mana ?? 0) > 0 || (item.cooldownCut ?? 0) > 0),
        }
      })
  }

  private addItem(id: string): void {
    if (!this.data.items[id]) return
    this.inventory.set(id, (this.inventory.get(id) ?? 0) + 1)
  }

  private consumeItem(id: string): void {
    const left = (this.inventory.get(id) ?? 0) - 1
    if (left > 0) this.inventory.set(id, left)
    else this.inventory.delete(id)
  }

  /**
   * 처치를 세고 이번 승리의 드랍을 모은다.
   * N번째 처치는 drops[(N-1) % 길이] — 확률이 아니라 세는 규칙이다.
   * 보스는 첫 처치에 firstDrops를 반드시 주고, 재처치부터 순환을 탄다.
   */
  private collectDrops(monsterIds: string[]): string[] {
    const dropped: string[] = []
    for (const id of monsterIds) {
      const m = this.data.monsters[id]
      const count = (this.kills.get(id) ?? 0) + 1
      this.kills.set(id, count)
      if (!m) continue
      if (m.isBoss) {
        if (count === 1) {
          dropped.push(...(m.firstDrops ?? []))
        } else if ((m.drops?.length ?? 0) > 0) {
          const d = m.drops![(count - 2) % m.drops!.length]
          if (d) dropped.push(d)
        }
      } else if ((m.drops?.length ?? 0) > 0) {
        const d = m.drops![(count - 1) % m.drops!.length]
        if (d) dropped.push(d)
      }
    }
    return dropped
  }

  /**
   * 필드에서 아이템 사용. 체력이 이미 가득이면 쓰지 않는다 —
   * 낭비를 규칙으로 막아야 실수 조작이 손해가 되지 않는다.
   */
  useItemInField(itemId: string, targetId: string): boolean {
    if (this.mode !== 'field') return false
    const item = this.data.items[itemId]
    if (item?.kind !== 'consumable' || !item.heal) return false
    if ((this.inventory.get(itemId) ?? 0) <= 0) return false
    const target = this.party.find((c) => c.id === targetId)
    if (!target || target.hp <= 0) return false
    const healed = Math.min(item.heal, target.maxHp - target.hp)
    if (healed <= 0) return false
    target.hp += healed
    this.consumeItem(itemId)
    this.bus.emit({ type: 'itemUsed', name: item.name, target, healed, mana: 0, cooldownCut: 0 })
    return true
  }

  /**
   * 파티 구성 변경. 타이틀에서만 — 모험 중에 동료를 갈아 끼우는 규칙은 없다.
   * 세 명, 전부 실재하는 직업, 중복 없음이어야 받는다.
   */
  setParty(jobs: string[]): boolean {
    if (this.mode !== 'title') return false
    if (jobs.length !== this.data.party.length) return false
    if (new Set(jobs).size !== jobs.length) return false
    if (!jobs.every((j) => this.data.jobs[j])) return false
    // 파티를 떠나는 직업의 장비는 가방으로 — 함께 담은 것을 잃지 않는다
    for (const job of this.partyJobs) {
      if (jobs.includes(job)) continue
      const eq = this.equipment.get(job)
      if (!eq) continue
      for (const id of Object.values(eq)) if (id) this.addItem(id)
      this.equipment.delete(job)
    }
    this.partyJobs = [...jobs]
    this.party = this.buildParty()
    return true
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
    // 어느 길로 왔든 이 스테이지에 걸맞은 최소 성장은 보장한다
    this.xp = Math.max(this.xp, this.data.progression.stageEntryXp[index] ?? 0)
    this.party = this.buildParty()
    // 지도는 여기서 한 번만 정해진다. 구역을 오가도 바뀌지 않는다
    this.layoutKey = this.layoutKeyOf()
    this.variantOf.set(
      this.stage.id,
      nextVariant(this.stage, this.layoutKey, this.variantOf.get(this.stage.id) ?? null),
    )
    const area = this.resolveFirstArea()
    this.field = new Field(area, this.monsterNames, this.bus, this.radiusFor(area))

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

  /**
   * 저장 가능한 상태인지. 전투·대사 중에는 복원이 어렵고 낭독 맥락도 끊긴다.
   * 클리어 화면을 넣은 것은 거기서도 마을에 들를 수 있기 때문이다 —
   * 산 물건이 창을 닫는 순간 사라지면 안 된다.
   */
  get canSave(): boolean {
    return this.mode === 'field' || this.mode === 'clear'
  }

  snapshot(): SaveSnapshot {
    return {
      schemaVersion: SAVE_VERSION,
      stageIndex: this.stageIndex,
      traitId: this.traitId,
      layoutKey: this.layoutKey,
      variants: [...this.variantOf.entries()].map(([stage, variant]) => ({ stage, variant })),
      field: {
        areaId: this.field.areaId,
        pos: { ...this.field.pos },
        enteredFrom: this.field.entered,
        checkpointReached: this.field.checkpointReached,
        defeated: this.field.defeatedIds,
        openedChests: this.field.openedChestIds,
      },
      inventory: [...this.inventory.entries()].map(([item, count]) => ({ item, count })),
      kills: [...this.kills.entries()].map(([monster, count]) => ({ monster, count })),
      party: this.party.map((c) => ({
        job: c.id,
        hp: c.hp,
        equipment: { ...(this.equipment.get(c.id) ?? {}) },
      })),
      xp: this.xp,
      gold: this.gold,
      materials: this.materials,
      upgrades: [...this.upgrades.entries()].flatMap(([job, stats]) =>
        Object.entries(stats)
          .filter(([, level]) => (level ?? 0) > 0)
          .map(([stat, level]) => ({ job, stat, level: level as number })),
      ),
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
    this.xp = s.xp
    this.gold = s.gold
    this.materials = s.materials
    this.upgrades = new Map()
    for (const u of s.upgrades) {
      const up = this.upgrades.get(u.job) ?? {}
      up[u.stat as UpgradeStat] = u.level
      this.upgrades.set(u.job, up)
    }
    this.partyJobs = s.party.map((p) => p.job)
    this.clearedStages = new Set(s.clearedStages)
    this.seenDialogues = new Set(s.seenDialogues)
    this.inventory = new Map(s.inventory.map((i) => [i.item, i.count]))
    this.kills = new Map(s.kills.map((k) => [k.monster, k.count]))
    this.equipment = new Map(s.party.map((p) => [p.job, { ...p.equipment }]))
    this.party = this.buildParty()
    for (const saved of s.party) {
      const c = this.party.find((p) => p.id === saved.job)
      if (c) c.hp = Math.min(c.maxHp, Math.max(0, saved.hp))
    }
    this.layoutKey = s.layoutKey
    this.variantOf = new Map(s.variants.map((v) => [v.stage, v.variant]))
    // 복원은 순환하지 않는다 — 같은 기록은 언제나 같은 지도다
    const area = resolveArea(this.stage, s.field.areaId, this.variantIndex)
    this.field = new Field(area, this.monsterNames, this.bus, this.radiusFor(area))
    this.field.restore(
      s.field.pos,
      s.field.checkpointReached,
      s.field.defeated,
      s.field.openedChests,
      s.field.enteredFrom,
    )

    this.bus.emit({
      type: 'stageStart',
      index: this.stageIndex,
      total: this.stageCount,
      title: this.stage.title,
      objective: this.stage.objective,
    })
    this.setMode('field')
    this.bus.emit({ type: 'fieldSummary', text: this.field.summary(this.stage.objective) })
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

  /**
   * 대사 화자의 c1/c2 토큰을 실제 동료 이름으로 바꾼다.
   * 동료 직업을 고를 수 있으므로 대본은 자리만 알고 이름은 여기서 정해진다.
   */
  private resolveSpeaker(speaker: string): string {
    if (speaker === 'c1') return this.party[1]?.name ?? '동료'
    if (speaker === 'c2') return this.party[2]?.name ?? '동료'
    return speaker
  }

  private emitDialogueLine(): void {
    const raw = this.dialogueQueue[this.dialogueIndex]
    this.bus.emit({
      type: 'dialogue',
      line: { speaker: this.resolveSpeaker(raw.speaker), text: raw.text },
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
    // 상자는 밟는 순간 열린다 — 전투가 이어져도 이미 연 것이다
    const chest = this.field.openChestAt(this.field.pos)
    if (chest) {
      for (const id of chest.items) this.addItem(id)
      this.bus.emit({
        type: 'chestOpened',
        itemNames: chest.items.map((id) => this.data.items[id]?.name ?? ''),
      })
    }
    if (encounter) {
      this.enterBattle(encounter)
      return
    }
    // 문을 밟으면 건너간다 — 상자와 같은 자리에서 판정한다
    const exit = this.field.exitAt(this.field.pos)
    if (exit) {
      this.enterArea(exit.toArea, exit.toExit, 'exit')
      return
    }
    // 쉼터에 처음 도착하면 보스 전 대사
    if (!wasAtCheckpoint && this.field.checkpointReached) this.beforeBossDialogue()
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
    this.bus.emit({ type: 'fieldSummary', text: this.field.summary(this.stage.objective) })
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
    // 아이템은 인벤토리를 아는 여기서 검증하고, 턴 규칙은 전투가 판정한다
    if (action.kind === 'item') {
      const item = this.data.items[action.itemId]
      if (item?.kind !== 'consumable') return
      if ((this.inventory.get(action.itemId) ?? 0) <= 0) return
      const result = this.battle.playerUseItem(
        action.targetId,
        { heal: item.heal, mana: item.mana, cooldownCut: item.cooldownCut },
        item.name,
      )
      // null이면 효과가 없어 쓰지 않은 것 — 아이템도 턴도 소모되지 않는다
      if (result === null) return
      this.consumeItem(action.itemId)
      this.handleStep(result)
      return
    }
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
    // 처치한 몹들의 고정 경험치 — 무작위가 없다
    const gained =
      this.currentEncounter?.monsters.reduce(
        (sum, id) => sum + (this.data.monsters[id]?.xp ?? 0),
        0,
      ) ?? 0
    const dropped = this.collectDrops(this.currentEncounter?.monsters ?? [])
    if (this.currentEncounter) this.field.removeEncounter(this.currentEncounter.id)
    this.endBattle()
    this.gainXp(gained)
    // 동전은 경험치와 같은 수로 들어온다 — 몹마다 값을 따로 두지 않아 밸런스가 함께 움직인다
    this.gainGold(gained * this.data.economy.goldPerXp)
    for (const id of dropped) this.addItem(id)
    if (dropped.length > 0) {
      this.bus.emit({
        type: 'itemGained',
        names: dropped.map((id) => this.data.items[id]?.name ?? ''),
      })
    }
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
      this.bus.emit({ type: 'fieldSummary', text: this.field.summary(this.stage.objective) })
    }
  }

  private onDefeat(): void {
    this.endBattle()
    // 관대한 재시작: 체크포인트에서 전원 완전 회복, 페널티 없음
    for (const a of this.party) {
      a.hp = a.maxHp
      a.cooldowns = a.skills.map(() => 0)
      a.defending = false
    }
    const target = this.field.respawnTarget()
    if (target.areaId !== this.field.areaId) {
      // enterArea가 낭독까지 맡는다 — 여기서 또 요약하면 같은 문장이 두 번 붙는다
      this.setMode('field')
      this.enterArea(target.areaId, null, 'respawn')
      return
    }
    this.field.respawn()
    this.setMode('field')
    // 순간이동한 위치를 반드시 알려준다 — 공간 지도를 잃지 않도록
    this.bus.emit({ type: 'fieldSummary', text: this.field.summary(this.stage.objective) })
  }

  private endBattle(): void {
    this.clearTurnTimer()
    this.battle = null
    this.currentEncounter = null
    this.bus.emit({ type: 'battleEnd' })
  }

}
