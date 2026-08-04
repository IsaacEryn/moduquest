import type { EventBus } from '../core/events'
import type { Game } from '../core/game'
import type { Combatant } from '../core/types'

/** 전투 화면의 DOM 레이어: 상태판·행동 메뉴·시각 로그. 전부 시맨틱 마크업. */
export class BattleUI {
  private root: HTMLElement | null = null
  private allyList!: HTMLUListElement
  private enemyList!: HTMLUListElement
  private menu!: HTMLDivElement
  private logEl!: HTMLDivElement
  private myTurn = false

  constructor(
    private game: Game,
    bus: EventBus,
  ) {
    bus.on((e) => {
      if (!this.root) return
      switch (e.type) {
        case 'playerTurn':
          this.myTurn = true
          this.renderMenu()
          break
        case 'attacked':
        case 'healed':
        case 'downed':
        case 'victory':
          this.renderStatus()
          break
        case 'turnStart':
          if (!e.actor.isPlayer) {
            this.myTurn = false
            this.renderMenu()
          }
          break
      }
    })
  }

  mount(container: HTMLElement): void {
    const section = document.createElement('section')
    section.className = 'panel battle'
    section.setAttribute('aria-label', '전투')
    section.innerHTML = `
      <div class="parties">
        <section aria-label="아군"><h3>아군</h3><ul data-side="ally"></ul></section>
        <section aria-label="적"><h3>적</h3><ul data-side="enemy"></ul></section>
      </div>
      <div class="menu" role="group" aria-label="행동 선택"></div>
      <div class="log" aria-label="전투 기록"></div>
    `
    container.append(section)
    this.root = section
    this.allyList = section.querySelector('ul[data-side="ally"]')!
    this.enemyList = section.querySelector('ul[data-side="enemy"]')!
    this.menu = section.querySelector('.menu')!
    this.logEl = section.querySelector('.log')!
    this.myTurn = false
    this.renderStatus()
    this.renderMenu()
  }

  unmount(): void {
    this.root?.remove()
    this.root = null
  }

  addLog(text: string): void {
    if (!this.root) return
    const p = document.createElement('p')
    p.textContent = text
    this.logEl.append(p)
    this.logEl.scrollTop = this.logEl.scrollHeight
  }

  private renderStatus(): void {
    const battle = this.game.battle
    if (!battle) return
    const item = (c: Combatant) => {
      const li = document.createElement('li')
      if (c.hp <= 0) li.className = 'downed'
      li.textContent =
        c.hp > 0 ? `${c.name} — 체력 ${c.hp}/${c.maxHp}` : `${c.name} — 쓰러짐`
      return li
    }
    this.allyList.replaceChildren(...this.game.party.map(item))
    this.enemyList.replaceChildren(...battle.enemies.map(item))
  }

  private renderMenu(): void {
    const battle = this.game.battle
    if (!battle) return
    this.menu.replaceChildren()

    const player = this.game.player
    const mk = (label: string, onClick: () => void, disabled = false) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.disabled = disabled || !this.myTurn
      b.addEventListener('click', onClick)
      this.menu.append(b)
      return b
    }

    const attackBtn = mk('공격', () => this.pickTarget('attack'))
    const skill = player.skill!
    const onCooldown = player.cooldownLeft > 0
    mk(
      onCooldown ? `${skill.name} (${player.cooldownLeft}턴 남음)` : skill.name,
      () => this.pickTarget('skill'),
      onCooldown,
    )
    mk('방어', () => {
      this.myTurn = false
      this.game.playerAction({ kind: 'defend' })
      this.renderMenu()
    })

    if (this.myTurn) attackBtn.focus()
  }

  /** 대상 선택: 생존한 적 목록으로 메뉴를 교체, ESC로 복귀 */
  private pickTarget(kind: 'attack' | 'skill'): void {
    const battle = this.game.battle
    if (!battle) return
    this.menu.replaceChildren()

    const back = () => this.renderMenu()
    const targets = battle.enemies.filter((e) => e.hp > 0)
    targets.forEach((t, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = `${t.name} (체력 ${t.hp})`
      b.addEventListener('click', () => {
        this.myTurn = false
        this.game.playerAction({ kind, targetId: t.id })
        this.renderMenu()
      })
      b.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
          ev.stopPropagation()
          back()
        }
      })
      this.menu.append(b)
      if (i === 0) b.focus()
    })

    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = '뒤로'
    cancel.addEventListener('click', back)
    this.menu.append(cancel)
  }
}
