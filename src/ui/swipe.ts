import type { Dir } from '../core/types'

/** 쓸기로 치려면 이만큼은 움직여야 한다. 짧게 스치는 것은 손이 미끄러진 것으로 본다 */
export const SWIPE_MIN = 36
/** 이보다 오래 끌면 쓸기가 아니라 그냥 손을 댄 것이다 */
export const SWIPE_MAX_MS = 1000

/**
 * 움직인 거리에서 방향 하나를 고른다. 더 많이 움직인 축이 이기고,
 * 둘 다 모자라면 아무 방향도 아니다 — 애매한 손짓을 이동으로 삼지 않는다.
 */
export function swipeDirection(dx: number, dy: number, min = SWIPE_MIN): Dir | null {
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (ax < min && ay < min) return null
  if (ax >= ay) return dx > 0 ? 'east' : 'west'
  return dy > 0 ? 'south' : 'north'
}

/**
 * 손가락으로 쓸어 움직이기. 화면 방향 버튼은 그대로 두고 길 하나를 더 놓는 것이라,
 * 어느 쪽도 못 쓰게 되는 사람이 없다.
 *
 * 손가락 하나만 받는다 — 두 손가락이 닿으면 확대하려는 것이고, 확대는 저시력
 * 사용자에게 기능이다. 그래서 CSS도 pinch-zoom은 열어 둔 채로 쓴다.
 * 스크린리더가 켜져 있으면 쓸기를 스크린리더가 먼저 가져가므로 여기까지 오지 않는다.
 */
export function attachSwipe(
  el: HTMLElement,
  opts: { canMove: () => boolean; onSwipe: (dir: Dir) => void },
): void {
  let start: { x: number; y: number; at: number } | null = null

  el.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) {
        start = null
        return
      }
      const t = e.touches[0]
      start = { x: t.clientX, y: t.clientY, at: e.timeStamp }
    },
    { passive: true },
  )

  el.addEventListener(
    'touchmove',
    (e) => {
      // 손가락이 하나 더 닿으면 이번 손짓은 이동이 아니다
      if (e.touches.length > 1) start = null
    },
    { passive: true },
  )

  el.addEventListener('touchcancel', () => {
    start = null
  })

  el.addEventListener('touchend', (e) => {
    const from = start
    start = null
    if (!from || e.changedTouches.length !== 1) return
    if (e.timeStamp - from.at > SWIPE_MAX_MS) return
    if (!opts.canMove()) return
    const t = e.changedTouches[0]
    const dir = swipeDirection(t.clientX - from.x, t.clientY - from.y)
    if (dir) opts.onSwipe(dir)
  })
}
