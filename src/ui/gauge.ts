/**
 * 체력·마력 게이지 바 — 시각 장식이다(aria-hidden). 수치는 언제나 곁의 글이 말하고,
 * 변화는 Announcer가 낭독한다. 여기에 progressbar 역할을 겹치면 같은 정보가
 * 두 번 읽히므로 굳이 의미를 얹지 않는다.
 *
 * 낮음(25% 이하)은 색 하나로 말하지 않는다 — data-low가 색과 테두리를 바꾸고,
 * 바 길이와 병기된 수치가 함께 말한다.
 */

const LOW_RATIO = 0.25

export function gauge(cur: number, max: number, kind: 'hp' | 'mp'): HTMLElement {
  const el = document.createElement('span')
  el.className = `gauge ${kind}`
  el.setAttribute('aria-hidden', 'true')
  const fill = document.createElement('span')
  fill.className = 'gauge-fill'
  el.append(fill)
  updateGauge(el, cur, max)
  return el
}

export function updateGauge(el: HTMLElement, cur: number, max: number): void {
  const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0
  const fill = el.querySelector<HTMLElement>('.gauge-fill')
  if (fill) fill.style.width = `${Math.round(ratio * 100)}%`
  // 마력은 낮아도 위험이 아니다 — 낮음 표시는 체력에만
  if (el.classList.contains('hp') && ratio <= LOW_RATIO && cur < max) {
    el.dataset.low = ''
  } else {
    delete el.dataset.low
  }
}
