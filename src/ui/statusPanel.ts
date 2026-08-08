import type { SpriteMode } from '../render/sprites'
import { EQUIP_SLOTS, SLOT_KO, type Game } from '../core/game'
import type { EquipSlot } from '../core/types'
import { josa } from './announcer'
import { gauge } from './gauge'
import { ItemGrid } from './itemGrid'
import { describeItem, signed } from './itemText'
import { memberLabel } from './memberLabel'

/**
 * 능력치를 말하는 순서와 묶음.
 *
 * 스탯이 다섯이 되면서 낭독 길이가 문제가 됐다. 예전에는 값마다 출처를 함께
 * 읽어 주었는데("공격 21 (기본 18 + 장비 2 + 동료 1)"), 그대로 두 배로 늘리면
 * 상태창 한 번 여는 데 문장 다섯 개를 들어야 한다.
 *
 * 그래서 둘로 나눴다. 요약 한 줄은 값만 짝지어 말하고("공격 물리 21 · 마법 2"),
 * 어디서 왔는지는 펼쳐 보는 자리로 내렸다. 필요할 때만 듣게 하는 것이지
 * 감추는 것이 아니다 — 접힘 상태는 낭독기가 먼저 알려 준다.
 *
 * 순서는 언제나 물리 → 마법으로 고정한다. 주력이 앞에 오도록 뒤집으면 직업마다
 * 듣는 순서가 달라지고, 예측 가능성이 개인화보다 훨씬 값지다.
 */
const PAIRS = [
  { label: '공격', keys: ['patk', 'matk'] },
  { label: '방어', keys: ['pdef', 'mdef'] },
] as const
const TYPE_KO = ['물리', '마법'] as const
type CoreStat = 'patk' | 'matk' | 'pdef' | 'mdef' | 'spd'
const STAT_KO: Record<CoreStat, string> = {
  patk: '물리 공격',
  matk: '마법 공격',
  pdef: '물리 방어',
  mdef: '마법 방어',
  spd: '속도',
}

/**
 * 상태창 — 파티의 레벨·경험치·능력치 내역과 장비를 한 곳에서 본다.
 * 능력치 내역은 코어의 StatBreakdown을 그대로 읽는다. 계산과 표시가
 * 다른 함수를 쓰면 언젠가 어긋나고, 그 순간 낭독이 거짓말이 된다.
 */
export class StatusPanel {
  private dialog: HTMLDialogElement
  private prevFocus: Element | null = null
  private closed = true
  /**
   * 장비를 갈아입은 뒤 손이 있던 자리.
   *
   * 이 창은 값이 하나 바뀌면 통째로 다시 그린다(능력치 내역이 함께 달라지므로).
   * 그러면 격자도 새로 서는데, 예전에는 고르던 칸이 목록 맨 앞으로 돌아가고
   * 누르던 버튼이 사라지면서 손이 창 바깥으로 떨어졌다 — 키보드로 장비를
   * 바꾸는 사람은 하나 갈아입을 때마다 처음부터 다시 걸어야 했다.
   * 격자 자체를 살려 두는 길도 있지만, 그러면 "누가 무엇을 입었나"를 담은
   * 클로저가 낡는다. 자리만 기억하고 새 격자에 물려준다.
   */
  private gearKeep: { id: string; action: number } | null = null
  /**
   * 좁은 화면에서 보고 있는 파티원. 넓은 화면에서는 셋을 나란히 놓으므로 쓰지 않는다.
   * 폭 기준은 style.css의 첫 단 나눔과 같은 34rem이다 — 두 곳이 어긋나면
   * 탭도 없고 나란히도 아닌 화면이 생긴다.
   */
  private narrow = window.matchMedia('(max-width: 33.999rem)')
  private activeMember: string | null = null

