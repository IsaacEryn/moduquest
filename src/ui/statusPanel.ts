import { EQUIP_SLOTS, SLOT_KO, type Game } from '../core/game'
import type { EquipSlot } from '../core/types'
import { josa } from './announcer'
import { gauge } from './gauge'
import { ItemGrid } from './itemGrid'
import { describeItem, signed } from './itemText'

const STAT_KO = { atk: '공격', def: '방어', spd: '속도' } as const
type CoreStat = keyof typeof STAT_KO

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
   * 좁은 화면에서 보고 있는 파티원. 넓은 화면에서는 셋을 나란히 놓으므로 쓰지 않는다.
   * 폭 기준은 style.css의 첫 단 나눔과 같은 34rem이다 — 두 곳이 어긋나면
   * 탭도 없고 나란히도 아닌 화면이 생긴다.
   */
  private narrow = window.matchMedia('(max-width: 33.999rem)')
  private activeMember: string | null = null

  constructor(
    private game: Game,
    private hooks: { onOpen?: () => void; onClose?: () => void },
    private lowStim: () => boolean = () => false,
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
      tab.textContent = member.isPlayer ? `${member.name} (나)` : member.name
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
    h.textContent = c.isPlayer ? `${c.name} (나)` : c.name
    const vitals = document.createElement('p')
    vitals.textContent = `체력 ${c.hp}/${c.maxHp} · 마력 ${c.mp}/${c.maxMp}`
    section.append(h, vitals, gauge(c.hp, c.maxHp, 'hp'), gauge(c.mp, c.maxMp, 'mp'))

    // 능력치 내역 — 출처가 있는 것만 말한다. "공격 21 (기본 18 + 장비 2 + 동료 1)"
    const stats = document.createElement('p')
    stats.textContent = (Object.keys(STAT_KO) as CoreStat[])
      .map((k) => {
        const parts = [`기본 ${b.base[k]}`]
        if (b.upgrade[k] !== 0) parts.push(`강화 +${b.upgrade[k]}`)
        if (b.equip[k] !== 0) parts.push(`장비 ${b.equip[k] > 0 ? '+' : ''}${b.equip[k]}`)
        if (b.set[k] !== 0) parts.push(`세트 +${b.set[k]}`)
        if (b.aura[k] !== 0) parts.push(`동료 +${b.aura[k]}`)
        const traitDelta =
          b.total[k] - (b.base[k] + b.upgrade[k] + b.equip[k] + b.set[k] + b.aura[k])
        if (traitDelta !== 0) parts.push(`특성 ${traitDelta > 0 ? '+' : ''}${traitDelta}`)
        return parts.length > 1
          ? `${STAT_KO[k]} ${b.total[k]} (${parts.join(' ')})`
          : `${STAT_KO[k]} ${b.total[k]}`
      })
      .join(' · ')
    section.append(stats)

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
      const bonus = (Object.entries({ 공격: set.bonus.atk, 방어: set.bonus.def, 속도: set.bonus.spd, 체력: set.bonus.hp, 마력: set.bonus.mp }) as [string, number | undefined][])
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
        const who = other.isPlayer ? '내가' : josa(other.name, '이', '가')
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
        list.push({ member: member.id, name: member.isPlayer ? '나' : member.name, slot })
        wornBy.set(id, list)
      }
    }

    const bag = g.inventoryList.filter((row) => row.kind === 'equipment')
    const ids = new Set<string>([...bag.map((r) => r.id), ...wornBy.keys()])

    const entries = [...ids].map((id) => {
      const worn = wornBy.get(id) ?? []
      const inBag = bag.find((r) => r.id === id)?.count ?? 0
      return {
        id,
        item: g.itemData(id)!,
        count: inBag + worn.length,
        tag: worn.length ? worn.map((w) => w.name).join('·') : undefined,
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
      lowStim: this.lowStim,
      emptyText: '아직 장비가 없다.',
      actions: g.party.map((member) => ({
        label: (e) => {
          const mine = wornBy.get(e.id)?.some((w) => w.member === member.id)
          const who = member.isPlayer ? '내가' : member.name
          return mine ? `${who} 해제` : `${who} 입기`
        },
        can: (e) => {
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
          if (done) this.render()
        },
      })),
    })
    grid.setEntries(entries)
    box.append(grid.el)
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
