import { currentProfile, saveNickname, signIn, signOut, signUp, validNickname, type Profile } from '../net/auth'
import type { PartySession } from '../net/session'
import { hasSupabaseConfig } from '../net/supabaseClient'

type View = 'auth' | 'home' | 'room'

/**
 * 함께 하기의 문. 로그인(가입) → 모험단 만들기/참가 → 로비까지 한 창에서.
 * 이 파일 전체가 동적 import로만 불린다 — 솔로 플레이는 이 코드를 읽지도 않는다.
 */
export class CoopPanel {
  private dialog: HTMLDialogElement
  private body: HTMLElement
  private prevFocus: Element | null = null
  private closed = true
  private view: View = 'auth'
  private profile: Profile | null = null
  private busy = false

  constructor(
    private hooks: {
      onOpen?: () => void
      onClose?: () => void
      announce: (text: string) => void
      /** 세션을 만들거나 참가한다 — 실제 생성은 main이 한다(게임·데이터 접근) */
      createSession: (me: { userId: string; nickname: string }) => Promise<PartySession>
      joinSession: (code: string, me: { userId: string; nickname: string }) => Promise<PartySession>
      currentSession: () => PartySession | null
      /** 호스트의 출발 — 기존 새로 시작/이어서 하기 흐름을 되쓴다 */
      hostStartNew: () => void
      hostStartContinue: () => void
      /** 게스트의 저장 자리 — null이면 이번 모험을 저장하지 않는다 */
      setGuestSlot: (slot: number | null) => void
      describeSlots: () => Promise<string[]>
      /** 선물함 열기 — 세션과 무관한 비동기 우편 */
      openGifts: (me: Profile) => void
    },
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options coop'
    this.dialog.setAttribute('aria-labelledby', 'coop-title')
    this.dialog.innerHTML = `
      <h2 id="coop-title">함께 하기</h2>
      <div class="coop-body"></div>
      <button type="button" id="coop-close">닫기</button>
    `
    document.body.append(this.dialog)
    this.body = this.dialog.querySelector('.coop-body')!
    this.dialog.querySelector('#coop-close')!.addEventListener('click', () => this.requestClose())
    this.dialog.addEventListener('close', () => this.afterClose())
    this.dialog.addEventListener('cancel', (e) => {
      // ESC로도 모험단에서 조용히 빠지지 않게 — 닫기와 같은 길을 걷는다
      e.preventDefault()
      this.requestClose()
    })
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  async open(): Promise<void> {
    if (!hasSupabaseConfig()) {
      this.hooks.announce('함께 하기 서버가 아직 연결되지 않았다. 지금은 혼자 모험할 수 있다.')
      return
    }
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.dialog.showModal()
    this.renderLoading('로그인 상태를 확인하는 중…')
    try {
      this.profile = await currentProfile()
    } catch {
      this.profile = null
    }
    this.view = this.hooks.currentSession() ? 'room' : this.profile ? 'home' : 'auth'
    this.render()
  }

  /** 세션 로스터가 바뀔 때 main이 부른다 */
  refreshRoster(): void {
    if (this.dialog.open && this.view === 'room') this.render()
  }

  /** 모험이 시작됐다 — 로비는 물러난다 */
  onStarted(): void {
    this.close()
  }

  private requestClose(): void {
    const session = this.hooks.currentSession()
    if (session && !session.started) {
      // 로비에 있는 모험단을 떠난다 — 시작 전이니 잃을 것은 없다
      session.leave()
    }
    this.close()
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

  // --- 그리기 ---

  private renderLoading(text: string): void {
    this.body.replaceChildren()
    const p = document.createElement('p')
    p.textContent = text
    this.body.append(p)
  }

  private render(): void {
    this.body.replaceChildren()
    if (this.view === 'auth') this.renderAuth()
    else if (this.view === 'home') this.renderHome()
    else this.renderRoom()
  }

  private field(
    form: HTMLElement,
    id: string,
    label: string,
    type: string,
    autocomplete: string,
  ): HTMLInputElement {
    const row = document.createElement('p')
    row.className = 'form-row'
    const l = document.createElement('label')
    l.htmlFor = id
    l.textContent = label
    const input = document.createElement('input')
    input.id = id
    input.type = type
    input.setAttribute('autocomplete', autocomplete)
    input.required = true
    row.append(l, input)
    form.append(row)
    return input
  }

  private errorLine(form: HTMLElement): (msg: string) => void {
    const p = document.createElement('p')
    p.className = 'form-error'
    p.id = `err-${Math.random().toString(36).slice(2, 8)}`
    p.setAttribute('role', 'alert')
    form.append(p)
    return (msg: string) => {
      p.textContent = msg
      if (msg) this.hooks.announce(msg)
    }
  }

  /** 로그인·가입 — 같은 판에서 전환한다 */
  private renderAuth(signup = false): void {
    this.body.replaceChildren()
    const intro = document.createElement('p')
    intro.className = 'intro'
    intro.textContent = signup
      ? '처음이면 계정을 만들자. 닉네임은 동료들에게 보이는 이름이다.'
      : '함께 하려면 로그인이 필요하다. 혼자 하는 모험은 로그인 없이 그대로다.'
    this.body.append(intro)

    const form = document.createElement('form')
    form.setAttribute('aria-label', signup ? '가입' : '로그인')
    const email = this.field(form, 'coop-email', '이메일', 'email', 'email')
    const pw = this.field(
      form,
      'coop-pw',
      '비밀번호 (8자 이상)',
      'password',
      signup ? 'new-password' : 'current-password',
    )
    let nick: HTMLInputElement | null = null
    if (signup) {
      nick = this.field(form, 'coop-nick', '닉네임 (12자까지)', 'text', 'nickname')
      nick.maxLength = 12
    }
    const setError = this.errorLine(form)

    const submit = document.createElement('button')
    submit.type = 'submit'
    submit.textContent = signup ? '가입하고 시작' : '로그인'
    form.append(submit)

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'link-like'
    toggle.textContent = signup ? '이미 계정이 있다 — 로그인' : '계정이 없다 — 가입하기'
    toggle.addEventListener('click', () => this.renderAuth(!signup))

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      if (this.busy) return
      const nickname = nick?.value.trim() ?? ''
      if (signup && !validNickname(nickname)) {
        setError('닉네임은 1자에서 12자까지다.')
        return
      }
      this.busy = true
      submit.disabled = true
      setError('')
      const task = signup
        ? signUp(email.value.trim(), pw.value, nickname)
        : signIn(email.value.trim(), pw.value)
      task
        .then(async (profile) => {
          if (!profile.nickname) {
            const n = nickname || '모험가'
            await saveNickname(profile.userId, n)
            profile = { ...profile, nickname: n }
          }
          this.profile = profile
          this.hooks.announce(`${profile.nickname}로 로그인했다.`)
          this.view = 'home'
          this.render()
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => {
          this.busy = false
          submit.disabled = false
        })
    })

    this.body.append(form, toggle)
    email.focus()
  }

  /** 로그인 후 첫 화면 — 만들거나, 코드로 참가하거나 */
  private renderHome(): void {
    const me = this.profile!
    const hello = document.createElement('p')
    hello.className = 'intro'
    hello.textContent = `${me.nickname} — 모험단을 만들거나, 초대 코드로 참가하자.`
    this.body.append(hello)

    const makeBtn = document.createElement('button')
    makeBtn.type = 'button'
    makeBtn.textContent = '모험단 만들기'
    makeBtn.addEventListener('click', () => {
      if (this.busy) return
      this.busy = true
      makeBtn.disabled = true
      this.hooks
        .createSession({ userId: me.userId, nickname: me.nickname })
        .then(() => {
          this.view = 'room'
          this.render()
          this.hooks.announce('모험단을 만들었다. 초대 코드를 동료에게 알리자.')
        })
        .catch((err: Error) => this.hooks.announce(err.message))
        .finally(() => {
          this.busy = false
          makeBtn.disabled = false
        })
    })

    const joinForm = document.createElement('form')
    joinForm.setAttribute('aria-label', '초대 코드로 참가')
    const code = this.field(joinForm, 'coop-code', '초대 코드 (8글자)', 'text', 'off')
    code.maxLength = 8
    code.style.textTransform = 'uppercase'
    const setError = this.errorLine(joinForm)
    const joinBtn = document.createElement('button')
    joinBtn.type = 'submit'
    joinBtn.textContent = '참가하기'
    joinForm.append(joinBtn)
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault()
      if (this.busy) return
      this.busy = true
      joinBtn.disabled = true
      setError('')
      this.hooks.announce('모험단을 찾는 중…')
      this.hooks
        .joinSession(code.value, { userId: me.userId, nickname: me.nickname })
        .then(() => {
          this.view = 'room'
          this.render()
          this.hooks.announce('모험단에 들어왔다. 방장이 출발하기를 기다린다.')
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => {
          this.busy = false
          joinBtn.disabled = false
        })
    })

    const gifts = document.createElement('button')
    gifts.type = 'button'
    gifts.textContent = '선물함'
    gifts.addEventListener('click', () => this.hooks.openGifts(me))

    const out = document.createElement('button')
    out.type = 'button'
    out.className = 'link-like'
    out.textContent = '로그아웃'
    out.addEventListener('click', () => {
      void signOut().then(() => {
        this.profile = null
        this.view = 'auth'
        this.render()
        this.hooks.announce('로그아웃했다.')
      })
    })

    this.body.append(makeBtn, joinForm, out)
    makeBtn.focus()
  }

