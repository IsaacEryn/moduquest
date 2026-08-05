import type { EventBus } from '../core/events'
import type { Game } from '../core/game'
import { gauge, updateGauge } from './gauge'

/**
 * 필드 상단 상시 현황 — 창을 열지 않아도 파티 체력과 지갑이 보인다.
 * 걷다가 전투에 들어갈지, 물약을 먼저 마실지를 화면만 보고 판단할 수 있어야 한다.
 *
 * 라이브 리전이 아니다 — 갱신을 스크린리더가 따라 읽으면 걸음마다 소음이 된다.
 * 낭독은 Announcer가 사건 단위로 이미 하고, 이 영역은 가상 커서로 찾아 읽는
 * 정적 요약이다. 그래서 aria-hidden도 아니다.
 */
export class FieldHud {
  readonly el: HTMLElement

  constructor(
    private game: Game,
    bus: EventBus,
  ) {
    this.el = document.createElement('div')
    this.el.className = 'hud'
    this.el.setAttribute('role', 'group')
    this.el.setAttribute('aria-label', '파티 현황')
    // 무슨 사건이든 필드에 붙어 있는 동안만 다시 그린다 — DOM이 작아 값이 싸다
    bus.on(() => {
      if (this.el.isConnected) this.refresh()
    })
  }

  refresh(): void {
    const g = this.game
    this.el.replaceChildren()

    const party = document.createElement('div')
    party.className = 'hud-party'
    for (const c of g.party) {
      const box = document.createElement('div')
      box.className = 'hud-member'
      const who = document.createElement('span')
      who.className = 'who'
      const name = document.createElement('b')
      name.textContent = c.isPlayer ? `${c.name}(나)` : c.name
      const num = document.createElement('span')
      num.textContent = c.hp <= 0 ? '쓰러짐' : `${c.hp}/${c.maxHp}`
      who.append(name, num)
      const bar = gauge(c.hp, c.maxHp, 'hp')
      updateGauge(bar, c.hp, c.maxHp)
      box.append(who, bar)
      party.append(box)
    }

    const chips = document.createElement('div')
    chips.className = 'hud-chips'
    const chip = (text: string) => {
      const s = document.createElement('span')
      s.className = 'hud-chip'
      s.textContent = text
      chips.append(s)
    }
    const areaCount = g.stage.areas.length
    const areaAt = g.stage.areas.findIndex((a) => a.id === g.field.areaId)
    const area = areaCount > 1 && areaAt >= 0 ? ` · 구역 ${areaAt + 1}/${areaCount}` : ''
    chip(`스테이지 ${g.currentStageIndex + 1}${area}`)
    chip(`Lv ${g.partyLevel}`)
    chip(`동전 ${g.currentGold}`)
    chip(`재료 ${g.currentMaterials}`)

    this.el.append(party, chips)
  }
}
