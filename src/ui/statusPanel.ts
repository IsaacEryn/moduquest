import { EQUIP_SLOTS, SLOT_KO, type Game } from '../core/game'
import type { EquipSlot, ItemData } from '../core/types'
import { josa } from './announcer'

const STAT_KO = { atk: '공격', def: '방어', spd: '속도' } as const
type CoreStat = keyof typeof STAT_KO

/** 장비 한 점의 효과 문장 — 수치는 데이터에서 조립해 설명과 실제가 어긋나지 않는다 */
function describeItem(item: ItemData, setName?: string): string {
  const parts: string[] = []
  const s = item.stats ?? {}
  const bits = (Object.entries({ 체력: s.hp, 마력: s.mp, 공격: s.atk, 방어: s.def, 속도: s.spd }) as [
    string,
    number | undefined,
  ][])
    .filter(([, v]) => (v ?? 0) !== 0)
    .map(([k, v]) => `${k} +${v}`)
  if (bits.length) parts.push(bits.join(' '))
  const a = item.allyStats ?? {}
  const auraBits = (Object.entries({ 공격: a.atk, 방어: a.def, 속도: a.spd, 체력: a.hp, 마력: a.mp }) as [
    string,
    number | undefined,
  ][])
    .filter(([, v]) => (v ?? 0) !== 0)
    .map(([k, v]) => `${k} +${v}`)
  if (auraBits.length) parts.push(`동료 ${auraBits.join(' ')}`)
  if (setName) parts.push(setName)
  if (item.minLevel) parts.push(`${item.minLevel}레벨부터`)
  return parts.join(' · ')
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
  /** 바꾸기 목록이 열려 있는 슬롯 — 다시 그려도 유지한다 */
  private openPicker: { member: string; slot: EquipSlot } | null = null

  constructor(
    private game: Game,
    private hooks: { onOpen?: () => void; onClose?: () => void },
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options status'
    this.dialog.setAttribute('aria-labelledby', 'status-title')
    this.dialog.innerHTML = `
      <h2 id="status-title">상태</h2>
      <p class="status-level"></p>
      <div class="status-members"></div>
      <div class="slot-actions">
        <button type="button" id="status-close">닫기</button>
      </div>
    `
    document.body.append(this.dialog)
    this.dialog.querySelector('#status-close')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  private render(): void {
    const g = this.game
    const level = this.dialog.querySelector('.status-level')!
    const next = g.xpToNext
    level.textContent =
      `파티 ${g.partyLevel}레벨 · 경험치 ${g.currentXp}` +
      (next === null ? ' · 최고 레벨' : ` · 다음 레벨까지 ${next}`)

    const wrap = this.dialog.querySelector('.status-members')!
    wrap.replaceChildren()
    for (const member of g.party) wrap.append(this.renderMember(member.id))
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
    section.append(h, vitals)

    // 능력치 내역 — 출처가 있는 것만 말한다. "공격 21 (기본 18 + 장비 2 + 동료 1)"
    const stats = document.createElement('p')
    stats.textContent = (Object.keys(STAT_KO) as CoreStat[])
      .map((k) => {
        const parts = [`기본 ${b.base[k]}`]
        if (b.equip[k] !== 0) parts.push(`장비 ${b.equip[k] > 0 ? '+' : ''}${b.equip[k]}`)
        if (b.set[k] !== 0) parts.push(`세트 +${b.set[k]}`)
        if (b.aura[k] !== 0) parts.push(`동료 +${b.aura[k]}`)
        const traitDelta = b.total[k] - (b.base[k] + b.equip[k] + b.set[k] + b.aura[k])
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
        .map(([k, v]) => `${k} +${v}`)
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
      slots.append(this.renderSlot(memberId, slot, eq[slot]))
    }
    section.append(slots)
    return section
  }

  private renderSlot(memberId: string, slot: EquipSlot, itemId?: string): HTMLElement {
    const g = this.game
    const li = document.createElement('li')
    const item = itemId ? g.itemData(itemId) : undefined
    const label = document.createElement('span')
    label.textContent = item
      ? `${SLOT_KO[slot]}: ${item.name}${describeItem(item) ? ` (${describeItem(item)})` : ''}`
      : `${SLOT_KO[slot]}: 비어 있음`
    li.append(label)

    const change = document.createElement('button')
    change.type = 'button'
    change.textContent = '바꾸기'
    change.addEventListener('click', () => {
      this.openPicker =
        this.openPicker?.member === memberId && this.openPicker.slot === slot
          ? null
          : { member: memberId, slot }
      this.render()
    })
    li.append(change)

    if (item) {
      const off = document.createElement('button')
      off.type = 'button'
      off.textContent = '해제'
      off.addEventListener('click', () => {
        if (g.unequip(memberId, slot)) {
          this.openPicker = null
          this.render()
        }
      })
      li.append(off)
    }

    if (this.openPicker?.member === memberId && this.openPicker.slot === slot) {
      li.append(this.renderPicker(memberId, slot))
    }
    return li
  }

  /** 이 슬롯에 입을 수 있는 후보 — 못 입는 것도 이유와 함께 보인다 */
  private renderPicker(memberId: string, slot: EquipSlot): HTMLElement {
    const g = this.game
    const box = document.createElement('div')
    box.className = 'status-picker'
    box.setAttribute('role', 'group')
    box.setAttribute('aria-label', `${SLOT_KO[slot]} 후보`)

    const candidates = g.inventoryList.filter(
      (i) => i.kind === 'equipment' && g.itemData(i.id)?.slot === slot,
    )
    if (candidates.length === 0) {
      const p = document.createElement('p')
      p.className = 'status-note'
      p.textContent = '가방에 이 자리에 맞는 장비가 없다.'
      box.append(p)
    }
    for (const cand of candidates) {
      const item = g.itemData(cand.id)!
      const setName = item.set ? g.setData(item.set)?.name : undefined
      const b = document.createElement('button')
      b.type = 'button'
      const check = g.canEquip(memberId, cand.id)
      b.textContent =
        `${item.name} ×${cand.count} — ${describeItem(item, setName)}` +
        (check.ok ? '' : ` (${check.reason ?? '지금은 못 입는다'})`)
      b.disabled = !check.ok
      b.addEventListener('click', () => {
        if (g.equip(memberId, cand.id)) {
          this.openPicker = null
          this.render()
        }
      })
      box.append(b)
    }
    return box
  }

  open(): void {
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.openPicker = null
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
