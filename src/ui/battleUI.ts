import { Battle } from '../core/battle'
import type { EventBus } from '../core/events'
import type { Game } from '../core/game'
import type { Combatant } from '../core/types'
import { gauge } from './gauge'
import { resistBadge } from './monsterText'

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
  /** 지금 행동하는 쪽 — 목록에 (차례) 표시를 남긴다 */
  private currentActorId: string | null = null
  private turnStatus: HTMLParagraphElement | null = null

  constructor(
    private game: Game,
    bus: EventBus,
    private openOptions: () => void,
  ) {
    bus.on((e) => {
      if (!this.root) return
      switch (e.type) {
        case 'playerTurn': {
          // 함께 하기에서는 다른 자리 사람의 차례도 이 이벤트로 온다 —
          // 메뉴는 내 차례에만 열린다. 남의 차례에 눌러도 코어가 거절하지만,
          // 눌리지 않는 것이 곧 상태 설명이다
          const mine = e.actor.seat === undefined || e.actor.seat === this.game.localSeat
          const wasMyTurn = this.myTurn
          this.myTurn = mine
          if (this.turnStatus) {
            this.turnStatus.textContent = mine
              ? '내 차례 — 행동을 고르자.'
              : `${e.actor.name}의 사람이 행동을 고르는 중…`
          }
          this.renderMenu(mine && !wasMyTurn)
          break
        }
        case 'attacked':
        case 'healed':
        case 'downed':
        case 'deflected':
        case 'manaSpent':
        case 'victory':
          this.renderStatus()
          break
        case 'turnStart':
          // 라운드가 넘어가면 마력이 조용히 돌아온다 — 턴마다 상태판을 다시 읽는다.
          // 버튼이 왜 회색인지도 여기서 말한다 — 지금 누구 차례인지가 그 이유다
          this.currentActorId = e.actor.id
          if (!e.actor.isPlayer) {
            this.myTurn = false
            this.setMenuDisabled(true)
            if (this.turnStatus) {
              const name = e.actor.side === 'ally' ? e.actor.name : `적 ${e.actor.name}`
              this.turnStatus.textContent = `${name}의 차례…`
            }
          }
          this.renderStatus()
          break
        case 'battleEnd':
          this.currentActorId = null
          if (this.turnStatus) this.turnStatus.textContent = ''
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
      <p class="turn-status"></p>
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
    this.turnStatus = section.querySelector('.turn-status')
    this.currentActorId = null

    // ESC로 대상·도구 선택 취소 — 개별 버튼이 아니라 컨테이너에서 한 번만 처리
    this.menu.addEventListener('keydown', (ev) => {
      const label = this.menu.getAttribute('aria-label')
      if (ev.key === 'Escape' && (label === '대상 선택' || label === '도구 선택')) {
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
    // 앞줄에 선 사람은 하급 몹의 몫을 먼저 받는다 — 목록에서도 그렇게 보여야 한다
    const front = Battle.frontOf(this.game.party.filter((c) => c.hp > 0))
    const item = (c: Combatant) => {
      const li = document.createElement('li')
      if (c.hp <= 0) {
        li.className = 'downed'
        li.textContent = `${c.name} — 쓰러짐`
        return li
      }
      const deflect = Battle.willDeflect(c) ? ' · 다음 피격 흘림' : ''
      const mana = c.maxMp > 0 ? ` · 마력 ${c.mp}/${c.maxMp}` : ''
      const line = c.id === front?.id ? ' (앞줄)' : ''
      const acting = c.id === this.currentActorId ? ' (차례)' : ''
      // 문장이 의미 채널이다 — 게이지는 그 곁의 시각 장식일 뿐이라 문장을 바꾸지 않는다
      // 약점은 화면에도 늘 떠 있어야 한다. 창을 열어 확인해야 하는 정보였다면
      // 기억력 좋은 사람만 유리해진다
      const weak = resistBadge(c.resist)
      const text = document.createElement('span')
      text.textContent =
        `${c.name}${line}${acting} — 체력 ${c.hp}/${c.maxHp}${mana}${deflect}` +
        (weak ? ` · ${weak}` : '')
      li.append(text, gauge(c.hp, c.maxHp, 'hp'))
      if (c.maxMp > 0) li.append(gauge(c.mp, c.maxMp, 'mp'))
      if (c.id === this.currentActorId) li.classList.add('acting')
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

    const player = this.game.localMember
    const mk = (label: string, onClick: () => void, disabled = false) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.disabled = disabled || !this.myTurn
      b.addEventListener('click', onClick)
      this.menu.append(b)
      return b
    }

    const attackBtn = mk('공격', () => this.pickTarget({ kind: 'attack' }))

    // 언락된 스킬을 전부 나열한다 — 순서는 데이터가 정한다.
    // 못 쓰는 이유(쿨다운인지 마력인지)를 라벨에 밝힌다 — 회색 버튼만으로는 알 수 없다
    player.skills.forEach((skill, i) => {
      const cd = player.cooldowns[i] ?? 0
      const cost = skill.mpCost ?? 0
      const shortOfMana = cost > player.mp
      const blocked = cd > 0 || shortOfMana
      const costLabel = cost > 0 ? ` · 마력 ${cost}` : ''
      const reason = cd > 0 ? ` (${cd}라운드 남음)` : shortOfMana ? ' (마력 부족)' : ''
      mk(
        `${skill.name}${costLabel}${reason}`,
        () => {
          // 자기 대상·전체 대상 스킬은 고를 것이 없으니 바로 실행
          if (skill.targeting === 'self' || skill.targeting.endsWith('-all')) {
            this.act(() => this.game.playerAction({ kind: 'skill', skillIndex: i }))
          } else {
            this.pickTarget({ kind: 'skill', skillIndex: i })
          }
        },
        blocked,
      )
    })

    // 쓸 수 있는 아이템이 있을 때만 — 빈 가방 버튼은 소음이다
    if (this.game.inventoryList.some((i) => i.usableInBattle)) {
      mk('도구', () => this.pickItem())
    }

    mk('방어', () => this.act(() => this.game.playerAction({ kind: 'defend' })))

    if (focus && this.myTurn) attackBtn.focus()
  }

  /** 도구 선택: 쓸 수 있는 아이템 목록으로 메뉴를 교체, 고르면 대상 선택으로 */
  private pickItem(): void {
    this.menu.setAttribute('aria-label', '도구 선택')
    this.menu.replaceChildren()

    const usable = this.game.inventoryList.filter((i) => i.usableInBattle)
    usable.forEach((item, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = `${item.name} ×${item.count} — ${item.description}`
      b.addEventListener('click', () => this.pickTarget({ kind: 'item', itemId: item.id }))
      this.menu.append(b)
      if (i === 0) b.focus()
    })

    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = '뒤로'
    cancel.addEventListener('click', () => this.renderMenu(true))
    this.menu.append(cancel)
  }

  /** 대상 선택: 행동의 성격에 맞는 목록으로 메뉴를 교체, ESC로 복귀 */
  private pickTarget(
    action:
      | { kind: 'attack' }
      | { kind: 'skill'; skillIndex: number }
      | { kind: 'item'; itemId: string },
  ): void {
    const battle = this.game.battle
    if (!battle) return
    this.menu.setAttribute('aria-label', '대상 선택')
    this.menu.replaceChildren()

    const player = this.game.localMember
    const targetAllies =
      action.kind === 'item' ||
      (action.kind === 'skill' && player.skills[action.skillIndex]?.targeting === 'ally')
    const pool = targetAllies ? this.game.party : battle.enemies
    const targets = pool.filter((e) => e.hp > 0)

    targets.forEach((t, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      const weak = resistBadge(t.resist)
      b.textContent = `${t.name} (체력 ${t.hp}${weak ? `, ${weak}` : ''})`
      b.addEventListener('click', () => {
        this.act(() => this.game.playerAction({ ...action, targetId: t.id }))
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
