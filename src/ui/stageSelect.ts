import type { Game } from '../core/game'

/**
 * 스테이지 고르기. 클리어한 곳은 다시 갈 수 있다 —
 * 반복해서 익히는 것이 인지 접근성에 도움이 되고, 처음부터 다시 걷게 할 이유도 없다.
 */
export class StageSelect {
  private dialog: HTMLDialogElement
  private list: HTMLElement
  private prevFocus: Element | null = null
  private closed = true

  constructor(
    private game: Game,
    private hooks: { onOpen?: () => void; onClose?: () => void; onPick: (index: number) => void },
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options slots'
    this.dialog.setAttribute('aria-labelledby', 'stage-select-title')
    this.dialog.innerHTML = `
      <h2 id="stage-select-title">스테이지 고르기</h2>
      <p class="intro">클리어한 스테이지는 다시 갈 수 있다. 지금 기록은 그대로 남는다.</p>
      <ul class="slot-list"></ul>
      <button type="button" id="stage-select-close">닫기</button>
    `
    document.body.append(this.dialog)
    this.list = this.dialog.querySelector('.slot-list')!
    this.dialog
      .querySelector('#stage-select-close')!
      .addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  open(): void {
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.render()
    this.dialog.showModal()
    this.dialog.querySelector<HTMLElement>('button:not([disabled])')?.focus()
  }

  private render(): void {
    const cleared = new Set(this.game.clearedStageIds)
    const rows: HTMLLIElement[] = []

    for (let i = 0; i < this.game.stageCount; i++) {
      const stage = this.game.stageAt(i)!
      // 첫 스테이지와 이미 깬 곳, 그리고 그 다음 한 곳까지 갈 수 있다
      const prev = i === 0 ? null : this.game.stageAt(i - 1)
      const unlocked = i === 0 || cleared.has(stage.id) || (prev ? cleared.has(prev.id) : false)

      const li = document.createElement('li')
      li.className = 'slot-row'
      const desc = document.createElement('p')
      desc.className = 'slot-desc'
      desc.id = `stage-desc-${i}`
      desc.textContent = unlocked
        ? `${i + 1}. ${stage.title}${cleared.has(stage.id) ? ' — 클리어함' : ''}. 목표: ${stage.objective}`
        : `${i + 1}. 아직 잠겨 있다. 앞 스테이지를 먼저 클리어하자.`
      li.append(desc)

      const actions = document.createElement('div')
      actions.className = 'slot-actions'
      const go = document.createElement('button')
      go.type = 'button'
      go.textContent = unlocked ? '여기서 시작' : '잠김'
      go.disabled = !unlocked
      go.setAttribute('aria-describedby', desc.id)
      go.addEventListener('click', () => {
        this.close()
        this.hooks.onPick(i)
      })
      actions.append(go)
      li.append(actions)
      rows.push(li)
    }
    this.list.replaceChildren(...rows)
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
