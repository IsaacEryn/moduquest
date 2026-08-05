import { UPGRADE_STAT_KO, type Game } from '../core/game'
import type { UpgradeStat } from '../core/types'

const TOWN_TABS = [
  { id: 'shop', label: '사기' },
  { id: 'part', label: '팔기·분해' },
  { id: 'upgrade', label: '성장 강화' },
] as const

type TownTab = (typeof TOWN_TABS)[number]['id']

/**
 * 마을 — 쉼터와 스테이지를 마친 자리에서 들르는 곳. 사고, 팔거나 분해하고, 강화한다.
 * 세 가게는 탭으로 나뉜다 — 한 창에 다 쌓으면 강화 버튼 열둘까지 스크롤이 너무 길다.
 * 탭 조작은 상태창과 같다: 묶음 전체가 Tab 한 번, 안에서는 화살표와 Home·End.
 *
 * 값에는 확률이 없다. 그래서 모든 버튼이 치를 값을 미리 적어 두고, 못 하는 버튼은
 * 왜 못 하는지를 라벨에 함께 적는다 — 눌러 보고 알아내야 하는 규칙은 규칙이 아니다.
 * 거래 결과 낭독은 코어 이벤트를 받은 Announcer가 맡는다.
 */
export class TownPanel {
  private dialog: HTMLDialogElement
  private prevFocus: Element | null = null
  private closed = true
  /** 보고 있는 가게. 닫았다 다시 열어도 하던 곳이 유지된다 */
  private activeTab: TownTab = 'shop'

