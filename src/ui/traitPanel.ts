import type { Game } from '../core/game'
import type { TraitCategory, TraitData } from '../core/types'
import type { TraitStore } from './traitStore'

/** 화면에 나오는 묶음 순서 — 처음 여는 사람이 볼 것부터 */
const CATEGORY_ORDER: TraitCategory[] = ['basic', 'combat', 'challenge']

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
  if (t.offhand) {
    good.push(`주력이 아닌 쪽 공격이 주력의 ${Math.round(t.offhand * 100)}%까지 오른다`)
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
 *
 * 이 창에는 설명 책임이 하나 더 있다. 도움이 필요해서 여기까지 온 사람이
 * "특성을 잘 고르면 편해지나?" 하고 오해하기 쉬운데, 몸에 맞추는 것은 옵션의
 * 일이고 특성은 게임 상태만 바꾼다. 그 경계를 말하고, 옵션으로 가는 길도 연다.
 */
export class TraitPanel {
  private dialog: HTMLDialogElement
  private prevFocus: Element | null = null
  private closed = true

  constructor(
    private game: Game,
    private store: TraitStore,
    private hooks: { onOpen?: () => void; onClose?: () => void; onOpenOptions?: () => void } = {},
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options traits'
    this.dialog.setAttribute('aria-labelledby', 'traits-title')
    this.dialog.innerHTML = `
      <h2 id="traits-title">특성 고르기</h2>
      <p class="trait-whose"></p>
      <p class="intro">이득과 대가가 한 묶음으로 붙은 플레이 스타일이다. 어느 것을 골라도
        끝까지 갈 수 있게 맞춰 두었으니, 더 센 쪽이 아니라 더 편한 쪽으로 고르면 된다.
        준비하는 자리(타이틀·쉼터)에서 언제든 다시 바꿀 수 있다.</p>
      <div class="trait-boundary">
        <p>화면·소리·조작을 몸에 맞추는 것은 특성이 아니라 <strong>옵션</strong>이 한다.
          낭독·자막·키보드 조작·큰 글씨·저자극은 어떤 특성을 골라도 늘 켜져 있고,
          특성이 그것들을 끄거나 줄이는 일은 없다.</p>
        <button type="button" id="traits-to-options">옵션 열기</button>
      </div>
      <button type="button" id="traits-close">닫기</button>
    `
    document.body.append(this.dialog)

    const closeBtn = this.dialog.querySelector('#traits-close')!
    for (const key of CATEGORY_ORDER) {
      const group = this.categoryGroup(key)
      if (group) this.dialog.insertBefore(group, closeBtn)
    }

    const toOptions = this.dialog.querySelector<HTMLButtonElement>('#traits-to-options')!
    if (this.hooks.onOpenOptions) {
      // 창을 겹치지 않는다 — 이 창을 닫고 옵션을 연다
      toOptions.addEventListener('click', () => {
        const open = this.hooks.onOpenOptions!
        this.close()
        open()
      })
    } else {
      toOptions.remove()
    }

    closeBtn.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  /** 한 묶음(기본·전투·도전)을 fieldset 하나로 — 소제목이 곧 고르는 기준이 된다 */
  private categoryGroup(key: TraitCategory): HTMLElement | null {
    const entries = Object.entries(this.game.traits.traits).filter(
      ([, t]) => t.category === key,
    )
    if (!entries.length) return null
    const meta = this.game.traits.categories[key]

    const fieldset = document.createElement('fieldset')
    fieldset.className = 'trait-group'
    const legend = document.createElement('legend')
    legend.textContent = meta.name
    const note = document.createElement('p')
    note.className = 'trait-cat-note'
    note.textContent = meta.note
    fieldset.append(legend, note)
    for (const [id, trait] of entries) fieldset.append(this.row(id, trait))
    return fieldset
  }

  private row(id: string, trait: TraitData): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'trait-row'
    const input = document.createElement('input')
    input.type = 'radio'
    input.name = 'trait'
    input.id = `trait-${id}`
    input.value = id
    // 맞음새를 수치보다 먼저 읽는다 — 고를 근거가 숫자가 아니라 상황이어야 한다
    input.setAttribute('aria-describedby', `trait-fit-${id} trait-desc-${id}`)
    const label = document.createElement('label')
    label.htmlFor = input.id
    label.textContent = trait.name
    const fit = document.createElement('p')
    fit.id = `trait-fit-${id}`
    fit.className = 'trait-fit'
    fit.textContent = trait.fit
    const desc = document.createElement('p')
    desc.id = `trait-desc-${id}`
    desc.className = 'trait-desc'
    desc.textContent = traitSentence(trait)

    // 고르는 즉시 적용한다 — 확정 버튼을 두면 입력이 하나 늘어난다
    input.addEventListener('change', () => {
      if (input.checked) this.select(id)
    })
    wrap.append(input, label, fit, desc)
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
    // 바꿀 수 없는 자리라면 이유를 그대로 보여 준다 — 코어가 거부하는 근거와 같은 문장
    const { ok, reason } = this.game.canChangeTrait()
    this.dialog.querySelectorAll('input').forEach((el) => {
      el.disabled = !ok
    })
    this.dialog.querySelector<HTMLElement>('.intro')!.textContent = ok
      ? '이득과 대가가 한 묶음으로 붙은 플레이 스타일이다. 어느 것을 골라도 끝까지 갈 수 있게 ' +
        '맞춰 두었으니, 더 센 쪽이 아니라 더 편한 쪽으로 고르면 된다. ' +
        '준비하는 자리(타이틀·쉼터)에서 언제든 다시 바꿀 수 있다.'
      : `${reason} 지금 특성은 ${this.game.trait.name}이다.`
    // 함께 하기에서는 내 자리의 눈만 바꾼다 — 누구 것을 고르는 중인지 밝힌다
    const whose = this.dialog.querySelector<HTMLElement>('.trait-whose')!
    const me = this.game.party[this.game.localSeat]
    whose.textContent = this.game.party.length > 1 && me ? `${me.name}의 특성이다.` : ''
    whose.hidden = !whose.textContent
    this.dialog.showModal()
    // 다른 패널과 같은 규칙으로 첫 조작 지점에 포커스를 둔다 — 브라우저 기본 동작에
    // 기대면 패널마다 다르게 동작하고, 그 차이가 낭독으로 먼저 드러난다
    const first = this.dialog.querySelector<HTMLElement>(
      ok ? 'input:not(:disabled)' : 'button',
    )
    first?.focus()
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
