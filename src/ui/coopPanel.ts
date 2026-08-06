import {
  checkNickname,
  currentProfile,
  resendConfirmation,
  saveNickname,
  signIn,
  signOut,
  signUp,
  NICKNAME_MAX,
  type Profile,
} from '../net/auth'
import { captchaEnabled, mountCaptcha, type CaptchaWidget } from '../net/captcha'
import type { PartySession } from '../net/session'
import { hasSupabaseConfig } from '../net/supabaseClient'

type View = 'auth' | 'confirm' | 'home' | 'room'

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
  /** 지금 화면에 떠 있는 자동 가입 방지 상자 */
  private captcha: CaptchaWidget | null = null
  /**
   * 게스트가 고른 저장 자리. 로비를 다시 그려도 고른 값이 남아야 하고,
   * 고르지 않았으면 반드시 null이어야 한다 — 이 값이 곧 자동저장의 목적지다
   */
  private guestSlot: number | null = null

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
      <div class="slot-actions">
        <button type="button" id="coop-close">닫기</button>
      </div>
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
    this.captcha?.destroy()
    this.captcha = null
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
    else if (this.view === 'confirm') this.renderConfirm()
    else if (this.view === 'home') this.renderHome()
    else this.renderRoom()
  }

  /** 가입 직후 — 아직 로그인이 아니다. 메일함으로 가야 한다 */
  private pendingEmail = ''

  private renderConfirm(): void {
    const intro = document.createElement('p')
    intro.className = 'intro'
    intro.textContent = `${this.pendingEmail}로 확인 메일을 보냈다. 메일함의 링크를 누르면 계정이 열린다.`

    const note = document.createElement('p')
    note.className = 'intro'
    note.textContent =
      '메일이 보이지 않으면 스팸함도 확인해 보자. 이미 가입된 이메일이면 메일이 오지 않는다 — 그때는 로그인하면 된다.'

    const status = document.createElement('p')
    status.className = 'form-error'
    status.setAttribute('role', 'alert')

    const resend = document.createElement('button')
    resend.type = 'button'
    resend.textContent = '확인 메일 다시 보내기'
    resend.addEventListener('click', () => {
      if (this.busy) return
      this.busy = true
      resend.disabled = true
      status.textContent = ''
      resendConfirmation(this.pendingEmail, this.captcha?.token() ?? undefined)
        .then(() => {
          status.textContent = '확인 메일을 다시 보냈다.'
          this.hooks.announce(status.textContent)
        })
        .catch((err: Error) => {
          status.textContent = err.message
          this.hooks.announce(err.message)
        })
        .finally(() => {
          this.busy = false
          resend.disabled = false
        })
    })

    const toLogin = document.createElement('button')
    toLogin.type = 'button'
    toLogin.textContent = '확인했다 — 로그인하기'
    toLogin.addEventListener('click', () => {
      this.view = 'auth'
      this.render()
    })

    const row = document.createElement('div')
    row.className = 'coop-row'
    resend.className = 'alt-action'
    row.append(toLogin, resend)

    this.body.append(intro, note, status, row)
    toLogin.focus()
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
      nick = this.field(form, 'coop-nick', `닉네임 (${NICKNAME_MAX}자까지)`, 'text', 'nickname')
      nick.maxLength = NICKNAME_MAX
    }
    // 자동 가입 방지. 열쇠가 없으면 상자 자체가 안 생기고 가입은 그대로 된다
    const captchaBox = document.createElement('div')
    captchaBox.className = 'captcha-box'
    form.append(captchaBox)
    this.captcha?.destroy()
    this.captcha = null
    if (captchaEnabled()) {
      void mountCaptcha(captchaBox).then((w) => {
        this.captcha = w
      })
    }

    const setError = this.errorLine(form)

    // 지금 하려는 일과 반대편으로 가는 길을 나란히 둔다.
    // 글자 수가 크게 다르면 두 버튼의 폭이 벌어져 줄이 흐트러지므로 짧게 맞추고,
    // 무슨 뜻인지는 읽어 주는 이름(aria-label)이 채운다
    const actions = document.createElement('div')
    actions.className = 'auth-actions'

    const submit = document.createElement('button')
    submit.type = 'submit'
    submit.textContent = signup ? '가입하기' : '로그인'

    const toggle = document.createElement('button')
    toggle.type = 'button'
    toggle.className = 'alt-action'
    toggle.textContent = signup ? '로그인' : '가입하기'
    // 보이는 글자가 이름 안에 그대로 들어 있어야 음성 조작으로도 부를 수 있다
    toggle.setAttribute(
      'aria-label',
      signup ? '이미 계정이 있다면 로그인으로' : '계정이 없다면 가입하기로',
    )
    toggle.addEventListener('click', () => this.renderAuth(!signup))

    actions.append(submit, toggle)
    form.append(actions)

    if (signup) {
      // 무엇에 동의하는지는 누르기 전에 읽을 수 있어야 한다
      const agree = document.createElement('p')
      agree.className = 'agree-note'
      const terms = document.createElement('a')
      terms.href = 'terms.html'
      terms.target = '_blank'
      terms.rel = 'noopener'
      terms.textContent = '이용약관'
      const privacy = document.createElement('a')
      privacy.href = 'privacy.html'
      privacy.target = '_blank'
      privacy.rel = 'noopener'
      privacy.textContent = '개인정보처리방침'
      agree.append('가입하면 ', terms, '과 ', privacy, '에 동의하는 것으로 봅니다. 새 창에서 열립니다.')
      form.append(agree)
    }

    const finish = (profile: Profile) => {
      this.profile = profile
      this.hooks.announce(`${profile.nickname}로 로그인했다.`)
      this.view = 'home'
      this.render()
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      if (this.busy) return
      const nickname = nick?.value.trim() ?? ''
      if (signup) {
        const check = checkNickname(nickname)
        if (!check.ok) {
          setError(check.reason ?? '쓸 수 없는 닉네임이다.')
          nick?.focus()
          return
        }
      }
      this.busy = true
      submit.disabled = true
      setError('')

      const address = email.value.trim()
      const ticket = this.captcha?.token() ?? undefined
      // 표가 없으면 서버가 어차피 거절한다. 요청을 보내 실패를 받아 오는 대신
      // 여기서 멈추고 이유를 말한다 — 비밀번호를 의심하게 두지 않는다
      if (captchaEnabled() && !ticket) {
        setError('자동 가입 방지 확인이 아직 끝나지 않았다. 위의 확인을 마치고 다시 눌러 주세요.')
        return
      }
      const task = signup
        ? signUp(address, pw.value, nickname, ticket).then(async (result) => {
            if (result.kind === 'confirm') {
              this.pendingEmail = result.email
              this.view = 'confirm'
              this.render()
              this.hooks.announce('확인 메일을 보냈다. 메일함의 링크를 누르면 계정이 열린다.')
              return
            }
            finish(result.profile)
          })
        : signIn(address, pw.value, ticket).then(async (profile) => {
            // 트리거가 없던 시절의 계정이면 이름이 비어 있다 — 여기서 채운다
            if (!profile.nickname) {
              const fallback = '모험가'
              await saveNickname(profile.userId, fallback)
              profile = { ...profile, nickname: fallback }
            }
            finish(profile)
          })

      task
        .catch((err: Error) => setError(err.message))
        .finally(() => {
          this.busy = false
          submit.disabled = false
          // 표는 한 번 쓰면 버려진다 — 다시 누를 때를 위해 새로 받아 둔다
          this.captcha?.reset()
        })
    })

    this.body.append(form)
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
          // 새 모험단이다 — 지난 판의 저장 자리를 물려받지 않는다
          this.guestSlot = null
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
    out.className = 'alt-action'
    out.textContent = '로그아웃'
    out.addEventListener('click', () => {
      void signOut().then(() => {
        this.profile = null
        this.view = 'auth'
        this.render()
        this.hooks.announce('로그아웃했다.')
      })
    })

    // 만들기와 참가하기는 서로 다른 길이라 사이에 선을 긋는다.
    // 선물함·로그아웃은 모험과 무관한 일이라 맨 아래 한 줄로 묶는다
    const divider = document.createElement('p')
    divider.className = 'coop-divider'
    divider.textContent = '또는'

    const footer = document.createElement('div')
    footer.className = 'coop-row'
    footer.append(gifts, out)

    this.body.append(makeBtn, divider, joinForm, footer)
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

    // 코드 줄과 복사 버튼은 한 몸이라 붙여 둔다
    const codeRow = document.createElement('div')
    codeRow.className = 'coop-code-row'
    codeRow.append(codeLine, copy)
    this.body.append(codeRow, roster)

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
      const startRow = document.createElement('div')
      startRow.className = 'coop-row'
      startCont.className = 'alt-action'
      startRow.append(startNew, startCont)
      this.body.append(startRow, note)
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
      // 화면에 보이는 것이 곧 실제 설정이게 한다. 예전에는 change에서만 전달해서,
      // 손대지 않으면 직전 솔로 플레이의 자리가 그대로 남아 "저장하지 않는다"고
      // 적혀 있는 채로 그 자리를 덮어썼다. 로스터가 바뀌어 이 화면을 다시 그려도
      // 고른 값은 패널이 기억한다
      this.hooks.setGuestSlot(this.guestSlot)
      void this.hooks.describeSlots().then((descs) => {
        descs.forEach((d, i) => {
          const o = document.createElement('option')
          o.value = String(i)
          o.textContent = d
          select.append(o)
        })
        // 자리 목록이 채워진 뒤에야 고른 값을 되살릴 수 있다
        select.value = this.guestSlot === null ? '' : String(this.guestSlot)
      })
      select.addEventListener('change', () => {
        const v = select.value === '' ? null : Number(select.value)
        this.guestSlot = v
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
      const leaveRow = document.createElement('div')
      leaveRow.className = 'coop-row'
      leaveBtn.className = 'alt-action'
      leaveRow.append(leaveBtn)
      this.body.append(wait, row, leaveRow)
      leaveBtn.focus()
    }
  }
}
