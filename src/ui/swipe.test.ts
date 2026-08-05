import { describe, expect, it } from 'vitest'
import { SWIPE_MIN, swipeDirection } from './swipe'

/**
 * 쓸기는 방향 버튼과 같은 일을 해야 한다. 어느 쪽으로 쓸었는지 고르는 규칙이
 * 흔들리면 손이 미끄러진 것과 가려던 것을 구별할 수 없다.
 */
describe('손가락 쓸기 방향', () => {
  it('많이 움직인 축이 이긴다', () => {
    expect(swipeDirection(80, 10)).toBe('east')
    expect(swipeDirection(-80, 10)).toBe('west')
    expect(swipeDirection(10, 80)).toBe('south')
    expect(swipeDirection(10, -80)).toBe('north')
  })

  it('짧게 스친 것은 이동이 아니다', () => {
    expect(swipeDirection(SWIPE_MIN - 1, SWIPE_MIN - 1)).toBeNull()
    expect(swipeDirection(0, 0)).toBeNull()
  })

  it('비스듬해도 한 방향만 고른다 — 대각선 이동은 없다', () => {
    expect(swipeDirection(60, 50)).toBe('east')
    expect(swipeDirection(50, 60)).toBe('south')
    // 정확히 같으면 가로가 이긴다. 어느 쪽이든 결정적이면 된다
    expect(swipeDirection(60, 60)).toBe('east')
  })

  it('한 축만 충분해도 그 방향으로 간다', () => {
    expect(swipeDirection(0, -SWIPE_MIN)).toBe('north')
    expect(swipeDirection(-SWIPE_MIN, 0)).toBe('west')
  })
})
