import {
  changePassword,
  currentProfile,
  saveNickname,
  signOut,
  type Profile,
} from '../net/auth'
import { checkNickname, NICKNAME_MAX } from '../net/nickname'
import { AuthForm, errorLine, field } from './authForm'

/**
 * 계정 창 — 로그인·내 정보·비밀번호 변경, 그리고 (다음 단계에서) 탈퇴.
 *
 * 멀티 플레이 창을 거치지 않고도 계정을 만질 수 있는 문이다. 로그인 폼은
 * 멀티 플레이 창과 같은 한 벌(authForm)을 쓴다 — 성공 후 행선지만 다르다.
 * 이 파일 전체가 동적 import로만 불린다. 로그인한 적 없는 사람의 브라우저에는
 * 이 코드가 내려오지 않는다.
 */
export class AccountPanel {
  private dialog: HTMLDialogElement
  private body: HTMLElement
  private prevFocus: Element | null = null
  private closed = true
  private busy = false
  private profile: Profile | null = null
  private authForm: AuthForm | null = null

  constructor(
    private hooks: {
      onOpen?: () => void
      onClose?: () => void
      announce: (text: string) => void
      /** 로그인·로그아웃 — main이 저장소·타이틀 배지를 갈아 끼운다 */
      onProfileChanged: (profile: Profile | null) => void | Promise<void>
    },
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options coop'
    this.dialog.setAttribute('aria-labelledby', 'account-title')
    this.dialog.innerHTML = `
      <h2 id="account-title">계정</h2>
      <div class="coop-body"></div>
      <div class="slot-actions">
        <button type="button" id="account-close">닫기</button>
      </div>
    `
    document.body.append(this.dialog)
    this.body = this.dialog.querySelector('.coop-body')!
    this.dialog.querySelector('#account-close')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  async open(): Promise<void> {
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.dialog.showModal()
    const loading = document.createElement('p')
    loading.textContent = '확인하는 중…'
    this.body.replaceChildren(loading)
    try {
      this.profile = await currentProfile()
    } catch {
      this.profile = null
    }
    if (this.profile) this.renderInfo()
    else this.renderAuth()
  }

  close(): void {
    if (this.dialog.open) this.dialog.close()
    this.afterClose()
  }

  private afterClose(): void {
    if (this.closed) return
    this.closed = true
    this.authForm?.destroy()
    if (this.prevFocus instanceof HTMLElement && this.prevFocus.isConnected) {
      this.prevFocus.focus()
    }
    this.hooks.onClose?.()
  }

  // --- 화면들 ---

  private renderAuth(): void {
    this.authForm ??= new AuthForm({
      announce: this.hooks.announce,
      onSignedIn: async (profile) => {
        this.profile = profile
        await this.hooks.onProfileChanged(profile)
        this.hooks.announce(`${profile.nickname}로 로그인했다.`)
        this.renderInfo()
      },
    })
    this.authForm.render(this.body)
  }

  /** 내 정보 — 여기 보이는 것이 계정에 남아 있는 것의 전부다 */
  private renderInfo(): void {
    const me = this.profile!
    this.body.replaceChildren()

    const rows = document.createElement('dl')
    rows.className = 'account-rows'
    const row = (label: string, value: string) => {
      const dt = document.createElement('dt')
      dt.textContent = label
      const dd = document.createElement('dd')
      dd.textContent = value
      rows.append(dt, dd)
    }
    row('닉네임', me.nickname)
    row('친구 코드', me.friendCode)
    this.body.append(rows)

    const actions = document.createElement('div')
    actions.className = 'account-actions'
    const btn = (label: string, onClick: () => void, alt = false) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      if (alt) b.className = 'alt-action'
      b.addEventListener('click', onClick)
      actions.append(b)
      return b
    }
    btn('닉네임 바꾸기', () => this.renderNickname())
    btn('비밀번호 바꾸기', () => this.renderPassword())
    btn('로그아웃', () => {
      if (this.busy) return
      this.busy = true
      void signOut()
        .then(async () => {
          this.profile = null
          await this.hooks.onProfileChanged(null)
          this.hooks.announce('로그아웃했다.')
          this.renderAuth()
        })
        .finally(() => {
          this.busy = false
        })
    }, true)
    this.body.append(actions)

    const leave = document.createElement('div')
    leave.className = 'account-leave'
    const leaveBtn = document.createElement('button')
    leaveBtn.type = 'button'
    leaveBtn.className = 'alt-action account-danger'
    leaveBtn.textContent = '회원 탈퇴'
    leaveBtn.addEventListener('click', () => this.renderWithdraw())
    leave.append(leaveBtn)
    this.body.append(leave)

    actions.querySelector('button')?.focus()
  }

