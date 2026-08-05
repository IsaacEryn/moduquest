import type { EventBus } from '../core/events'

export interface Options {
  captions: boolean
  lowStim: boolean
  volume: number
  textLarge: boolean
  textLog: boolean
  /** 지나온 길 표시 — 어디를 이미 지났는지 헷갈리는 부담을 덜어 준다 */
  trail: boolean
}

const KEY = 'moduquest-options'

const DEFAULTS: Options = {
  captions: true,
  lowStim: false,
  volume: 0.8,
  textLarge: false,
  textLog: true,
  trail: true,
}

/** 저장값은 신뢰하지 않는다 — 키별로 타입·범위를 확인하고 나머지는 기본값 */
function sanitize(raw: unknown): Options {
  const o = { ...DEFAULTS }
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (typeof r.captions === 'boolean') o.captions = r.captions
    if (typeof r.lowStim === 'boolean') o.lowStim = r.lowStim
    if (typeof r.textLarge === 'boolean') o.textLarge = r.textLarge
    if (typeof r.textLog === 'boolean') o.textLog = r.textLog
    if (typeof r.trail === 'boolean') o.trail = r.trail
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
  }

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
    this.options[key] = value
    localStorage.setItem(KEY, JSON.stringify(this.options))
    this.bus.emit({ type: 'optionsChanged' })
  }
}