  /** 로비 — 코드, 자리, 출발 */
  private renderRoom(): void {
    const session = this.hooks.currentSession()
    if (!session) {
      this.view = 'home'
      this.render()
      return
    }

    const codeLine = document.createElement('p')
    codeLine.className = 'coop-code'
    codeLine.textContent = `초대 코드: ${session.code}`
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.textContent = '코드 복사'
    copy.addEventListener('click', () => {
      void navigator.clipboard?.writeText(session.code).then(
        () => this.hooks.announce('초대 코드를 복사했다.'),
        () => this.hooks.announce(`복사가 막혔다. 코드는 ${session.code}.`),
      )
    })

    const roster = document.createElement('ul')
    roster.className = 'coop-roster'
    roster.setAttribute('aria-label', '모험단 자리')
    for (const seat of [0, 1, 2]) {
      const li = document.createElement('li')
      const info = session.seats.find((s) => s.seat === seat)
      const role = seat === 0 ? '방장' : `${seat + 1}번 자리`
      if (!info) li.textContent = `${role} — 비어 있다`
      else {
        const who = info.userId === session.userId ? `${info.nickname} (나)` : info.nickname
        li.textContent = `${role} — ${who}${info.controller === 'npc' ? ' (잠시 자리 비움)' : ''}`
      }
      roster.append(li)
    }

    this.body.append(codeLine, copy, roster)

    if (session.isHost) {
      const startNew = document.createElement('button')
      startNew.type = 'button'
      startNew.textContent = '새 모험으로 출발'
      startNew.addEventListener('click', () => this.hooks.hostStartNew())
      const startCont = document.createElement('button')
      startCont.type = 'button'
      startCont.textContent = '저장된 기록에서 출발'
      startCont.addEventListener('click', () => this.hooks.hostStartContinue())
      const note = document.createElement('p')
      note.className = 'intro'
      note.textContent =
        '혼자여도 출발할 수 있다. 동료는 모험 중에도 초대 코드로 합류한다.'
      this.body.append(startNew, startCont, note)
      startNew.focus()
    } else {
      const wait = document.createElement('p')
      wait.className = 'intro'
      wait.textContent = '방장이 출발하면 함께 시작된다.'

      // 이 모험을 내 기록 어디에 남길지 — 같은 세계를 각자의 자리에 저장한다
      const row = document.createElement('p')
      row.className = 'form-row'
      const label = document.createElement('label')
      label.htmlFor = 'coop-slot'
      label.textContent = '내 저장 자리'
      const select = document.createElement('select')
      select.id = 'coop-slot'
      const none = document.createElement('option')
      none.value = ''
      none.textContent = '저장하지 않는다'
      select.append(none)
      void this.hooks.describeSlots().then((descs) => {
        descs.forEach((d, i) => {
          const o = document.createElement('option')
          o.value = String(i)
          o.textContent = d
          select.append(o)
        })
      })
      select.addEventListener('change', () => {
        const v = select.value === '' ? null : Number(select.value)
        this.hooks.setGuestSlot(v)
        this.hooks.announce(
          v === null ? '이번 모험은 저장하지 않는다.' : `${v + 1}번 자리에 저장하며 간다.`,
        )
      })
      row.append(label, select)

      const leaveBtn = document.createElement('button')
      leaveBtn.type = 'button'
      leaveBtn.textContent = '모험단 나가기'
      leaveBtn.addEventListener('click', () => {
        session.leave()
        this.view = 'home'
        this.render()
      })
      this.body.append(wait, row, leaveBtn)
      leaveBtn.focus()
    }
  }
}
