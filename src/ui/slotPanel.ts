import type { Game } from '../core/game'
import { SLOT_COUNT } from '../core/save'
import type { SlotSummary } from '../core/types'
import type { SaveRepository } from '../save/saveRepository'

type Mode = 'continue' | 'new'

function formatTime(ms: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours()}시 ${d.getMinutes()}분`
}

/**
 * 저장 자리 세 칸. 이어서 하기·새로 시작·지우기가 한 화면에 있다.
 * 나중에 클라우드 저장이 붙어도 이 화면과 조작은 그대로다 —
 * SaveRepository 구현만 바뀐다.
 */
export class SlotPanel {
  private dialog: HTMLDialogElement
  private list: HTMLElement
  private prevFocus: Element | null = null
  private closed = true
  private mode: Mode = 'continue'

  constructor(
    private game: Game,
    private repo: SaveRepository,
    private hooks: {
      onOpen?: () => void
      onClose?: () => void
      onStart: (slot: number) => void
      onContinue: (slot: number) => void
      announce: (text: string) => void
    },
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options slots'
    this.dialog.setAttribute('aria-labelledby', 'slots-title')
    this.dialog.innerHTML = `
      <h2 id="slots-title">모험 기록</h2>
      <p class="intro"></p>
      <ul class="slot-list"></ul>
      <button type="button" id="slots-close">닫기</button>
    `
    document.body.append(this.dialog)
    this.list = this.dialog.querySelector('.slot-list')!
    this.dialog.querySelector('#slots-close')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  async open(mode: Mode): Promise<void> {
    this.mode = mode
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.dialog.querySelector<HTMLElement>('.intro')!.textContent =
      mode === 'new'
        ? '새 모험을 시작할 자리를 고르자. 기록이 있는 자리를 고르면 지워도 되는지 먼저 묻는다.'
        : '이어서 할 기록을 고르자.'
    await this.render()
    this.dialog.showModal()
    this.dialog.querySelector<HTMLElement>('button:not([disabled])')?.focus()
  }

  private async render(): Promise<void> {
    const slots = await this.repo.list()
    this.list.replaceChildren(...slots.map((s) => this.row(s)))
  }

  private describe(s: SlotSummary): string {
    if (s.empty) return `${s.slot + 1}번 자리. 비어 있다.`
    const stage = this.game.stageAt(s.stageIndex ?? 0)
    const trait = this.game.traits.traits[s.traitId ?? '']
    const when = formatTime(s.updatedAt ?? 0)
    const parts = [
      `${s.slot + 1}번 자리.`,
      stage ? `${stage.title}, 셋 중 ${(s.stageIndex ?? 0) + 1}번째.` : '',
      trait ? `특성 ${trait.name}.` : '',
      when,
    ]
    return parts.filter(Boolean).join(' ')
  }

  private row(s: SlotSummary): HTMLLIElement {
    const li = document.createElement('li')
    li.className = 'slot-row'
    const desc = document.createElement('p')
    desc.className = 'slot-desc'
    desc.id = `slot-desc-${s.slot}`
    desc.textContent = this.describe(s)
    li.append(desc)

    const actions = document.createElement('div')
    actions.className = 'slot-actions'

    if (this.mode === 'continue') {
      const go = document.createElement('button')
      go.type = 'button'
      go.textContent = '이어서 하기'
      go.disabled = s.empty
      go.setAttribute('aria-describedby', desc.id)
      go.addEventListener('click', () => this.continueSlot(s.slot))
      actions.append(go)
    } else {
      const go = document.createElement('button')
      go.type = 'button'
      go.textContent = s.empty ? '여기서 새로 시작' : '여기에 새로 시작'
      go.setAttribute('aria-describedby', desc.id)
      go.addEventListener('click', () => this.startSlot(s))
      actions.append(go)
    }

    if (!s.empty) {
      const del = document.createElement('button')
      del.type = 'button'
      del.textContent = '지우기'
      del.setAttribute('aria-describedby', desc.id)
      del.addEventListener('click', () => this.removeSlot(s))
      actions.append(del)
    }

    li.append(actions)
    return li
  }

  private async continueSlot(slot: number): Promise<void> {
    const snapshot = await this.repo.load(slot)
    if (!snapshot) {
      this.hooks.announce('그 자리의 기록을 읽을 수 없다.')
      await this.render()
      return
    }
    this.close()
    this.hooks.onContinue(slot)
  }

  private async startSlot(s: SlotSummary): Promise<void> {
    // 덮어쓰기는 한 번의 클릭으로 끝나지 않게 한다
    if (!s.empty) {
      const ok = window.confirm(
        `${s.slot + 1}번 자리의 기록을 지우고 새로 시작할까?\n${this.describe(s)}`,
      )
      if (!ok) return
      await this.repo.remove(s.slot)
    }
    this.close()
    this.hooks.onStart(s.slot)
  }

  private async removeSlot(s: SlotSummary): Promise<void> {
    const ok = window.confirm(`${s.slot + 1}번 자리의 기록을 지울까?\n${this.describe(s)}`)
    if (!ok) return
    await this.repo.remove(s.slot)
    this.hooks.announce(`${s.slot + 1}번 자리를 지웠다. 비어 있다.`)
    await this.render()
    this.dialog.querySelector<HTMLElement>('button:not([disabled])')?.focus()
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

  /** 저장된 기록이 하나라도 있는지 — 타이틀의 "이어서 하기" 노출 판단용 */
  async hasAny(): Promise<boolean> {
    const slots = await this.repo.list()
    return slots.some((s) => !s.empty)
  }

  static get slotCount(): number {
    return SLOT_COUNT
  }
}
