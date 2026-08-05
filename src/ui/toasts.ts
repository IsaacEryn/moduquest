import type { EventBus } from '../core/events'

const LIFE_MS = 3000
const MAX = 3

/**
 * 획득·레벨업 순간의 시각 알림. 컨테이너 전체가 aria-hidden이다 —
 * 이 사건들은 Announcer가 이미 낭독하므로, 여기서 또 읽히면 두 번이 된다.
 * 캔버스·자막과 같은 시각 전용 렌즈다.
 */
export class Toasts {
  private el: HTMLElement

  constructor(bus: EventBus) {
    this.el = document.createElement('div')
    this.el.className = 'toasts'
    this.el.setAttribute('aria-hidden', 'true')
    document.querySelector('#app')?.append(this.el)

    bus.on((e) => {
      switch (e.type) {
        case 'itemGained':
          for (const name of e.names) this.show(`${name} 획득`)
          break
        case 'chestOpened':
          this.show(`보물상자 — ${e.itemNames.join(', ')}`)
          break
        case 'goldGained':
          this.show(`동전 +${e.amount}냥`)
          break
        case 'levelUp':
          this.show(`파티 ${e.level}레벨!`)
          break
        case 'upgraded':
          this.show(`${e.memberName} ${e.statName} 강화 ${e.level}단계`)
          break
      }
    })
  }

  private show(text: string): void {
    const t = document.createElement('div')
    t.className = 'toast'
    t.textContent = text
    this.el.append(t)
    while (this.el.children.length > MAX) this.el.firstChild?.remove()
    setTimeout(() => t.remove(), LIFE_MS)
  }
}
