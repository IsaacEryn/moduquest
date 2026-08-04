import type { Game } from '../core/game'

/** 접근성·소리 옵션 패널. <dialog>라 포커스 트랩과 ESC 닫기는 브라우저가 처리한다. */
export class OptionsPanel {
  private dialog: HTMLDialogElement
  private prevFocus: Element | null = null

  constructor(private game: Game) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options'
    this.dialog.innerHTML = `
      <h2 id="options-title">옵션</h2>
      <div class="row">
        <label for="opt-captions">자막 표시</label>
        <input type="checkbox" id="opt-captions" />
      </div>
      <div class="row">
        <label for="opt-lowstim">저자극 모드</label>
        <input type="checkbox" id="opt-lowstim" />
      </div>
      <div class="row">
        <label for="opt-textlarge">큰 글씨</label>
        <input type="checkbox" id="opt-textlarge" />
      </div>
      <div class="row">
        <label for="opt-volume">소리 크기</label>
        <input type="range" id="opt-volume" min="0" max="100" step="10" />
      </div>
      <button type="button" id="opt-close">닫기</button>
    `
    this.dialog.setAttribute('aria-labelledby', 'options-title')
    document.body.append(this.dialog)

    this.bind('opt-captions', 'captions')
    this.bind('opt-lowstim', 'lowStim')
    this.bind('opt-textlarge', 'textLarge')

    const volume = this.dialog.querySelector<HTMLInputElement>('#opt-volume')!
    volume.addEventListener('change', () => {
      this.game.setOption('volume', Number(volume.value) / 100)
    })

    this.dialog.querySelector('#opt-close')!.addEventListener('click', () => {
      this.dialog.close()
    })
    this.dialog.addEventListener('close', () => {
      this.applyGlobal()
      if (this.prevFocus instanceof HTMLElement) this.prevFocus.focus()
    })

    this.applyGlobal()
  }

  private bind(id: string, key: 'captions' | 'lowStim' | 'textLarge'): void {
    const input = this.dialog.querySelector<HTMLInputElement>(`#${id}`)!
    input.addEventListener('change', () => {
      this.game.setOption(key, input.checked)
      this.applyGlobal()
    })
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  open(): void {
    this.prevFocus = document.activeElement
    const o = this.game.options
    this.dialog.querySelector<HTMLInputElement>('#opt-captions')!.checked = o.captions
    this.dialog.querySelector<HTMLInputElement>('#opt-lowstim')!.checked = o.lowStim
    this.dialog.querySelector<HTMLInputElement>('#opt-textlarge')!.checked = o.textLarge
    this.dialog.querySelector<HTMLInputElement>('#opt-volume')!.value = String(
      Math.round(o.volume * 100),
    )
    this.dialog.showModal()
  }

  /** 문서 전역에 반영되는 옵션: 글씨 크기·저자극 팔레트, 자막 영역 표시 */
  private applyGlobal(): void {
    const o = this.game.options
    document.documentElement.classList.toggle('text-large', o.textLarge)
    document.documentElement.classList.toggle('low-stim', o.lowStim)
    document.querySelector<HTMLElement>('#captions')!.style.visibility = o.captions
      ? 'visible'
      : 'hidden'
  }
}
