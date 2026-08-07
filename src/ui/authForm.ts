import {
  checkNickname,
  resendConfirmation,
  saveNickname,
  signIn,
  signUp,
  NICKNAME_MAX,
  type Profile,
} from '../net/auth'
import { captchaEnabled, mountCaptcha, type CaptchaWidget } from '../net/captcha'
import type { EventBus } from '../core/events'

/**
 * 로그인·가입 폼 — 한 벌을 두 문이 나눠 쓴다.
 *
 * 원래 멀티 플레이 창 안에 있던 것을 그대로 들어냈다. 로그인이 멀티 플레이
 * 버튼 뒤에만 있으면 계정만 만지고 싶은 사람도 모험단 화면을 지나야 한다 —
 * 같은 폼을 계정 창에서도 열 수 있어야 해서, 성공 후 어디로 갈지만 문이 정한다.
 *
 * 확인 메일 대기 화면과 자동 가입 방지 상자의 수명까지 여기서 관리한다.
 */
export class AuthForm {
  private captcha: CaptchaWidget | null = null
  private busy = false
  private pendingEmail = ''

  constructor(
    private hooks: {
      announce: (text: string) => void
      /** 로그인·가입이 끝났다 — 어디로 갈지는 문(호출자)이 정한다 */
      onSignedIn: (profile: Profile) => void | Promise<void>
      /** 소리와 자막이 붙을 자리 — 문이 둘이라 사건은 한 곳으로 모은다 */
      bus?: EventBus
    },
  ) {}

  /** 폼을 그린다. signup=true면 가입 꼴로 시작한다 */
  render(container: HTMLElement, signup = false): void {
    container.replaceChildren()
    const intro = document.createElement('p')
    intro.className = 'intro'
    intro.textContent = signup
      ? '처음이면 계정을 만들자. 닉네임은 동료들에게 보이는 이름이다.'
      : '로그인하면 기록이 계정에 남아 다른 기기에서도 이어서 할 수 있다. ' +
        '싱글 플레이는 로그인 없이 그대로다.'
    container.append(intro)

    const form = document.createElement('form')
    form.setAttribute('aria-label', signup ? '가입' : '로그인')
    const email = field(form, 'auth-email', '이메일', 'email', 'email')
    const pw = field(
      form,
      'auth-pw',
      '비밀번호 (8자 이상)',
      'password',
      signup ? 'new-password' : 'current-password',
    )
    let nick: HTMLInputElement | null = null
    if (signup) {
      nick = field(form, 'auth-nick', `닉네임 (${NICKNAME_MAX}자까지)`, 'text', 'nickname')
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

    const setError = errorLine(form, this.hooks.announce)

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
    toggle.addEventListener('click', () => this.render(container, !signup))

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
        this.busy = false
        submit.disabled = false
        return
      }
      const finish = async (profile: Profile) => {
        // 회선이 잡히는 소리 — 자막은 announcer가 같은 사건에서 붙인다
        this.hooks.bus?.emit({ type: 'signedIn' })
        await this.hooks.onSignedIn(profile)
      }
      const task = signup
        ? signUp(address, pw.value, nickname, ticket).then(async (result) => {
            if (result.kind === 'confirm') {
              this.pendingEmail = result.email
              this.renderConfirm(container)
              this.hooks.announce('확인 메일을 보냈다. 메일함의 링크를 누르면 계정이 열린다.')
              return
            }
            // 가입 즉시 열린 계정 — 편의 설정이 있다는 것을 첫 인사에 함께 알린다
            this.hooks.announce('화면·소리·조작은 옵션에서 몸에 맞게 바꿀 수 있다.')
            await finish(result.profile)
          })
        : signIn(address, pw.value, ticket).then(async (profile) => {
            // 트리거가 없던 시절의 계정이면 이름이 비어 있다 — 여기서 채운다
            if (!profile.nickname) {
              const fallback = '모험가'
              await saveNickname(profile.userId, fallback)
              profile = { ...profile, nickname: fallback }
            }
            await finish(profile)
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

    container.append(form)
    email.focus()
  }

  /** 확인 메일 대기 — 가입 직후에는 아직 로그인이 아니다 */
  private renderConfirm(container: HTMLElement): void {
    container.replaceChildren()
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
    toLogin.addEventListener('click', () => this.render(container, false))

    const row = document.createElement('div')
    row.className = 'coop-row'
    resend.className = 'alt-action'
    row.append(toLogin, resend)

    container.append(intro, note, status, row)
    toLogin.focus()
  }

  /** 창이 닫힐 때 — 자동 가입 방지 상자를 정리한다 */
  destroy(): void {
    this.captcha?.destroy()
    this.captcha = null
  }
}

// --- 폼 조각 — 계정 관련 화면들이 같이 쓴다 ---

export function field(
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

export function errorLine(
  form: HTMLElement,
  announce: (text: string) => void,
): (msg: string) => void {
  const p = document.createElement('p')
  p.className = 'form-error'
  p.setAttribute('role', 'alert')
  form.append(p)
  return (msg: string) => {
    p.textContent = msg
    if (msg) announce(msg)
  }
}
