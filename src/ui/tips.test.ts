import { describe, expect, it } from 'vitest'
import { TipKeeper } from './tips'

/**
 * 팁의 절제 규칙 — 여기가 무너지면 안내가 잔소리가 된다.
 */
describe('팁 규칙', () => {
  it('같은 팁은 평생 한 번이다', () => {
    const k = new TipKeeper(new Set())
    expect(k.take('a')).toBe(true)
    const k2 = new TipKeeper(new Set(k.seenIds))
    expect(k2.take('a')).toBe(false)
  })

  it('한 세션에는 하나만 — 연달아 말 걸지 않는다', () => {
    const k = new TipKeeper(new Set())
    expect(k.take('a')).toBe(true)
    expect(k.take('b')).toBe(false)
  })

  it('이미 본 팁은 세션 몫을 쓰지 않는다 — 다음 팁의 기회가 남는다', () => {
    const k = new TipKeeper(new Set(['a']))
    expect(k.take('a')).toBe(false)
    expect(k.take('b')).toBe(true)
  })
})
