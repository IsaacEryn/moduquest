import type { EventBus } from '../core/events'

export interface Options {
  captions: boolean
  lowStim: boolean
  volume: number
  /** 배경음악 — 낭독을 덮지 않도록 늘 낮게 깔리지만, 끄고 싶은 사람도 있다 */
  music: boolean
  textLarge: boolean
  textLog: boolean
  /** 지나온 길 표시 — 어디를 이미 지났는지 헷갈리는 부담을 덜어 준다 */
  trail: boolean
  /**
   * W·A·S·D·R 같은 글자 하나짜리 단축키. 화살표 키와 화면 버튼은 이 설정과 무관하게
   * 언제나 동작하므로, 꺼도 잃는 조작은 없다. 끄는 길을 둔 것은 음성 입력 사용자가
   * 말하는 도중에 게임이 움직이지 않게 하기 위해서다(WCAG 2.1.4 문자 단축키).
   */
  letterKeys: boolean
}

const KEY = 'moduquest-options'

const DEFAULTS: Options = {
  captions: true,
  lowStim: false,
  volume: 0.8,
  music: true,
  textLarge: false,
  textLog: true,
  trail: true,
  letterKeys: true,
}

/** 저장값은 신뢰하지 않는다 — 키별로 타입·범위를 확인하고 나머지는 기본값 */
function sanitize(raw: unknown): Options {
  const o = { ...DEFAULTS }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (typeof r.captions === 'boolean') o.captions = r.captions
    if (typeof r.lowStim === 'boolean') o.lowStim = r.lowStim
    if (typeof r.music === 'boolean') o.music = r.music
    if (typeof r.textLarge === 'boolean') o.textLarge = r.textLarge
    if (typeof r.textLog === 'boolean') o.textLog = r.textLog
    if (typeof r.trail === 'boolean') o.trail = r.trail
    if (typeof r.letterKeys === 'boolean') o.letterKeys = r.letterKeys
    if (typeof r.volume === 'number' && r.volume >= 0 && r.volume <= 1) {
      o.volume = r.volume
    }
  }
  return o
}

/**
 * 접근성·소리 옵션의 소유자. localStorage 접근은 여기에만 있다 —
 * 게임 코어는 옵션의 존재를 모른다.
 */
export class OptionsStore {
  readonly options: Options

  constructor(private bus: EventBus) {
    this.options = this.load()
    this.followSystemMotion()
  }

  /**
   * OS의 "동작 줄이기"를 켜고 끄는 순간을 따라간다. 처음 한 번만 읽으면, 화면이
   * 흔들려서 설정을 바꾸러 나갔다 돌아온 사람에게 아무 일도 일어나지 않는다.
   * 사용자가 이 게임 안에서 저자극 모드를 직접 만진 뒤에는 따라가지 않는다 —
   * 그 선택이 OS 설정보다 앞선다.
   */
  private followSystemMotion(): void {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    query.addEventListener?.('change', (e) => {
      if (this.userSetLowStim) return
      this.options.lowStim = e.matches
      this.bus.emit({ type: 'optionsChanged' })
    })
  }

  /** 저자극 모드를 사람이 직접 만졌는가 — OS 추종을 멈추는 기준 */
  private userSetLowStim = false

  private load(): Options {
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) return sanitize(JSON.parse(raw))
    } catch {
      // 깨진 저장값은 기본값으로
    }
    // 저장된 설정이 없으면 OS의 동작 줄이기 설정을 저자극 초기값으로 존중한다
    return {
      ...DEFAULTS,
      lowStim: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    }
  }

  set<K extends keyof Options>(key: K, value: Options[K]): void {
    // 사람이 직접 고른 저자극 설정은 OS 설정 변화보다 앞선다
    if (key === 'lowStim') this.userSetLowStim = true
    this.options[key] = value
    localStorage.setItem(KEY, JSON.stringify(this.options))
    this.bus.emit({ type: 'optionsChanged' })
  }
}