  private backLine(onBack: () => void): HTMLElement {
    const back = document.createElement('button')
    back.type = 'button'
    back.className = 'alt-action'
    back.textContent = '내 정보로 돌아가기'
    back.addEventListener('click', onBack)
    const wrap = document.createElement('div')
    wrap.className = 'account-back'
    wrap.append(back)
    return wrap
  }

  private renderNickname(): void {
    const me = this.profile!
    this.body.replaceChildren()
    const form = document.createElement('form')
    form.setAttribute('aria-label', '닉네임 바꾸기')
    const input = field(form, 'account-nick', `새 닉네임 (${NICKNAME_MAX}자까지)`, 'text', 'nickname')
    input.maxLength = NICKNAME_MAX
    input.value = me.nickname
    const setError = errorLine(form, this.hooks.announce)
    const submit = document.createElement('button')
    submit.type = 'submit'
    submit.textContent = '바꾸기'
    form.append(submit)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      if (this.busy) return
      const next = input.value.trim()
      const check = checkNickname(next)
      if (!check.ok) {
        setError(check.reason ?? '쓸 수 없는 닉네임이다.')
        input.focus()
        return
      }
      this.busy = true
      submit.disabled = true
      saveNickname(me.userId, next)
        .then(async () => {
          this.profile = { ...me, nickname: next }
          await this.hooks.onProfileChanged(this.profile)
          this.hooks.announce(`닉네임을 ${next}로 바꿨다.`)
          this.renderInfo()
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => {
          this.busy = false
          submit.disabled = false
        })
    })
    this.body.append(form, this.backLine(() => this.renderInfo()))
    input.focus()
  }

  private renderPassword(): void {
    this.body.replaceChildren()
    const form = document.createElement('form')
    form.setAttribute('aria-label', '비밀번호 바꾸기')
    const current = field(form, 'account-pw-now', '현재 비밀번호', 'password', 'current-password')
    const next = field(form, 'account-pw-new', '새 비밀번호 (8자 이상)', 'password', 'new-password')
    const again = field(form, 'account-pw-again', '새 비밀번호 다시', 'password', 'new-password')
    const setError = errorLine(form, this.hooks.announce)
    const submit = document.createElement('button')
    submit.type = 'submit'
    submit.textContent = '바꾸기'
    form.append(submit)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      if (this.busy) return
      if (next.value.length < 8) {
        setError('새 비밀번호는 8자 이상이어야 한다.')
        next.focus()
        return
      }
      if (next.value !== again.value) {
        setError('새 비밀번호가 서로 다르다.')
        again.focus()
        return
      }
      this.busy = true
      submit.disabled = true
      changePassword(current.value, next.value)
        .then(() => {
          this.hooks.announce('비밀번호를 바꿨다.')
          this.renderInfo()
        })
        .catch((err: Error) => setError(err.message))
        .finally(() => {
          this.busy = false
          submit.disabled = false
        })
    })
    this.body.append(form, this.backLine(() => this.renderInfo()))
    current.focus()
  }

  /** 탈퇴 — 다음 단계에서 서버가 준비되면 채워진다 */
  private renderWithdraw(): void {
    this.body.replaceChildren()
    const p = document.createElement('p')
    p.className = 'intro'
    p.textContent = '탈퇴 기능을 준비하고 있다. 지금은 개인정보처리방침의 문의처로 알려 주면 지워 드린다.'
    this.body.append(p, this.backLine(() => this.renderInfo()))
  }
}
