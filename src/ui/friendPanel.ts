import { josa } from './announcer'
import {
  acceptFriend,
  addFriendByCode,
  loadFriends,
  removeFriendship,
  type FriendState,
} from '../net/friends'

/**
 * 친구 목록 — 신청하고, 수락하고, 끊는다.
 *
 * 목록에 있다는 것은 두 사람이 다 허락했다는 뜻이다. 그래서 여기서는 초대 코드를
 * 부르지 않고 이름을 골라 모험단에 부를 수 있다.
 *
 * 지우기는 한 번 더 묻는다 — 친구를 끊는 것은 되돌릴 수 없고, 잘못 누른 것과
 * 정말 끊으려는 것을 화면이 구분해 주지 않으면 실수가 곧 손실이 된다.
 */
export class FriendPanel {
  private dialog: HTMLDialogElement
  private body: HTMLElement
  private prevFocus: Element | null = null
  private closed = true
  private busy = false
  private state: FriendState = { friends: [], incoming: [], outgoing: [] }
  /** 끊기 확인 중인 상대 */
  private confirming: string | null = null

  constructor(
    private hooks: {
      onOpen?: () => void
      onClose?: () => void
      announce: (text: string) => void
      myFriendCode: () => string
      /**
       * 지금 모험단이 있으면 그 초대 코드. 없으면 null —
       * 친구를 부르려면 먼저 모험단이 있어야 한다
       */
      partyCode: () => string | null
      invite: (userId: string, nickname: string) => Promise<void>
    },
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options coop'
    this.dialog.setAttribute('aria-labelledby', 'friends-title')
    this.dialog.innerHTML = `
      <h2 id="friends-title">친구</h2>
      <p class="intro"></p>
      <div class="friends-body"></div>
      <div class="slot-actions">
        <button type="button" id="friends-close">닫기</button>
      </div>
    `
    document.body.append(this.dialog)
    this.body = this.dialog.querySelector('.friends-body')!
    this.dialog.querySelector('#friends-close')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  async open(): Promise<void> {
    this.closed = false
    this.confirming = null
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.dialog.querySelector('.intro')!.textContent =
      `내 친구 코드: ${this.hooks.myFriendCode()} — 이 코드를 알려주면 친구가 될 수 있다.`
    this.dialog.showModal()
    this.renderLoading()
    await this.reload()
  }

  private renderLoading(): void {
    this.body.replaceChildren()
    const p = document.createElement('p')
    p.textContent = '친구 목록을 불러오는 중…'
    this.body.append(p)
  }

  private async reload(): Promise<void> {
    try {
      this.state = await loadFriends()
    } catch {
      this.body.replaceChildren()
      const p = document.createElement('p')
      p.className = 'form-error'
      p.textContent = '친구 목록을 불러오지 못했다. 잠시 뒤에 다시.'
      this.body.append(p)
      return
    }
    this.render()
  }

  private render(): void {
    this.body.replaceChildren()
    this.body.append(this.addForm())
    if (this.state.incoming.length) {
      this.body.append(this.section('받은 신청', this.state.incoming, 'incoming'))
    }
    this.body.append(this.section('친구', this.state.friends, 'friend'))
    if (this.state.outgoing.length) {
      this.body.append(this.section('보낸 신청', this.state.outgoing, 'outgoing'))
    }
  }

  /** 친구 코드로 신청 */
  private addForm(): HTMLElement {
    const form = document.createElement('form')
    form.setAttribute('aria-label', '친구 신청')
    const row = document.createElement('p')
    row.className = 'form-row'
    const label = document.createElement('label')
    label.htmlFor = 'friend-code'
    label.textContent = '친구 코드로 신청 (8글자)'
    const input = document.createElement('input')
    input.id = 'friend-code'
    input.type = 'text'
    input.maxLength = 8
    input.required = true
    input.style.textTransform = 'uppercase'
    row.append(label, input)

    const err = document.createElement('p')
    err.className = 'form-error'
    err.setAttribute('role', 'alert')

    const submit = document.createElement('button')
    submit.type = 'submit'
    submit.textContent = '신청 보내기'
    form.append(row, err, submit)

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      if (this.busy) return
      this.busy = true
      submit.disabled = true
      err.textContent = ''
      addFriendByCode(input.value)
        .then(async (result) => {
          const say = (text: string) => {
            this.hooks.announce(text)
            err.textContent = ''
          }
          switch (result.kind) {
            case 'requested':
              say(`${result.nickname}에게 친구 신청을 보냈다.`)
              input.value = ''
              break
            case 'accepted':
              say(`${josa(result.nickname, '과', '와')} 친구가 됐다. 먼저 신청해 두었더라.`)
              input.value = ''
              break
            case 'already':
              err.textContent = `${josa(result.nickname, '과', '와')}는 이미 신청이 오갔다.`
              break
            case 'self':
              err.textContent = '내 코드다.'
              break
            case 'not-found':
              err.textContent = '그 코드의 사람을 찾지 못했다.'
              break
          }
          if (err.textContent) this.hooks.announce(err.textContent)
          await this.reload()
          this.dialog.querySelector<HTMLElement>('#friend-code')?.focus()
        })
        .catch((e2: Error) => {
          err.textContent = e2.message
          this.hooks.announce(e2.message)
        })
        .finally(() => {
          this.busy = false
          submit.disabled = false
        })
    })
    return form
  }

  private section(
    title: string,
    entries: { userId: string; nickname: string }[],
    kind: 'friend' | 'incoming' | 'outgoing',
  ): HTMLElement {
    const box = document.createElement('section')
    const h = document.createElement('h3')
    h.textContent = `${title} (${entries.length})`
    box.append(h)

    if (entries.length === 0) {
      const p = document.createElement('p')
      p.className = 'status-note'
      p.textContent = '아직 친구가 없다. 친구 코드를 주고받아 신청해 보자.'
      box.append(p)
      return box
    }

    const list = document.createElement('ul')
    list.className = 'coop-roster'
    const partyCode = this.hooks.partyCode()

    for (const entry of entries) {
      const li = document.createElement('li')
      const name = document.createElement('p')
      name.className = 'friend-name'
      name.textContent = entry.nickname
      li.append(name)

      const actions = document.createElement('div')
      actions.className = 'friend-actions'

      if (this.confirming === entry.userId) {
        // 확인을 묻는 줄에 표를 남긴다 — 손을 돌려줄 자리를 이것으로 찾는다
        li.dataset.confirming = 'true'
        // 끊기 전 한 번 더 — 되돌릴 수 없는 일에는 확인 단계를 둔다
        const ask = document.createElement('p')
        ask.className = 'slot-confirm'
        ask.textContent =
          kind === 'friend'
            ? `${josa(entry.nickname, '과', '와')} 친구를 끊을까? 다시 신청해야 친구가 된다.`
            : '이 신청을 없앨까?'
        li.append(ask)
        actions.append(
          this.button(kind === 'friend' ? '정말 끊기' : '정말 없애기', async () => {
            await removeFriendship(entry.userId)
            this.confirming = null
            this.hooks.announce(
              kind === 'friend'
                ? `${josa(entry.nickname, '과', '와')} 친구를 끊었다.`
                : '신청을 없앴다.',
            )
            await this.reload()
          }),
          this.button('그만두기', async () => {
            this.confirming = null
            this.render()
          }, 'alt-action'),
        )
        li.append(actions)
        list.append(li)
        continue
      }

      if (kind === 'friend') {
        if (partyCode) {
          actions.append(
            this.button('모험단으로 초대', async () => {
              await this.hooks.invite(entry.userId, entry.nickname)
            }),
          )
        } else {
          const note = document.createElement('p')
          note.className = 'status-note'
          note.textContent = '모험단을 만들면 여기서 부를 수 있다.'
          li.append(note)
        }
        actions.append(this.button('친구 끊기', async () => this.askConfirm(entry.userId), 'alt-action'))
      } else if (kind === 'incoming') {
        actions.append(
          this.button('수락', async () => {
            const ok = await acceptFriend(entry.userId)
            this.hooks.announce(
              ok ? `${josa(entry.nickname, '과', '와')} 친구가 됐다.` : '이미 정리된 신청이다.',
            )
            await this.reload()
          }),
          this.button('거절', async () => this.askConfirm(entry.userId), 'alt-action'),
        )
      } else {
        const note = document.createElement('p')
        note.className = 'status-note'
        note.textContent = '상대의 대답을 기다린다.'
        li.append(note)
        actions.append(this.button('신청 취소', async () => this.askConfirm(entry.userId), 'alt-action'))
      }

      li.append(actions)
      list.append(li)
    }
    box.append(list)
    return box
  }

  private askConfirm(userId: string): void {
    this.confirming = userId
    this.render()
    /*
      확인 버튼으로 손을 옮겨 준다 — 키보드만 쓰는 사람이 확인 단계를 놓치지 않게.

      예전에는 창 안의 첫 번째 friend-actions 버튼을 잡았는데, 그것은 문서 순서상
      맨 위 항목의 버튼이지 지금 묻고 있는 항목의 것이 아니다. 받은 신청이 있거나
      끊으려는 사람이 목록 중간이면, 손이 남의 줄의 '수락'이나 '모험단으로 초대'에
      놓였다 — 확인을 놓치지 말라고 만든 장치가 엉뚱한 곳에서 Enter를 부르는 셈이다.
    */
    this.body
      .querySelector<HTMLElement>('li[data-confirming] .friend-actions button')
      ?.focus()
  }

  private button(label: string, run: () => Promise<void>, className?: string): HTMLButtonElement {
    const b = document.createElement('button')
    b.type = 'button'
    b.textContent = label
    if (className) b.className = className
    b.addEventListener('click', () => {
      if (this.busy) return
      this.busy = true
      b.disabled = true
      void run()
        .catch((e: Error) => this.hooks.announce(e.message))
        .finally(() => {
          this.busy = false
          b.disabled = false
        })
    })
    return b
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
    // 열 때마다 새로 만드는 창이라 닫으면 치운다 — 남겨 두면 다음 창과 id가
    // 겹쳐서 라벨이 옛 노드에 묶인다(giftPanel에 같은 사정을 적어 두었다)
    this.dialog.remove()
    this.hooks.onClose?.()
  }
}
