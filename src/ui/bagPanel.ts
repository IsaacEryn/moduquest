import type { SpriteMode } from '../render/sprites'
import type { Game } from '../core/game'
import { ItemGrid, type GridEntry } from './itemGrid'

/**
 * 가방 — 필드에서 파티 인벤토리를 보고 아이템을 쓴다.
 *
 * 격자에서 물건을 고르면 아래 설명판에 효과가 나오고, 쓸 수 있는 물건이면
 * 누구에게 쓸지 고르는 버튼이 따라 붙는다. 사용 결과 낭독은 itemUsed 이벤트를
 * 받은 Announcer가 맡는다.
 */
export class BagPanel {
  private dialog: HTMLDialogElement
  private prevFocus: Element | null = null
  private closed = true
  private grid: ItemGrid
  private targetsEl: HTMLElement

  constructor(
    private game: Game,
    private hooks: { onOpen?: () => void; onClose?: () => void },
    spriteMode: () => SpriteMode = () => 'normal',
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options bag'
    this.dialog.setAttribute('aria-labelledby', 'bag-title')
    this.dialog.innerHTML = `
      <h2 id="bag-title">가방</h2>
      <div class="bag-body"></div>
      <div class="use-targets"></div>
      <div class="slot-actions">
        <button type="button" id="bag-close">닫기</button>
      </div>
    `
    document.body.append(this.dialog)

    this.targetsEl = this.dialog.querySelector<HTMLElement>('.use-targets')!
    this.grid = new ItemGrid({
      label: '가방에 든 물건',
      spriteMode,
      actions: [],
      emptyText: '가방이 비어 있다. 아이템은 몹과 보물상자에서 얻는다.',
      onSelect: () => this.renderTargets(),
    })
    this.dialog.querySelector<HTMLElement>('.bag-body')!.append(this.grid.el)

    this.dialog.querySelector('#bag-close')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  /** 바깥에서 가방이 바뀌었다 — 함께 하기에서 동료가 꺼낸 물약이 내 화면에도 닿는 길 */
  refresh(): void {
    if (this.dialog.open) this.renderList()
  }

  private renderList(): void {
    const entries: GridEntry[] = this.game.inventoryList.map((row) => ({
      id: row.id,
      item: this.game.items[row.id],
      count: row.count,
    }))
    this.grid.setEntries(entries)
    this.renderTargets()
  }

  /**
   * 동료에게 건네는 줄. 가방이 자리마다 갈리면서 "내게 필요 없지만 저 사람에게는
   * 딱인 것"이 생겼고, 그때 주고받는 것이 협동이 된다. 사람이 앉은 자리에만 보인다 —
   * 컴퓨터가 맡은 자리는 받을 손이 없다.
   */
  private renderGiveRow(itemId: string, itemName: string): void {
    const others = this.game.party.filter(
      (m) => m.seat !== undefined && m.seat !== this.game.localSeat,
    )
    const givable = others.filter((m) => this.game.canGiveItem(itemId, m.seat!).ok)
    if (givable.length === 0) return

    const group = document.createElement('div')
    group.className = 'target-row'
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', `${itemName} 건네기`)
    for (const member of givable) {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = `${member.name}에게 주기`
      b.addEventListener('click', () => {
        if (this.game.giveItem(itemId, member.seat!)) this.renderList()
      })
      group.append(b)
    }
    this.targetsEl.append(group)
  }

  /**
   * 고른 물건으로 할 수 있는 일. 격자 바깥에 두는 이유는, 대상이 파티원이라
   * 물건 목록과 성격이 다르기 때문이다.
   *
   * **쓰는 것과 건네는 것을 갈래로 묶지 않는다.** 처음에는 갈래마다 건네기 줄을
   * 따로 달았는데, 지금 바로 쓸 수 있는 물건(체력 물약)에서만 그것을 빠뜨렸다.
   * 하필 "내게 필요 없지만 저 사람에게는 딱인 것"의 대표가 물약이라, 나눠 갖는
   * 자리에서 가장 아쉬운 구멍이 거기 났다. 건네기는 갈래와 무관하므로 갈래 밖에서
   * 한 번만 부른다 — 갈래가 늘어도 다시 빠지지 않는다.
   */
  private renderTargets(): void {
    this.targetsEl.replaceChildren()
    const selected = this.grid.selected
    if (!selected) return

    const row = this.game.inventoryList.find((r) => r.id === selected.id)
    if (!row) return

    this.renderUseRow(selected, row)
    this.renderGiveRow(selected.id, selected.item.name)
  }

  /** 지금 이 물건을 쓸 수 있는가, 쓸 수 없다면 왜인가 */
  private renderUseRow(
    selected: { id: string; item: { name: string; kind: string } },
    row: { usableInField: boolean; usableInBattle: boolean },
  ): void {
    const note = (text: string): void => {
      const p = document.createElement('p')
      p.className = 'bag-note'
      p.textContent = text
      this.targetsEl.append(p)
    }
    if (row.usableInBattle && !row.usableInField) {
      // 마력·기술 대기는 전투 밖에 존재하지 않는다 — 이유를 밝히는 것이 규칙 설명이다
      note('전투에서만 쓸 수 있다.')
      return
    }
    if (selected.item.kind === 'equipment') {
      note('장비는 상태창에서 입는다.')
      return
    }
    if (!row.usableInField) return

    const group = document.createElement('div')
    group.className = 'target-row'
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', `${selected.item.name} 사용 대상`)
    for (const member of this.game.party) {
      const b = document.createElement('button')
      b.type = 'button'
      const name = member.seat === this.game.localSeat ? '나' : member.name
      b.textContent = `${name}에게 (체력 ${member.hp}/${member.maxHp})`
      // 가득 찬 동료에게는 쓸 수 없다 — 코어 규칙과 같은 이유를 버튼에도 보인다
      b.disabled = member.hp >= member.maxHp
      b.addEventListener('click', () => {
        if (this.game.useItemInField(selected.id, member.id)) {
          this.renderList()
          // 연달아 쓰는 동안 손이 목록 맨 앞으로 튕기지 않게
          this.grid.focusSelected()
        }
      })
      group.append(b)
    }
    this.targetsEl.append(group)
  }

  open(): void {
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.renderList()
    this.dialog.showModal()
    this.dialog.querySelector<HTMLElement>('#bag-close')?.focus()
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
