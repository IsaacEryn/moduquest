/**
 * 자동 가입 방지 (Cloudflare Turnstile).
 *
 * 글자를 알아맞히거나 신호등을 고르는 캡차는 쓰지 않는다. 그런 것은 저시력·
 * 인지장애 이용자에게 사실상 잠긴 문이고, 이 게임이 하려는 일과 정반대다.
 * Turnstile은 대부분 아무것도 묻지 않고 지나가며, 물어야 할 때에도 체크 상자
 * 하나라 키보드로 넘길 수 있다.
 *
 * 열쇠(site key)가 없으면 캡차는 통째로 꺼진 채 동작한다. 그래야 서버 쪽 설정을
 * 켜기 전에도 가입이 막히지 않는다.
 */

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string
  reset(id: string): void
  remove(id: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export function captchaEnabled(): boolean {
  return Boolean(SITE_KEY)
}

let loading: Promise<TurnstileApi> | null = null

/** 스크립트는 이 함수를 처음 부를 때에만 받아 온다 — 혼자 하기는 여기 오지 않는다 */
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (loading) return loading
  loading = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.defer = true
    script.addEventListener('load', () => {
      if (window.turnstile) resolve(window.turnstile)
      else reject(new Error('자동 가입 방지를 불러오지 못했다.'))
    })
    script.addEventListener('error', () => reject(new Error('자동 가입 방지를 불러오지 못했다.')))
    document.head.append(script)
  })
  return loading
}

export interface CaptchaWidget {
  /** 지금 쓸 수 있는 표. 아직 준비되지 않았으면 null */
  token(): string | null
  /** 표는 한 번 쓰면 버려야 한다 — 제출 뒤에는 반드시 부른다 */
  reset(): void
  /** 화면에서 뗄 때 */
  destroy(): void
}

/**
 * 상자를 그리고 손잡이를 돌려준다.
 * 열쇠가 없거나 스크립트를 못 받아 오면 null — 부르는 쪽은 캡차 없이 진행한다.
 */
export async function mountCaptcha(container: HTMLElement): Promise<CaptchaWidget | null> {
  if (!SITE_KEY) return null
  let api: TurnstileApi
  try {
    api = await loadTurnstile()
  } catch {
    // 네트워크가 막혀 캡차를 못 받아 왔다고 가입까지 막지는 않는다.
    // 진짜 방어선은 서버 쪽 검증이고, 여기서 막으면 정상 이용자만 갇힌다
    return null
  }

  let current: string | null = null
  const id = api.render(container, {
    sitekey: SITE_KEY,
    theme: 'dark',
    language: 'ko',
    callback: (token: string) => {
      current = token
    },
    'expired-callback': () => {
      current = null
    },
    'error-callback': () => {
      current = null
    },
  })

  return {
    token: () => current,
    reset: () => {
      current = null
      api.reset(id)
    },
    destroy: () => {
      current = null
      api.remove(id)
    },
  }
}