  constructor(
    private game: Game,
    private hooks: { onOpen?: () => void; onClose?: () => void },
    private spriteMode: () => SpriteMode = () => 'normal',
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options status'
    this.dialog.setAttribute('aria-labelledby', 'status-title')
    this.dialog.innerHTML = `
      <h2 id="status-title">상태</h2>
      <p class="status-level"></p>
      <div class="status-tabs" role="tablist" aria-label="파티원 고르기" hidden></div>
      <div class="status-members"></div>
      <div class="status-gear"></div>
      <div class="slot-actions">
        <button type="button" id="status-close">닫기</button>
      </div>
    `
    document.body.append(this.dialog)
    this.dialog.querySelector('#status-close')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
    // 화면을 돌리거나 창을 늘이면 탭과 나란히 놓기 사이를 오간다.
    // resize도 함께 듣는 것은 창 크기를 흉내 내는 환경에서 change가 오지 않는 일이
    // 있기 때문이다 — 모드가 실제로 뒤집힐 때만 다시 그리므로 값은 싸다
    const sync = () => {
      if (!this.dialog.open || this.narrow.matches === this.tabbed) return
      this.render()
    }
    this.narrow.addEventListener('change', sync)
    window.addEventListener('resize', sync)
  }

  /** 지금 탭으로 보여주고 있는가 — 다시 그릴지 판단하는 기준 */
  private tabbed = false

  get isOpen(): boolean {
    return this.dialog.open
  }

  /** 바깥에서 상태가 바뀌었다 — 함께 하기에서 동료의 장비·강화가 내 화면에도 닿는 길 */
  refresh(): void {
    if (this.dialog.open) this.render()
  }

  private render(): void {
    const g = this.game
    const level = this.dialog.querySelector('.status-level')!
    const next = g.xpToNext
    level.textContent =
      `파티 ${g.partyLevel}레벨 · 경험치 ${g.currentXp}` +
      (next === null ? ' · 최고 레벨' : ` · 다음 레벨까지 ${next}`)

    const ids = g.party.map((m) => m.id)
    if (!this.activeMember || !ids.includes(this.activeMember)) this.activeMember = ids[0]
    const tabbed = this.narrow.matches
    this.tabbed = tabbed

    const wrap = this.dialog.querySelector('.status-members')!
    wrap.replaceChildren()
    for (const member of g.party) {
      const section = this.renderMember(member.id)
      section.id = `status-panel-${member.id}`
      if (tabbed) {
        // 좁은 화면에서는 한 사람씩 — 셋을 세로로 쌓으면 스크롤이 길어져
        // 지금 누구를 보고 있는지 놓친다
        section.setAttribute('role', 'tabpanel')
        section.setAttribute('aria-labelledby', `status-tab-${member.id}`)
        section.hidden = member.id !== this.activeMember
      }
      wrap.append(section)
    }
    this.renderTabs(tabbed)

    // 장비는 파티원 칸 아래 한 곳에 모은다 — 어느 칸 안에서 목록이 펼쳐지면
    // 그 칸만 길어져 나란히 선 세 단이 어긋난다
    const gear = this.dialog.querySelector('.status-gear')!
    gear.replaceChildren(this.renderEquipment())
  }

