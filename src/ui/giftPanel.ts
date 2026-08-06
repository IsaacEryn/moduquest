import {
  GIFT_MESSAGES,
  addToSnapshot,
  claimGift,
  giftableReason,
  lookupFriend,
  listIncoming,
  removeFromSnapshot,
  sendGift,
  type GiftRow,
} from '../net/gifts'
import type { SaveRepository } from '../save/saveRepository'
import type { GameData } from '../core/types'

/**
 * 선물함 — 세션 밖의 비동기 우편. 타이틀의 함께 하기에서 들어온다.
 * 보내기는 내 저장 기록에서 빼서 부치고, 받기는 고른 자리의 기록에 담는다.
 * 실시간 파티와 무관하게 서로의 모험을 도울 수 있다.
 */
export class GiftPanel {
  private dialog: HTMLDialogElement
  private body: HTMLElement
  private prevFocus: Element | null = null
  private closed = true
  private friendCode = ''

  constructor(
    private data: GameData,
    private saves: SaveRepository,
    private hooks: {
      onOpen?: () => void
      onClose?: () => void
      announce: (text: string) => void
      myFriendCode: () => string
    },
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options coop'
    this.dialog.setAttribute('aria-labelledby', 'gift-title')
    this.dialog.innerHTML = `
      <h2 id="gift-title">선물함</h2>
      <p class="intro"></p>
      <section aria-labelledby="gift-in-h"><h3 id="gift-in-h">받은 선물</h3>
        <div class="gift-in"></div></section>
      <section aria-labelledby="gift-out-h"><h3 id="gift-out-h">보내기</h3>
        <div class="gift-out"></div></section>
      <button type="button" id="gift-close">닫기</button>
    `
    document.body.append(this.dialog)
    this.body = this.dialog
    this.dialog.querySelector('#gift-close')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  async open(): Promise<void> {
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.dialog.querySelector('.intro')!.textContent =
      `내 친구 코드: ${this.hooks.myFriendCode()} — 이 코드를 알려주면 선물을 받을 수 있다.`
    this.dialog.showModal()
    this.renderSendForm()
    await this.renderIncoming()
  }

  // --- 받기 ---

  private async renderIncoming(): Promise<void> {
    const box = this.body.querySelector<HTMLElement>('.gift-in')!
    box.textContent = '확인하는 중…'
    let gifts: GiftRow[] = []
    try {
      gifts = await listIncoming()
    } catch {
      box.textContent = '선물함을 여는 데 실패했다. 잠시 뒤에 다시.'
      return
    }
    box.replaceChildren()
    if (gifts.length === 0) {
      box.textContent = '받은 선물이 없다.'
      return
    }

    // 받을 자리 — 저장 기록이 있어야 담을 곳이 있다
    // 목록을 먼저 만든다 — 아래 비동기 콜백이 이 변수를 읽는다.
    // 선언보다 뒤에 있던 시절에는 마이크로태스크 순서 덕에 겨우 동작했고,
    // await 한 줄만 늘어도 TDZ 오류가 났을 자리다
    const list = document.createElement('ul')
    list.className = 'coop-roster'

    const row = document.createElement('p')
    row.className = 'form-row'
    const label = document.createElement('label')
    label.htmlFor = 'gift-slot'
    label.textContent = '받을 저장 자리'
    const select = document.createElement('select')
    select.id = 'gift-slot'
    void this.saves.list().then((slots) => {
      for (const s of slots) {
        if (s.empty) continue
        const o = document.createElement('option')
        o.value = String(s.slot)
        o.textContent = `${s.slot + 1}번 자리`
        select.append(o)
      }
      if (!select.options.length) {
        box.prepend('저장된 모험 기록이 있어야 선물을 받을 수 있다.')
        list.querySelectorAll('button').forEach((b) => (b.disabled = true))
      }
    })
    row.append(label, select)
    box.append(row)
    for (const g of gifts) {
      const item = this.data.items[g.itemId]
      const li = document.createElement('li')
      const desc = document.createElement('p')
      const msg = g.messageId ? ` — "${GIFT_MESSAGES[g.messageId] ?? ''}"` : ''
      desc.textContent = `${g.fromNickname}의 선물: ${item?.name ?? g.itemId} ×${g.qty}${msg}`
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.textContent = '받기'
      btn.addEventListener('click', () => void this.claim(g, select, btn))
      li.append(desc, btn)
      list.append(li)
    }
    box.append(list)
  }

  private async claim(g: GiftRow, select: HTMLSelectElement, btn: HTMLButtonElement): Promise<void> {
    if (select.value === '') {
      this.hooks.announce('받을 저장 자리를 먼저 고르자.')
      return
    }
    const slot = Number(select.value)
    const snapshot = await this.saves.load(slot)
    if (!snapshot) {
      this.hooks.announce('그 자리의 기록을 읽을 수 없다.')
      return
    }
    // 모르는 물건은 받지 않는다 — 서버 데이터도 검증을 지난다
    const item = this.data.items[g.itemId]
    if (!item || !giftableReason(g.itemId, this.data).ok) {
      this.hooks.announce('받을 수 없는 물건이다.')
      return
    }
    const fits = addToSnapshot(snapshot, g.itemId, g.qty)
    if (!fits.ok) {
      this.hooks.announce(fits.reason ?? '가방이 가득하다.')
      return
    }
    btn.disabled = true
    // 서버가 먼저다 — 두 번 받는 길을 서버가 막는다. 실패하면 가방도 그대로다
    const claimed = await claimGift(g.id)
    if (!claimed) {
      this.hooks.announce('이미 받았거나 받을 수 없는 선물이다.')
      await this.renderIncoming()
      return
    }
    await this.saves.save(slot, snapshot)
    this.hooks.announce(`${item.name}를 ${slot + 1}번 자리에 담았다.`)
    await this.renderIncoming()
  }

  // --- 보내기 ---

  private renderSendForm(): void {
    const box = this.body.querySelector<HTMLElement>('.gift-out')!
    box.replaceChildren()

    const form = document.createElement('form')
    form.setAttribute('aria-label', '선물 보내기')
    const row = document.createElement('p')
    row.className = 'form-row'
    const label = document.createElement('label')
    label.htmlFor = 'gift-code'
    label.textContent = '상대의 친구 코드 (8글자)'
    const input = document.createElement('input')
    input.id = 'gift-code'
    input.type = 'text'
    input.maxLength = 8
    input.required = true
    input.value = this.friendCode
    input.style.textTransform = 'uppercase'
    row.append(label, input)
    const err = document.createElement('p')
    err.className = 'form-error'
    err.setAttribute('role', 'alert')
    const find = document.createElement('button')
    find.type = 'submit'
    find.textContent = '상대 찾기'
    form.append(row, err, find)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      err.textContent = ''
      this.friendCode = input.value.trim().toUpperCase()
      void lookupFriend(this.friendCode).then((friend) => {
        if (!friend) {
          err.textContent = '그 코드의 사람을 찾지 못했다.'
          this.hooks.announce(err.textContent)
          return
        }
        void this.renderPicker(box, friend)
      })
    })
    box.append(form)
  }

  /** 상대를 찾았다 — 어느 기록의 어떤 물건을 보낼지 고른다 */
  private async renderPicker(
    box: HTMLElement,
    friend: { userId: string; nickname: string },
  ): Promise<void> {
    const old = box.querySelector('.gift-picker')
    old?.remove()
    const picker = document.createElement('div')
    picker.className = 'gift-picker'

    const head = document.createElement('p')
    head.textContent = `${friend.nickname}에게 보낸다. 어느 기록의 물건을 보낼까?`
    picker.append(head)

    const slotRow = document.createElement('p')
    slotRow.className = 'form-row'
    const slotLabel = document.createElement('label')
    slotLabel.htmlFor = 'gift-src'
    slotLabel.textContent = '보낼 물건이 있는 저장 자리'
    const slotSel = document.createElement('select')
    slotSel.id = 'gift-src'
    const slots = await this.saves.list()
    for (const s of slots) {
      if (s.empty) continue
      const o = document.createElement('option')
      o.value = String(s.slot)
      o.textContent = `${s.slot + 1}번 자리`
      slotSel.append(o)
    }
    slotRow.append(slotLabel, slotSel)
    picker.append(slotRow)
    if (!slotSel.options.length) {
      head.textContent = '저장된 모험 기록이 있어야 보낼 물건이 있다.'
      box.append(picker)
      return
    }

    const msgRow = document.createElement('p')
    msgRow.className = 'form-row'
    const msgLabel = document.createElement('label')
    msgLabel.htmlFor = 'gift-msg'
    msgLabel.textContent = '한마디'
    const msgSel = document.createElement('select')
    msgSel.id = 'gift-msg'
    const noneOpt = document.createElement('option')
    noneOpt.value = ''
    noneOpt.textContent = '없이 보낸다'
    msgSel.append(noneOpt)
    for (const [id, text] of Object.entries(GIFT_MESSAGES)) {
      const o = document.createElement('option')
      o.value = id
      o.textContent = text
      msgSel.append(o)
    }
    msgRow.append(msgLabel, msgSel)
    picker.append(msgRow)

    const list = document.createElement('ul')
    list.className = 'coop-roster'
    const renderItems = async () => {
      list.replaceChildren()
      const slot = Number(slotSel.value)
      const snapshot = await this.saves.load(slot)
      if (!snapshot) return
      const giftable = snapshot.inventory.filter((e) => giftableReason(e.item, this.data).ok)
      if (giftable.length === 0) {
        const li = document.createElement('li')
        li.textContent = '이 기록에는 보낼 수 있는 물건이 없다.'
        list.append(li)
        return
      }
      for (const e of giftable) {
        const item = this.data.items[e.item]
        const li = document.createElement('li')
        const desc = document.createElement('p')
        desc.textContent = `${item?.name ?? e.item} ×${e.count}`
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.textContent = '하나 보내기'
        btn.addEventListener('click', () => {
          btn.disabled = true
          void this.send(friend, slot, e.item, msgSel.value || null)
            .then(() => renderItems())
            .finally(() => (btn.disabled = false))
        })
        li.append(desc, btn)
        list.append(li)
      }
    }
    slotSel.addEventListener('change', () => void renderItems())
    picker.append(list)
    box.append(picker)
    await renderItems()
  }

  private async send(
    friend: { userId: string; nickname: string },
    slot: number,
    itemId: string,
    messageId: string | null,
  ): Promise<void> {
    const snapshot = await this.saves.load(slot)
    if (!snapshot || !removeFromSnapshot(snapshot, itemId)) {
      this.hooks.announce('그 물건이 가방에 없다.')
      return
    }
    // 내 기록에서 먼저 뺀다 — 어긋나도 복제가 아니라 분실 방향이다
    await this.saves.save(slot, snapshot)
    try {
      await sendGift(friend.userId, itemId, messageId)
      const item = this.data.items[itemId]
      this.hooks.announce(`${friend.nickname}에게 ${item?.name ?? itemId}를 보냈다.`)
    } catch (err) {
      // 부치지 못했다 — 뺐던 것을 돌려놓는다
      const back = await this.saves.load(slot)
      if (back) {
        addToSnapshot(back, itemId, 1)
        await this.saves.save(slot, back)
      }
      this.hooks.announce(err instanceof Error ? err.message : '선물을 보내지 못했다.')
    }
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