  constructor(
    private game: Game,
    private hooks: { onOpen?: () => void; onClose?: () => void },
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options town'
    this.dialog.setAttribute('aria-labelledby', 'town-title')
    this.dialog.innerHTML = `
      <h2 id="town-title">마을</h2>
      <p class="town-wallet" aria-live="off"></p>
      <div class="town-tabs" role="tablist" aria-label="마을 가게"></div>
      <section role="tabpanel" id="town-panel-shop" aria-labelledby="town-tab-shop">
        <ul class="bag-list town-shop"></ul>
      </section>
      <section role="tabpanel" id="town-panel-part" aria-labelledby="town-tab-part">
        <ul class="bag-list town-part"></ul>
      </section>
      <section role="tabpanel" id="town-panel-upgrade" aria-labelledby="town-tab-upgrade">
        <p class="bag-note">동전과 강화 재료로 한 사람의 능력치를 영구히 올린다. 되돌릴 수 없다.</p>
        <ul class="bag-list town-upgrade"></ul>
      </section>
      <div class="slot-actions">
        <button type="button" id="town-close">닫기</button>
      </div>
    `
    document.body.append(this.dialog)
    this.dialog.querySelector('#town-close')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  private renderTabs(): void {
    const list = this.dialog.querySelector<HTMLElement>('.town-tabs')!
    list.replaceChildren()
    const ids = TOWN_TABS.map((t) => t.id)
    for (const t of TOWN_TABS) {
      const tab = document.createElement('button')
      tab.type = 'button'
      tab.id = `town-tab-${t.id}`
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-controls', `town-panel-${t.id}`)
      const selected = t.id === this.activeTab
      tab.setAttribute('aria-selected', String(selected))
      // 탭 묶음 전체가 Tab 키 한 번이다 — 안에서는 화살표로 옮긴다
      tab.tabIndex = selected ? 0 : -1
      tab.textContent = t.label
      tab.addEventListener('click', () => this.selectTab(t.id))
      tab.addEventListener('keydown', (e) => {
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        let next: TownTab | null = null
        if (step !== 0) {
          const at = ids.indexOf(t.id)
          next = ids[(at + step + ids.length) % ids.length]
        } else if (e.key === 'Home') next = ids[0]
        else if (e.key === 'End') next = ids[ids.length - 1]
        if (!next) return
        e.preventDefault()
        this.selectTab(next)
      })
      list.append(tab)
    }
    for (const t of TOWN_TABS) {
      const panel = this.dialog.querySelector<HTMLElement>(`#town-panel-${t.id}`)!
      panel.hidden = t.id !== this.activeTab
    }
  }

  private selectTab(id: TownTab): void {
    this.activeTab = id
    this.render()
    this.dialog.querySelector<HTMLElement>(`#town-tab-${id}`)?.focus()
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  /**
   * 거래 한 번마다 값이 전부 달라지므로 통째로 다시 그린다.
   * 다시 그리면 눌렀던 버튼이 사라지므로 같은 자리로 포커스를 돌려준다 —
   * 연달아 사고파는 동안 포커스가 튀면 키보드만으로는 길을 잃는다.
   */
  private rerender(keepKey: string): void {
    this.render()
    const same = this.dialog.querySelector<HTMLButtonElement>(
      `button[data-key="${CSS.escape(keepKey)}"]`,
    )
    // 같은 버튼이 값을 못 치러 잠겼거나(마지막 하나를 팔았다) 아예 사라졌으면
    // 같은 줄의 다른 버튼으로 옮긴다. 창 맨 아래로 튀면 하던 일의 자리를 잃는다
    const target =
      same && !same.disabled
        ? same
        : (same?.closest('li')?.querySelector<HTMLButtonElement>('button:not([disabled])') ?? null)
    if (target) target.focus()
    else this.dialog.querySelector<HTMLElement>('#town-close')?.focus()
  }

  /** 버튼 하나 — 못 누르는 버튼도 이유를 달고 남는다 */
  private action(
    key: string,
    label: string,
    can: { ok: boolean; reason?: string },
    run: () => boolean,
  ): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.dataset.key = key
    b.textContent = can.ok || !can.reason ? label : `${label} (${can.reason})`
    b.disabled = !can.ok
    b.addEventListener('click', () => {
      if (run()) this.rerender(key)
    })
    return b
  }

  private render(): void {
    const g = this.game
    this.dialog.querySelector('.town-wallet')!.textContent =
      `동전 ${g.currentGold}냥 · 강화 재료 ${g.currentMaterials}개`
    this.renderTabs()
    // 세 가게를 전부 그려 둔다 — 탭은 보이기만 가르고, 거래 후 포커스 복원은
    // data-key 검색이라 숨은 판을 비워 두면 찾을 것이 사라진다
    this.renderShop()
    this.renderParting()
    this.renderUpgrades()
  }

  private renderShop(): void {
    const list = this.dialog.querySelector<HTMLUListElement>('.town-shop')!
    list.replaceChildren()
    for (const item of this.game.shopStock) {
      const li = document.createElement('li')
      li.className = 'bag-item'
      const head = document.createElement('p')
      head.textContent =
        `${item.name} — ${item.description}` + (item.owned > 0 ? ` (가진 것 ${item.owned}개)` : '')
      li.append(
        head,
        this.action(`buy-${item.id}`, `사기 — ${item.price}냥`, this.game.canBuy(item.id), () =>
          this.game.buy(item.id),
        ),
      )
      list.append(li)
    }
  }

  private renderParting(): void {
    const g = this.game
    const list = this.dialog.querySelector<HTMLUListElement>('.town-part')!
    list.replaceChildren()
    const items = g.inventoryList
    if (items.length === 0) {
      const li = document.createElement('li')
      li.textContent = '가방이 비어 있다.'
      list.append(li)
      return
    }
    for (const item of items) {
      const li = document.createElement('li')
      li.className = 'bag-item'
      const head = document.createElement('p')
      head.textContent = `${item.name} ×${item.count} — ${item.description}`
      li.append(head)

      const group = document.createElement('div')
      group.setAttribute('role', 'group')
      group.setAttribute('aria-label', `${item.name} 처분`)
      const price = g.sellValueOf(item.id)
      group.append(
        this.action(
          `sell-${item.id}`,
          price === null ? '팔 수 없다' : `팔기 — ${price}냥`,
          g.canSell(item.id),
          () => g.sell(item.id),
        ),
      )
      const yielded = g.dismantleYieldOf(item.id)
      group.append(
        this.action(
          `dismantle-${item.id}`,
          yielded === null ? '분해할 수 없다' : `분해 — 재료 ${yielded}개`,
          g.canDismantle(item.id),
          () => g.dismantle(item.id),
        ),
      )
      li.append(group)
      list.append(li)
    }
  }

  private renderUpgrades(): void {
    const g = this.game
    const list = this.dialog.querySelector<HTMLUListElement>('.town-upgrade')!
    list.replaceChildren()
    const max = g.upgradeMaxLevel
    for (const member of g.party) {
      const li = document.createElement('li')
      li.className = 'bag-item'
      const head = document.createElement('p')
      head.textContent = member.isPlayer ? `${member.name} (나)` : member.name
      li.append(head)

      const group = document.createElement('div')
      group.setAttribute('role', 'group')
      group.setAttribute('aria-label', `${member.name} 강화`)
      for (const stat of g.upgradeStats) {
        const level = g.upgradeLevelOf(member.id, stat)
        const cost = g.upgradeCostOf(member.id, stat)
        const name = UPGRADE_STAT_KO[stat as UpgradeStat]
        const label =
          cost === null
            ? `${name} ${max}단계 — 다 올렸다`
            : `${name} ${level}→${level + 1}단계 — ${cost.gold}냥·재료 ${cost.materials}개`
        group.append(
          this.action(`up-${member.id}-${stat}`, label, g.canUpgrade(member.id, stat), () =>
            g.upgrade(member.id, stat),
          ),
        )
      }
      li.append(group)
      list.append(li)
    }
  }

  open(): void {
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.render()
    this.dialog.showModal()
    this.dialog.querySelector<HTMLElement>('#town-close')?.focus()
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
