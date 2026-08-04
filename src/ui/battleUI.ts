import type { EventBus } from '../core/events'
import type { Game } from '../core/game'
import type { Combatant } from '../core/types'

/**
 * 전투 화면의 DOM 레이어: 상태판·행동 메뉴·시각 로그. 전부 시맨틱 마크업.
 * 포커스 원칙: 적 턴에는 버튼을 재생성하지 않고 비활성만 토글해 포커스를
 * 지키고, 내 차례로 바뀌는 순간에만 공격 버튼으로 이동시킨다.
 */
export class BattleUI {
  private root: HTMLElement | null = null
  private allyList!: HTMLUListElement
  private enemyList!: HTMLUListElement
  private menu!: HTMLDivElement
  private myTurn = false

  constructor(
    private game: Game,
    bus: EventBus,
    private openOptions: () => void,
  ) {
    bus.on((e) => {
      if (!this.root) return
      switch (e.type) {
        case 'playerTurn': {
          const wasMyTurn = this.myTurn
          this.myTurn = true
          this.renderMenu(!wasMyTurn)
          break
        }
        case 'attacked':
        case 'healed':
        case 'downed':
        case 'victory':
          this.renderStatus()
          break
        case 'turnStart':
          if (!e.actor.isPlayer) {
            this.myTurn = false
            this.setMenuDisabled(true)
          }
          break
      }
    })
  }

  mount(container: HTMLElement): void {
    const section = document.createElement('section')
    section.className = 'panel battle'
    section.tabIndex = -1
    section.setAttribute('aria-label', '전투')
    section.innerHTML = `
      <h2 class="visually-hidden">전투</h2>
      <div class="parties">
        <section aria-label="아군"><h3>아군</h3><ul data-side="ally"></ul></section>
        <section aria-label="적"><h3>적</h3><ul data-side="enemy"></ul></section>
      </div>
      <div class="menu" role="group" aria-label="행동 선택"></div>
      <div class="secondary"></div>
    `
    const optBtn = document.createElement('button')
    optBtn.type = 'button'
    optBtn.textContent = '옵션'
    optBtn.addEventListener('click', () => this.openOptions())
    section.querySelector('.secondary')!.append(optBtn)

    container.append(section)
    this.root = section
    this.allyList = section.querySelector('ul[data-side="ally"]')!
    this.enemyList = section.querySelector('ul[data-side="enemy"]')!
    this.menu = section.querySelector('.menu')!

    // ESC로 대상 선택 취소 — 개별 버튼이 아니라 컨테이너에서 한 번만 처리
    this.menu.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.menu.getAttribute('aria-label') === '대상 선택') {
        ev.stopPropagation()
        this.renderMenu(true)
      }
    })

    this.myTurn = false
    this.renderStatus()
    this.renderMenu(false)
    // 플레이어 차례가 오기 전까지 포커스가 body에 방치되지 않도록
    section.focus()
  }

  unmount(): void {
    this.root?.remove()
    this.root = null
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

  private setMenuDisabled(disabled: boolean): void {
    this.menu.querySelectorAll('button').forEach((b) => {
      b.disabled = disabled
    })
  }

  /** 행동이 확정된 뒤: 메뉴는 비활성으로 재구성하고 포커스는 전투 영역에 둔다 */
  private act(fn: () => void): void {
    this.myTurn = false
    fn()
    this.renderMenu(false)
    this.root?.focus()
  }

  private renderMenu(focus: boolean): void {
    const battle = this.game.battle
    if (!battle) return
    this.menu.setAttribute('aria-label', '행동 선택')
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
      onCooldown ? `${skill.name} (${player.cooldownLeft}라운드 남음)` : skill.name,
      () => {
        // 자기 대상 스킬(도발 등)은 대상 선택 없이 바로 실행
        if (skill.targeting === 'self') {
          this.act(() => this.game.playerAction({ kind: 'skill' }))
        } else {
          this.pickTarget('skill')
        }
      },
      onCooldown,
    )
    mk('방어', () => this.act(() => this.game.playerAction({ kind: 'defend' })))

    if (focus && this.myTurn) attackBtn.focus()
  }

  /** 대상 선택: 스킬의 targeting에 맞는 목록으로 메뉴를 교체, ESC로 복귀 */
  private pickTarget(kind: 'attack' | 'skill'): void {
    const battle = this.game.battle
    if (!battle) return
    this.menu.setAttribute('aria-label', '대상 선택')
    this.menu.replaceChildren()

    const targetAllies =
      kind === 'skill' && this.game.player.skill?.targeting === 'ally'
    const pool = targetAllies ? this.game.party : battle.enemies
    const targets = pool.filter((e) => e.hp > 0)

    targets.forEach((t, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = `${t.name} (체력 ${t.hp})`
      b.addEventListener('click', () => {
        this.act(() => this.game.playerAction({ kind, targetId: t.id }))
      })
      this.menu.append(b)
      if (i === 0) b.focus()
    })

    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = '뒤로'
    cancel.addEventListener('click', () => this.renderMenu(true))
    this.menu.append(cancel)
  }
}
