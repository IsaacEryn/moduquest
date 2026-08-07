import { drawSprite, type SpriteMode } from '../render/sprites'
import { iconForItem } from '../render/itemIcons'
import type { ItemData } from '../core/types'
import { categoryOf, describeItem, itemAriaLabel } from './itemText'

export interface GridEntry {
  id: string
  item: ItemData
  /** 가진 개수. 상점처럼 개수가 없는 곳은 비워 둔다 */
  count?: number
  /** 칸 아래 작게 붙는 값 — 가격 같은 것 */
  badge?: string
  /** 고를 수 없는 칸이면 이유. 칸은 남기고 흐리게 둔다 */
  disabledReason?: string
  /** 칸에 붙는 표시 — "착용 중" 같은 것 */
  tag?: string
}

export interface GridAction {
  /**
   * 버튼에 적힐 말. 고른 물건에 따라 달라져야 할 때가 있다 —
   * 같은 자리가 어떤 물건에는 "입기"이고 이미 입은 물건에는 "해제"다
   */
  label: string | ((entry: GridEntry) => string)
  /** 못 누르는 버튼도 이유를 달고 남는다 */
  can?: (entry: GridEntry) => { ok: boolean; reason?: string }
  run: (entry: GridEntry) => void
}

/**
 * 가방 격자.
 *
 * 보기에는 게임 인벤토리지만 속은 버튼 목록이다. 그래서 마우스로도, 키보드로도,
 * 낭독으로도 똑같이 쓸 수 있다. 화살표로 칸 사이를 옮겨 다니는 건 진짜 인벤토리
 * 조작감을 위한 것이고, Tab 한 번이면 격자를 통째로 지나칠 수 있어서 칸이 많아도
 * 키보드 사용자가 갇히지 않는다.
 *
 * 고른 칸의 자세한 내용은 곁의 설명판에 나온다. 칸 안에 글씨를 욱여넣지 않아야
 * 그림이 커지고, 그림이 커져야 인벤토리처럼 보인다.
 */
export class ItemGrid {
  readonly el: HTMLElement
  private gridEl: HTMLElement
  private detailEl: HTMLElement
  private entries: GridEntry[] = []
  /** 지금 고른 칸의 id. 다시 그려도 유지한다 */
  private selectedId: string | null = null
  private spriteMode: () => SpriteMode

  constructor(
    private opts: {
      label: string
      actions: GridAction[]
      spriteMode: () => SpriteMode
      /** 칸을 고를 때마다 알린다 — 낭독 문장은 부르는 쪽이 정한다 */
      onSelect?: (entry: GridEntry) => void
      emptyText?: string
    },
  ) {
    this.spriteMode = opts.spriteMode
    this.el = document.createElement('div')
    this.el.className = 'item-grid-wrap'

    this.gridEl = document.createElement('div')
    this.gridEl.className = 'item-grid'
    this.gridEl.setAttribute('role', 'group')
    this.gridEl.setAttribute('aria-label', opts.label)
    this.gridEl.addEventListener('keydown', (e) => this.onKeyDown(e))

    this.detailEl = document.createElement('div')
    this.detailEl.className = 'item-detail'
    // 고른 칸이 바뀌면 낭독기가 알아서 읽어 준다
    this.detailEl.setAttribute('aria-live', 'polite')

    this.el.append(this.gridEl, this.detailEl)
  }

  /** 목록을 갈아 끼운다. 고른 칸이 사라졌으면 가까운 칸으로 옮긴다 */
  setEntries(entries: GridEntry[]): void {
    const previousIndex = this.entries.findIndex((e) => e.id === this.selectedId)
    this.entries = entries
    if (entries.length === 0) {
      this.selectedId = null
    } else if (!entries.some((e) => e.id === this.selectedId)) {
      // 팔아서 사라진 칸이면 그 자리에 온 칸으로 — 목록 맨 앞으로 튕기지 않게
      const fallback = previousIndex >= 0 ? Math.min(previousIndex, entries.length - 1) : 0
      this.selectedId = entries[fallback].id
    }
    this.render()
  }

  get selected(): GridEntry | null {
    return this.entries.find((e) => e.id === this.selectedId) ?? null
  }

  /**
   * 고른 칸을 미리 지정한다 — 격자를 새로 만들어야 하는 화면이 손이 있던
   * 자리를 이어받게 하려고 둔다. setEntries보다 먼저 부른다.
   */
  preselect(id: string | null): void {
    this.selectedId = id
  }

  /** 다시 그린 뒤에도 손이 있던 자리를 지킨다 */
  focusSelected(): void {
    this.tileFor(this.selectedId)?.focus()
  }

  private tileFor(id: string | null): HTMLButtonElement | null {
    if (!id) return null
    return this.gridEl.querySelector<HTMLButtonElement>(`[data-id="${CSS.escape(id)}"]`)
  }

  private render(): void {
    this.gridEl.replaceChildren()

    if (this.entries.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'grid-empty'
      empty.textContent = this.opts.emptyText ?? '비어 있다.'
      this.gridEl.append(empty)
      this.renderDetail()
      return
    }

    for (const entry of this.entries) {
      this.gridEl.append(this.tile(entry))
    }
    this.renderDetail()
  }

