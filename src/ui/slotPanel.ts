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
    this.confirmStage.clear()
    this.dialog.querySelector<HTMLElement>('.intro')!.textContent =
      mode === 'new'
        ? '새 모험을 시작할 자리를 고르자. 기록이 있는 자리는 먼저 지워야 쓸 수 있다.'
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

  /** 칸별 지우기 확인 단계 (0=평상시, 1=첫 확인, 2=마지막 확인) */
  private confirmStage = new Map<number, number>()

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
    const mk = (label: string, onClick: () => void, disabled = false) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.disabled = disabled
      b.setAttribute('aria-describedby', desc.id)
      b.addEventListener('click', onClick)
      actions.append(b)
      return b
    }

    const stage = this.confirmStage.get(s.slot) ?? 0
    if (stage > 0 && !s.empty) {
      // 지우기 확인 중 — 이 칸의 버튼이 확인 단계로 바뀐다
      const question =
        stage === 1
          ? '이 기록을 지울까?'
          : '정말 지울까? 지우면 되돌릴 수 없다.'
      const q = document.createElement('p')
      q.className = 'slot-confirm'
      q.textContent = question
      li.append(q)
      mk(stage === 1 ? '지운다' : '정말 지운다', () => this.advanceRemove(s))
      mk('그만두기', () => {
        this.confirmStage.delete(s.slot)
        this.hooks.announce('지우지 않았다. 기록은 그대로다.')
        void this.rerender(s.slot)
      })
      li.append(actions)
      return li
    }

    if (s.empty) {
      if (this.mode === 'new') {
        mk('여기서 새로 시작', () => {
          this.close()
          this.hooks.onStart(s.slot)
        })
      } else {
        mk('이어서 하기', () => {}, true)
      }
    } else {
      if (this.mode === 'continue') {
        mk('이어서 하기', () => this.continueSlot(s.slot))
      }
      // 기록이 있는 칸에서 새로 시작하려면 먼저 지워야 한다 —
      // 실수 한 번으로 기록이 사라지는 길을 없앤다
      mk('지우기', () => {
        this.confirmStage.set(s.slot, 1)
        this.hooks.announce(`${s.slot + 1}번 자리. 이 기록을 지울까?`)
        void this.rerender(s.slot)
      })
    }

    li.append(actions)
    return li
  }

  /** 확인 1단계 → 2단계 → 실제 삭제 */
  private async advanceRemove(s: SlotSummary): Promise<void> {
    const stage = this.confirmStage.get(s.slot) ?? 0
    if (stage === 1) {
      this.confirmStage.set(s.slot, 2)
      this.hooks.announce('정말 지울까? 지우면 되돌릴 수 없다.')
      await this.rerender(s.slot)
      return
    }
    this.confirmStage.delete(s.slot)
    await this.repo.remove(s.slot)
    this.hooks.announce(
      this.mode === 'new'
        ? `${s.slot + 1}번 자리를 지웠다. 이제 여기서 새로 시작할 수 있다.`
        : `${s.slot + 1}번 자리를 지웠다. 비어 있다.`,
    )
    await this.rerender(s.slot)
  }

  /** 다시 그리고 해당 칸의 첫 버튼에 포커스를 되돌린다 */
  private async rerender(focusSlot: number): Promise<void> {
    await this.render()
    const rows = this.list.querySelectorAll('.slot-row')
    const target = rows[focusSlot]?.querySelector<HTMLElement>('button:not([disabled])')
    ;(target ?? this.dialog.querySelector<HTMLElement>('button:not([disabled])'))?.focus()
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
