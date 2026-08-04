import type { Game } from '../core/game'
import type { TraitData } from '../core/types'
import type { TraitStore } from './traitStore'

/**
 * 이득과 대가를 데이터에서 문장으로 만든다.
 * 수치를 데이터와 문장 두 곳에 두면 반드시 어긋나고, 그 순간
 * "낭독은 상황과 일치한다"는 원칙이 깨진다.
 */
export function describeTrait(t: TraitData): { good: string[]; bad: string[] } {
  const good: string[] = []
  const bad: string[] = []
  const stat = (label: string, v: number) => {
    if (v > 0) good.push(`${label} ${v} 오름`)
    else if (v < 0) bad.push(`${label} ${Math.abs(v)} 내림`)
  }
  stat('체력', t.stats.hp)
  stat('공격', t.stats.atk)
  stat('방어', t.stats.def)
  stat('속도', t.stats.spd)

  if (t.combat.pierce > 0) good.push(`상대 방어를 ${t.combat.pierce} 무시한다`)
  if (t.combat.guardEvery > 0) good.push(`${t.combat.guardEvery}번째 피격을 흘린다`)
  if (t.combat.cooldownDelta < 0) {
    good.push(`스킬 대기가 ${Math.abs(t.combat.cooldownDelta)}라운드 짧다`)
  } else if (t.combat.cooldownDelta > 0) {
    bad.push(`스킬 대기가 ${t.combat.cooldownDelta}라운드 길다`)
  }
  if (t.perception.radius !== null) {
    bad.push(`걸어서 ${t.perception.radius}칸 밖은 알 수 없다`)
  }
  return { good, bad }
}

function traitSentence(t: TraitData): string {
  const { good, bad } = describeTrait(t)
  const parts: string[] = [t.summary]
  if (good.length) parts.push(`좋아지는 것: ${good.join(', ')}.`)
  if (bad.length) parts.push(`나빠지는 것: ${bad.join(', ')}.`)
  return parts.join(' ')
}

/**
 * 특성 선택 패널. 옵션 패널과 같은 <dialog> 구조라 포커스 트랩과
 * ESC 닫기를 브라우저가 처리한다.
 */
export class TraitPanel {
  private dialog: HTMLDialogElement
  private prevFocus: Element | null = null
  private closed = true

  constructor(
    private game: Game,
    private store: TraitStore,
    private hooks: { onOpen?: () => void; onClose?: () => void } = {},
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options traits'
    this.dialog.setAttribute('aria-labelledby', 'traits-title')
    this.dialog.innerHTML = `
      <h2 id="traits-title">특성 고르기</h2>
      <p class="intro">이득과 대가가 함께 붙은 플레이 스타일이다. 언제든 바꿀 수 있고,
        어떤 특성을 골라도 낭독·키보드·저자극 모드는 그대로 동작한다.</p>
      <fieldset><legend class="visually-hidden">특성</legend></fieldset>
      <button type="button" id="traits-close">닫기</button>
    `
    document.body.append(this.dialog)

    const fieldset = this.dialog.querySelector('fieldset')!
    for (const [id, trait] of Object.entries(this.game.traits.traits)) {
      fieldset.append(this.row(id, trait))
    }

    this.dialog.querySelector('#traits-close')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  private row(id: string, trait: TraitData): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'trait-row'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'trait'
    input.id = `trait-${id}`
    input.value = id
    input.setAttribute('aria-describedby', `trait-desc-${id}`)
    const label = document.createElement('label')
    label.htmlFor = input.id
    label.textContent = trait.name
    const desc = document.createElement('p')
    desc.id = `trait-desc-${id}`
    desc.className = 'trait-desc'
    desc.textContent = traitSentence(trait)

    // 고르는 즉시 적용한다 — 확정 버튼을 두면 입력이 하나 늘어난다
    input.addEventListener('change', () => {
      if (input.checked) this.select(id)
    })
    wrap.append(input, label, desc)
    return wrap
  }

  private select(id: string): void {
    if (!this.game.setTrait(id)) return
    this.store.set(id)
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  open(): void {
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    const current = this.game.currentTraitId
    const input = this.dialog.querySelector<HTMLInputElement>(`#trait-${CSS.escape(current)}`)
    if (input) input.checked = true
    // 전투 중에는 코어가 변경을 거부하므로 UI에서도 이유를 알린다
    const inBattle = this.game.mode === 'battle'
    this.dialog.querySelectorAll('input').forEach((el) => {
      el.disabled = inBattle
    })
    this.dialog.querySelector<HTMLElement>('.intro')!.textContent = inBattle
      ? '전투 중에는 특성을 바꿀 수 없다. 전투가 끝난 뒤에 다시 열어 보자.'
      : '이득과 대가가 함께 붙은 플레이 스타일이다. 언제든 바꿀 수 있고, 어떤 특성을 골라도 낭독·키보드·저자극 모드는 그대로 동작한다.'
    this.dialog.showModal()
  }

  close(): void {
    if (this.dialog.open) this.dialog.close()
    this.afterClose()
  }

  private afterClose(): void {
    if (this.closed) return
    this.closed = true
    if (this.prevFocus instanceof HTMLElement && this.prevFocus.isConnected) {
      this.prevFocus.focus()
    }
    this.hooks.onClose?.()
  }
}