  private tile(entry: GridEntry): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'item-tile'
    b.dataset.id = entry.id
    const selected = entry.id === this.selectedId
    b.setAttribute('aria-pressed', String(selected))
    // 격자 안에서는 화살표로 옮겨 다닌다. Tab은 격자를 통째로 지나간다
    b.tabIndex = selected ? 0 : -1
    if (entry.disabledReason) b.classList.add('is-locked')
    if (entry.item.tier) b.dataset.tier = String(entry.item.tier)

    b.setAttribute(
      'aria-label',
      itemAriaLabel(entry.item, {
        count: entry.count,
        price: entry.badge,
        extra: [entry.tag, entry.disabledReason].filter(Boolean).join(', ') || undefined,
      }),
    )

    // 그림은 장식이다 — 뜻은 위의 aria-label이 전부 옮긴다
    const icon = drawSprite(iconForItem(entry.id, entry.item), 3, this.spriteMode())
    icon.setAttribute('aria-hidden', 'true')
    icon.className = 'tile-icon'
    b.append(icon)

    if ((entry.count ?? 0) > 1) {
      const n = document.createElement('span')
      n.className = 'tile-count'
      n.setAttribute('aria-hidden', 'true')
      n.textContent = String(entry.count)
      b.append(n)
    }
    if (entry.badge) {
      const badge = document.createElement('span')
      badge.className = 'tile-badge'
      badge.setAttribute('aria-hidden', 'true')
      badge.textContent = entry.badge
      b.append(badge)
    }
    if (entry.tag) {
      const tag = document.createElement('span')
      tag.className = 'tile-tag'
      tag.setAttribute('aria-hidden', 'true')
      tag.textContent = entry.tag
      b.append(tag)
    }

    b.addEventListener('click', () => this.select(entry.id))
    return b
  }

  private select(id: string): void {
    if (this.selectedId === id) return
    this.selectedId = id
    // 칸 전체를 다시 그리지 않고 눌린 상태만 바꾼다 — 포커스가 날아가지 않게
    for (const tile of this.gridEl.querySelectorAll<HTMLButtonElement>('.item-tile')) {
      const on = tile.dataset.id === id
      tile.setAttribute('aria-pressed', String(on))
      tile.tabIndex = on ? 0 : -1
    }
    this.renderDetail()
    const entry = this.selected
    if (entry) this.opts.onSelect?.(entry)
  }

  /** 화살표로 칸 사이를 옮긴다. 한 줄에 몇 칸인지는 실제로 그려진 위치에서 읽는다 */
  private onKeyDown(e: KeyboardEvent): void {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (!keys.includes(e.key)) return
    const index = this.entries.findIndex((en) => en.id === this.selectedId)
    if (index < 0) return
    e.preventDefault()

    const perRow = this.columnCount()
    let next = index
    if (e.key === 'ArrowLeft') next = index - 1
    else if (e.key === 'ArrowRight') next = index + 1
    else if (e.key === 'ArrowUp') next = index - perRow
    else if (e.key === 'ArrowDown') next = index + perRow
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = this.entries.length - 1

    if (next < 0 || next >= this.entries.length) return
    this.select(this.entries[next].id)
    this.focusSelected()
  }

  /** 줄바꿈은 CSS가 정하므로 그려진 위치를 보고 센다 */
  private columnCount(): number {
    const tiles = [...this.gridEl.querySelectorAll<HTMLElement>('.item-tile')]
    if (tiles.length === 0) return 1
    const top = tiles[0].offsetTop
    const inFirstRow = tiles.filter((t) => t.offsetTop === top).length
    return Math.max(1, inFirstRow)
  }

  private renderDetail(): void {
    this.detailEl.replaceChildren()
    const entry = this.selected
    if (!entry) {
      const p = document.createElement('p')
      p.className = 'detail-hint'
      p.textContent = '고른 물건이 없다.'
      this.detailEl.append(p)
      return
    }

    const name = document.createElement('p')
    name.className = 'detail-name'
    name.textContent =
      entry.count && entry.count > 1 ? `${entry.item.name} ×${entry.count}` : entry.item.name

    const category = document.createElement('p')
    category.className = 'detail-category'
    category.textContent = [categoryOf(entry.item), entry.badge].filter(Boolean).join(' · ')

    this.detailEl.append(name, category)

    const effect = describeItem(entry.item)
    if (effect) {
      const p = document.createElement('p')
      p.className = 'detail-effect'
      p.textContent = effect
      this.detailEl.append(p)
    }

    const flavor = document.createElement('p')
    flavor.className = 'detail-flavor'
    flavor.textContent = entry.item.description
    this.detailEl.append(flavor)

    if (entry.disabledReason) {
      const why = document.createElement('p')
      why.className = 'detail-locked'
      why.textContent = entry.disabledReason
      this.detailEl.append(why)
    }

    const actions = document.createElement('div')
    actions.className = 'detail-actions'
    for (const action of this.opts.actions) {
      const can = action.can?.(entry) ?? { ok: true }
      const label = typeof action.label === 'function' ? action.label(entry) : action.label
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = can.ok || !can.reason ? label : `${label} (${can.reason})`
      b.disabled = !can.ok
      b.addEventListener('click', () => action.run(entry))
      actions.append(b)
    }
    this.detailEl.append(actions)
  }

  /** 거래 뒤 다시 그릴 때, 설명판의 같은 자리 버튼으로 손을 돌려준다 */
  focusAction(index = 0): void {
    const buttons = this.detailEl.querySelectorAll<HTMLButtonElement>(
      '.detail-actions button:not([disabled])',
    )
    ;(buttons[index] ?? buttons[0])?.focus()
  }
}
