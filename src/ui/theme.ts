import type { EventBus } from '../core/events'
import type { OptionsStore, Theme } from './optionsStore'

/**
 * 테마의 해석과 적용.
 *
 * 저장되는 값은 넷('system' 포함)이지만 화면에 실제로 걸리는 값은 셋뿐이다 —
 * system은 여기서 기기 설정을 읽어 셋 중 하나로 해석된다. CSS에는 prefers-*
 * 분기를 두지 않는다: 해석의 출처가 둘이면 언젠가 서로 다른 답을 낸다.
 */

export type ResolvedTheme = 'dark' | 'light' | 'contrast'

/** 기기 설정 읽기 — 시험에서 갈아 끼울 수 있게 주입 가능 */
export type MediaMatches = (query: string) => boolean

const defaultMatches: MediaMatches = (q) =>
  typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(q).matches

export function resolveTheme(setting: Theme, matches: MediaMatches = defaultMatches): ResolvedTheme {
  if (setting !== 'system') return setting
  // 고대비가 밝기보다 앞선다 — 고대비를 켠 사람의 목적은 색이 아니라 시인성이다
  if (matches('(prefers-contrast: more)')) return 'contrast'
  if (matches('(prefers-color-scheme: light)')) return 'light'
  return 'dark'
}

export function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved
}

/**
 * 시작 시 한 번 적용하고, 옵션이 바뀔 때마다 다시 적용한다.
 * 옵션 패널이 아니라 부팅 지점에서 부르는 이유: 테마는 패널을 연 적 없는
 * 사람에게도, 기기 설정이 바뀌는 순간에도 걸려야 한다.
 */
/**
 * 캔버스 그리기 모드. 고대비가 저자극보다 앞선다 — 고대비 색을 다시 바래게
 * 하면 이 모드의 목적이 무너진다. 저자극의 나머지 몫(움직임 억제)은 각자의
 * 자리에서 계속 산다.
 */
export type SpriteMode = 'normal' | 'low' | 'hc'

export function spriteModeFor(
  opts: { theme: Theme; lowStim: boolean },
  matches: MediaMatches = defaultMatches,
): SpriteMode {
  if (resolveTheme(opts.theme, matches) === 'contrast') return 'hc'
  return opts.lowStim ? 'low' : 'normal'
}

export function initTheme(store: OptionsStore, bus: EventBus): void {
  applyTheme(resolveTheme(store.options.theme))
  bus.on((e) => {
    if (e.type === 'optionsChanged') applyTheme(resolveTheme(store.options.theme))
  })
}
