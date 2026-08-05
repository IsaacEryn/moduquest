import type { Game } from '../core/game'

/**
 * 가방 — 필드에서 파티 인벤토리를 보고 아이템을 쓴다.
 * 내용이 매번 달라지므로 열 때마다 목록을 다시 만든다.
 * 사용 결과 낭독은 itemUsed 이벤트를 받은 Announcer가 맡는다.
 */
export class BagPanel {
  private dialog: HTMLDialogElement
  private prevFocus: Element | null = null
  private closed = true

  constructor(
    private game: Game,
    private hooks: { onOpen?: () => void; onClose?: () => void },
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options bag'
    this.dialog.setAttribute('aria-labelledby', 'bag-title')
    this.dialog.innerHTML = `
      <h2 id="bag-title">가방</h2>
      <ul class="bag-list"></ul>
      <div class="slot-actions">
        <button type="button" id="bag-close">닫기</button>
      </div>
    `
    document.body.append(this.dialog)
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
    const list = this.dialog.querySelector<HTMLUListElement>('.bag-list')!
    list.replaceChildren()

    const items = this.game.inventoryList
    if (items.length === 0) {
      const li = document.createElement('li')
      li.textContent = '가방이 비어 있다. 아이템은 몹과 보물상자에서 얻는다.'
      list.append(li)
      return
    }

    for (const item of items) {
      const li = document.createElement('li')
      li.className = 'bag-item'
      const head = document.createElement('p')
      head.textContent = `${item.name} ×${item.count} — ${item.description}`
      li.append(head)

      if (item.usableInField) {
        const group = document.createElement('div')
        group.setAttribute('role', 'group')
        group.setAttribute('aria-label', `${item.name} 사용 대상`)
        for (const member of this.game.party) {
          const b = document.createElement('button')
          b.type = 'button'
          const name = member.isPlayer ? '나' : member.name
          b.textContent = `${name}에게 (체력 ${member.hp}/${member.maxHp})`
          // 가득 찬 동료에게는 쓸 수 없다 — 코어 규칙과 같은 이유를 버튼에도 보인다
          b.disabled = member.hp >= member.maxHp
          b.addEventListener('click', () => {
            if (this.game.useItemInField(item.id, member.id)) this.renderList()
          })
          group.append(b)
        }
        li.append(group)
      } else if (item.usableInBattle) {
        // 마력·기술 대기는 전투 밖에 존재하지 않는다 — 이유를 밝히는 것이 규칙 설명이다
        const note = document.createElement('p')
        note.className = 'bag-note'
        note.textContent = '전투에서만 쓸 수 있다.'
        li.append(note)
      } else if (item.kind === 'equipment') {
        const note = document.createElement('p')
        note.className = 'bag-note'
        note.textContent = '장비는 상태창에서 입는다.'
        li.append(note)
      }
      list.append(li)
    }
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
