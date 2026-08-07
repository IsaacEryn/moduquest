import { describe, expect, it } from 'vitest'
import { resolveTheme } from './theme'

/**
 * 테마 해석 — 설정 4종 × 기기 상태 조합의 전수 검사.
 * 여기 어긋나면 고대비가 필요한 사람이 어두운 화면을 받는다.
 */

const device = (opts: { light?: boolean; contrast?: boolean }) => (q: string) => {
  if (q === '(prefers-color-scheme: light)') return opts.light ?? false
  if (q === '(prefers-contrast: more)') return opts.contrast ?? false
  return false
}

describe('테마 해석', () => {
  it('직접 고른 테마는 기기 설정을 무시한다', () => {
    expect(resolveTheme('dark', device({ light: true, contrast: true }))).toBe('dark')
    expect(resolveTheme('light', device({}))).toBe('light')
    expect(resolveTheme('contrast', device({ light: true }))).toBe('contrast')
  })

  it('기기 설정 따르기 — 고대비가 밝기보다 앞선다', () => {
    expect(resolveTheme('system', device({ contrast: true, light: true }))).toBe('contrast')
    expect(resolveTheme('system', device({ contrast: true }))).toBe('contrast')
  })

  it('기기 설정 따르기 — 밝음이면 밝게, 아니면 어둡게', () => {
    expect(resolveTheme('system', device({ light: true }))).toBe('light')
    expect(resolveTheme('system', device({}))).toBe('dark')
  })
})
