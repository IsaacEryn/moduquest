import {
  changePassword,
  currentProfile,
  deleteMyAccount,
  saveNickname,
  signOut,
  type Profile,
} from '../net/auth'
import { checkNickname, NICKNAME_MAX } from '../net/nickname'
import { AuthForm, errorLine, field } from './authForm'
import type { EventBus } from '../core/events'
import { toward } from '../core/korean'

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
      /** 사건 통로 — 로그인 성공 같은 것이 소리·자막으로 이어진다 */
      bus?: EventBus
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
      bus: this.hooks.bus,
      onSignedIn: async (profile) => {
        this.profile = profile
        await this.hooks.onProfileChanged(profile)
        this.hooks.announce(`${toward(profile.nickname)} 로그인했다.`)
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
    const setError = errorLine(form)
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
    const setError = errorLine(form)
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

  /**
   * 탈퇴 1단계 — 떠나는 이유를 묻는다.
   * 사유는 익명 통계로만 남고, 그걸로 게임을 고친다. 그래서 필수다.
   */
  private renderWithdraw(): void {
    this.body.replaceChildren()

    const intro = document.createElement('p')
    intro.className = 'intro'
    intro.textContent = '떠나기 전에 이유를 알려 달라. 익명 통계로만 남고, 그걸 보고 게임을 고친다.'
    this.body.append(intro)

    const form = document.createElement('form')
    form.setAttribute('aria-label', '탈퇴 사유')

    const REASONS: [string, string][] = [
      ['fun', '재미가 없어서'],
      ['difficulty', '난이도가 맞지 않아서'],
      ['accessibility', '접근성이 불편해서'],
      ['privacy', '개인정보가 걱정돼서'],
      ['other', '그 밖의 이유'],
    ]
    const fs = document.createElement('fieldset')
    const legend = document.createElement('legend')
    legend.textContent = '이유 (하나를 고른다)'
    fs.append(legend)
    for (const [value, label] of REASONS) {
      const wrap = document.createElement('div')
      wrap.className = 'party-choice'
      const input = document.createElement('input')
      input.type = 'radio'
      input.name = 'withdraw-reason'
      input.id = `withdraw-${value}`
      input.value = value
      const l = document.createElement('label')
      l.htmlFor = input.id
      l.textContent = label
      wrap.append(input, l)
      fs.append(wrap)
    }
    form.append(fs)

    const detailRow = document.createElement('p')
    detailRow.className = 'form-row'
    const detailLabel = document.createElement('label')
    detailLabel.htmlFor = 'withdraw-detail'
    detailLabel.textContent = '하고 싶은 말 (선택, 200자까지)'
    const detail = document.createElement('textarea')
    detail.id = 'withdraw-detail'
    detail.maxLength = 200
    detail.rows = 3
    detail.setAttribute('aria-describedby', 'withdraw-detail-note')
    const note = document.createElement('p')
    note.className = 'agree-note'
    note.id = 'withdraw-detail-note'
    note.textContent = '이 글은 익명으로만 저장된다. 이메일·이름 같은 개인정보는 적지 말아 달라.'
    detailRow.append(detailLabel, detail)
    form.append(detailRow, note)

    const setError = errorLine(form)

    const next = document.createElement('button')
    next.type = 'submit'
    next.textContent = '다음 — 확인으로'
    form.append(next)

    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const picked = form.querySelector<HTMLInputElement>('input[name="withdraw-reason"]:checked')
      if (!picked) {
        setError('이유를 하나 골라 달라.')
        form.querySelector<HTMLElement>('input[name="withdraw-reason"]')?.focus()
        return
      }
      this.renderWithdrawConfirm(picked.value, detail.value.trim())
    })

    this.body.append(form, this.backLine(() => this.renderInfo()))
    form.querySelector<HTMLElement>('input')?.focus()
  }

  /** 탈퇴 2단계 — 무엇이 지워지는지 눈으로 확인하고 나서야 지울 수 있다 */
  private renderWithdrawConfirm(reason: string, detail: string): void {
    this.body.replaceChildren()

    const warn = document.createElement('p')
    warn.className = 'intro'
    warn.textContent = '탈퇴하면 아래가 모두 지워지고, 되돌릴 수 없다.'

    const gone = document.createElement('ul')
    gone.className = 'withdraw-list'
    for (const item of [
      '계정과 이메일',
      '닉네임과 친구 코드',
      '클라우드 저장 자리 세 칸',
      '친구·선물·모험단 초대 기록',
    ]) {
      const li = document.createElement('li')
      li.textContent = item
      gone.append(li)
    }

    const stays = document.createElement('p')
    stays.className = 'agree-note'
    stays.textContent = '이 기기의 싱글 플레이 기록은 계정과 무관해서 남는다.'

    const status = document.createElement('p')
    status.className = 'form-error'
    status.setAttribute('role', 'alert')

    const actions = document.createElement('div')
    actions.className = 'coop-row'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = '그만두기'
    cancel.addEventListener('click', () => this.renderInfo())
    const confirm = document.createElement('button')
    confirm.type = 'button'
    confirm.className = 'alt-action account-danger'
    confirm.textContent = '정말 탈퇴하기'
    confirm.addEventListener('click', () => {
      if (this.busy) return
      this.busy = true
      confirm.disabled = true
      cancel.disabled = true
      deleteMyAccount(reason, detail || undefined)
        .then(async () => {
          // 세션 정리 — 토큰은 이미 무효일 수 있으니 실패는 무시한다
          await signOut().catch(() => {})
          for (const k of Object.keys(localStorage)) {
            if (k.startsWith('sb-') && k.endsWith('-auth-token')) localStorage.removeItem(k)
          }
          this.profile = null
          await this.hooks.onProfileChanged(null)
          this.hooks.announce(
            '탈퇴가 끝났다. 계정과 기록이 삭제됐다. 이 기기의 싱글 플레이 기록은 남아 있다.',
          )
          this.close()
        })
        .catch((err: Error) => {
          status.textContent = err.message
          this.hooks.announce(err.message)
          confirm.disabled = false
          cancel.disabled = false
        })
        .finally(() => {
          this.busy = false
        })
    })
    actions.append(cancel, confirm)

    this.body.append(warn, gone, stays, status, actions)
    // 기본 포커스는 취소에 — 마지막 한 걸음은 스스로 옮겨야 한다
    cancel.focus()
  }
}