  private renderTabs(tabbed: boolean): void {
    const list = this.dialog.querySelector<HTMLElement>('.status-tabs')!
    list.replaceChildren()
    list.hidden = !tabbed
    if (!tabbed) return

    const ids = this.game.party.map((m) => m.id)
    for (const member of this.game.party) {
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.id = `status-tab-${member.id}`
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-controls', `status-panel-${member.id}`)
      const selected = member.id === this.activeMember
      tab.setAttribute('aria-selected', String(selected))
      // 탭 묶음 전체가 Tab 키 한 번이다 — 안에서는 화살표로 옮긴다
      tab.tabIndex = selected ? 0 : -1
      tab.textContent = memberLabel(this.game, member)
      tab.addEventListener('click', () => this.selectMember(member.id))
      tab.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        let next: string | null = null
        if (step !== 0) {
          const at = ids.indexOf(member.id)
          next = ids[(at + step + ids.length) % ids.length]
        } else if (e.key === 'Home') next = ids[0]
        else if (e.key === 'End') next = ids[ids.length - 1]
        if (!next) return
        e.preventDefault()
        this.selectMember(next)
      })
      list.append(tab)
    }
  }

  private selectMember(memberId: string): void {
    this.activeMember = memberId
    this.render()
    this.dialog.querySelector<HTMLElement>(`#status-tab-${memberId}`)?.focus()
  }

  private renderMember(memberId: string): HTMLElement {
    const g = this.game
    const c = g.party.find((m) => m.id === memberId)!
    const b = g.statBreakdownOf(memberId)!
    const section = document.createElement('section')
    section.className = 'status-member'
    section.setAttribute('aria-label', `${c.name} 상태`)

    const h = document.createElement('h3')
    h.textContent = memberLabel(this.game, c)
    const vitals = document.createElement('p')
    vitals.textContent = `체력 ${c.hp}/${c.maxHp} · 마력 ${c.mp}/${c.maxMp}`
    section.append(h, vitals, gauge(c.hp, c.maxHp, 'hp'), gauge(c.mp, c.maxMp, 'mp'))

    // 요약 한 줄 — 값만 짝지어 짧게
    const stats = document.createElement('p')
    stats.textContent = [
      ...PAIRS.map(
        (pair) =>
          `${pair.label} ${pair.keys.map((k, i) => `${TYPE_KO[i]} ${b.total[k]}`).join(' · ')}`,
      ),
      `속도 ${b.total.spd}`,
    ].join(' | ')

    // 무엇으로 싸우는가 — 어느 무기를 들어야 하는지가 여기서 갈린다
    const main = g.mainTypeOf(memberId)
    const way = document.createElement('p')
    way.className = 'status-note'
    way.textContent =
      main === 'magic'
        ? '마법으로 싸운다 — 지팡이류가 마법 공격을 올린다.'
        : '몸으로 싸운다 — 검·활·도끼류가 물리 공격을 올린다.'

    // 어디서 왔는지는 펼쳐 보는 자리로. 출처가 하나뿐인 값은 줄을 만들지 않는다
    const detail = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = '능력치 내역'
    const list = document.createElement('ul')
    list.className = 'stat-sources'
    for (const k of Object.keys(STAT_KO) as CoreStat[]) {
      const parts = [`기본 ${b.base[k]}`]
      if (b.upgrade[k] !== 0) parts.push(`강화 +${b.upgrade[k]}`)
      if (b.equip[k] !== 0) parts.push(`장비 ${signed(b.equip[k])}`)
      if (b.set[k] !== 0) parts.push(`세트 +${b.set[k]}`)
      if (b.aura[k] !== 0) parts.push(`동료 +${b.aura[k]}`)
      const traitDelta =
        b.total[k] - (b.base[k] + b.upgrade[k] + b.equip[k] + b.set[k] + b.aura[k])
      if (traitDelta !== 0) parts.push(`특성 ${signed(traitDelta)}`)
      if (parts.length === 1) continue
      const li = document.createElement('li')
      li.textContent = `${STAT_KO[k]} ${b.total[k]} — ${parts.join(' ')}`
      list.append(li)
    }
    detail.append(summary, list)
    section.append(stats, way)
    if (list.childElementCount > 0) section.append(detail)

    // 세트·오라 — 지금 발동 중인 것만
    const eq = g.equipmentOf(memberId)
    const setCounts = new Map<string, number>()
    for (const id of Object.values(eq)) {
      const item = id ? g.itemData(id) : undefined
      if (item?.set) setCounts.set(item.set, (setCounts.get(item.set) ?? 0) + 1)
    }
    for (const [sid, count] of setCounts) {
      const set = g.setData(sid)
      if (!set || count < set.pieces) continue
      const p = document.createElement('p')
      p.className = 'status-note'
      const bonus = (
        Object.entries({
          '물리 공격': set.bonus.patk,
          '마법 공격': set.bonus.matk,
          '물리 방어': set.bonus.pdef,
          '마법 방어': set.bonus.mdef,
          속도: set.bonus.spd,
          체력: set.bonus.hp,
          마력: set.bonus.mp,
        }) as [string, number | undefined][]
      )
        .filter(([, v]) => (v ?? 0) !== 0)
        .map(([k, v]) => `${k} ${signed(v as number)}`)
        .join(' ')
      p.textContent = `${set.name} (${count}개): ${bonus}`
      section.append(p)
    }
    for (const other of g.party) {
      if (other.id === memberId) continue
      for (const id of Object.values(g.equipmentOf(other.id))) {
        const item = id ? g.itemData(id) : undefined
        if (!item?.allyStats) continue
        const p = document.createElement('p')
        p.className = 'status-note'
        const who =
          other.seat === this.game.localSeat ? '내가' : josa(other.name, '이', '가')
        p.textContent = `${item.name} — ${who} 들어 함께 강해진다.`
        section.append(p)
      }
    }

    // 장비 슬롯
    const slots = document.createElement('ul')
    slots.className = 'status-slots'
    for (const slot of EQUIP_SLOTS) {
      slots.append(this.renderSlot(slot, eq[slot]))
    }
    section.append(slots)
    return section
  }

  /**
   * 착용 칸 한 줄. 예전에는 칸마다 "바꾸기" 버튼이 붙어 파티원 셋이면 버튼이 열둘이었고,
   * 하나를 누르면 그 칸 안에서 목록이 펼쳐져 세 단의 높이가 서로 어긋났다.
   * 지금은 무엇을 입고 있는지만 보여 주고, 갈아입는 일은 아래 장비 격자 한 곳에서 한다.
   */
  private renderSlot(slot: EquipSlot, itemId?: string): HTMLElement {
    const g = this.game
    const li = document.createElement('li')
    li.className = 'slot-line'

    const name = document.createElement('span')
    name.className = 'slot-name'
    name.textContent = SLOT_KO[slot]

    const value = document.createElement('span')
    value.className = 'slot-value'
    const item = itemId ? g.itemData(itemId) : undefined
    if (item) {
      value.textContent = item.name
      const effect = describeItem(item)
      if (effect) value.title = effect
    } else {
      value.textContent = '비어 있음'
      value.classList.add('is-empty')
    }

    li.append(name, value)
    return li
  }

  /** 이 슬롯에 입을 수 있는 후보 — 못 입는 것도 이유와 함께 보인다 */
  /**
   * 파티가 가진 장비를 한 자리에 모아 보여 준다.
   *
   * 가방에 있는 것과 누군가 입고 있는 것을 같은 격자에 놓고, 입고 있는 칸에는
   * 누가 입었는지 이름을 붙인다. "무엇이 있나"와 "누가 뭘 입었나"를 한눈에
   * 보고 싶다는 요구가 여기서 만난다.
   *
   * 고른 물건 아래에는 파티원 수만큼 버튼이 선다. 이미 입은 사람 자리는 "해제"가
   * 되고, 못 입는 사람 자리는 이유를 달고 잠긴다 — 직업 전용 장비가 누구 것인지
   * 눌러 보지 않아도 읽힌다.
   */
  private renderEquipment(): HTMLElement {
    const g = this.game
    const box = document.createElement('section')
    box.className = 'status-equipment'
    const h = document.createElement('h3')
    h.textContent = '장비'
    box.append(h)

    // 누가 무엇을 입고 있는지 먼저 모은다 — 같은 물건을 둘이 입었을 수도 있다
    const wornBy = new Map<string, { member: string; name: string; slot: EquipSlot }[]>()
    for (const member of g.party) {
      const eq = g.equipmentOf(member.id)
      for (const slot of EQUIP_SLOTS) {
        const id = eq[slot]
        if (!id) continue
        const list = wornBy.get(id) ?? []
        list.push({
            member: member.id,
            name: member.seat === this.game.localSeat ? '나' : member.name,
            slot,
          })
        wornBy.set(id, list)
      }
    }

    /*
      목록에 서는 것은 **내 가방의 장비**와 **누군가 입고 있는 장비**다.
      남의 가방은 보이지 않는다 — 서로의 주머니를 들여다볼 이유가 없고,
      보이면 "저 사람이 가진 것"과 "내가 쓸 수 있는 것"이 섞인다.
      입은 것은 서로 보인다. 파티가 어떻게 서 있는지는 함께 아는 편이 낫다.

      개수는 **내 가방 것만** 센다. 예전에는 남이 입은 것까지 더해서, 동료와
      내가 같은 갑옷을 하나씩 가졌을 때 내 화면에 둘로 보였다 — 그러고는
      하나를 입으면 나머지 하나가 왜 안 만져지는지 알 수 없었다.
    */
    const bag = g.inventoryList.filter((row) => row.kind === 'equipment')
    const ids = new Set<string>([...bag.map((r) => r.id), ...wornBy.keys()])

    const entries = [...ids].map((id) => {
      const worn = wornBy.get(id) ?? []
      const inBag = bag.find((r) => r.id === id)?.count ?? 0
      return {
        id,
        item: g.itemData(id)!,
        count: inBag,
        tag: worn.length ? `${worn.map((w) => w.name).join('·')} 착용` : undefined,
      }
    })

    if (entries.length === 0) {
      const p = document.createElement('p')
      p.className = 'status-note'
      p.textContent = '아직 장비가 없다. 몹과 보물상자에서 얻는다.'
      box.append(p)
      return box
    }

    const grid = new ItemGrid({
      label: '가진 장비',
      spriteMode: this.spriteMode,
      emptyText: '아직 장비가 없다.',
      actions: g.party.map((member, index) => ({
        label: (e) => {
          const mine = wornBy.get(e.id)?.some((w) => w.member === member.id)
          const who = member.seat === this.game.localSeat ? '내가' : member.name
          return mine ? `${who} 해제` : `${who} 입기`
        },
        can: (e) => {
          // 남의 몸은 만지지 않는다 — 벗기는 것이 곧 가져가는 것이 되기 때문이다.
          // 벗은 물건은 벗긴 사람의 가방으로 가므로, 자격을 먼저 본다
          if (!g.canOutfit(member.id)) return { ok: false, reason: '본인만 바꾼다' }
          const worn = wornBy.get(e.id)?.find((w) => w.member === member.id)
          if (worn) return { ok: true }
          // 가방에 없으면 남이 입고 있는 것뿐이다 — 벗겨 오지는 않는다
          const inBag = bag.find((r) => r.id === e.id)
          if (!inBag) return { ok: false, reason: '가방에 없다' }
          return g.canEquip(member.id, e.id)
        },
        run: (e) => {
          const worn = wornBy.get(e.id)?.find((w) => w.member === member.id)
          const done = worn ? g.unequip(member.id, worn.slot) : g.equip(member.id, e.id)
          if (!done) return
          // 다시 그린 뒤 같은 자리로 손을 돌려준다. 입고 벗는 일은 연달아
          // 하게 되므로, 한 번마다 목록 처음으로 튕기면 길을 잃는다
          this.gearKeep = { id: e.id, action: index }
          this.render()
        },
      })),
    })
    const keep = this.gearKeep
    if (keep) grid.preselect(keep.id)
    grid.setEntries(entries)
    box.append(grid.el)
    if (keep) {
      // 격자가 문서에 붙은 뒤라야 포커스가 간다
      queueMicrotask(() => grid.focusAction(keep.action))
      this.gearKeep = null
    }
    return box
  }

  open(): void {
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.render()
    this.dialog.showModal()
    this.dialog.querySelector<HTMLElement>('#status-close')?.focus()
  }

  close(): void {
    if (this.dialog.open) this.dialog.close()
    this.afterClose()
  }

  private afterClose(): void {
    if (this.closed) return
    this.closed = true
    if (this.prevFocus instanceof HTMLElement && this.prevFocus.isConnected) {
      this.prevFocus.focus()
    }
    this.hooks.onClose?.()
  }
}
