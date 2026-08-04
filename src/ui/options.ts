import type { OptionsStore } from './optionsStore'

/** 접근성·소리 옵션 패널. <dialog>라 포커스 트랩과 ESC 닫기는 브라우저가 처리한다. */
export class OptionsPanel {
  private dialog: HTMLDialogElement
  private prevFocus: Element | null = null

  constructor(
    private store: OptionsStore,
    private hooks: { onOpen?: () => void; onClose?: () => void } = {},
  ) {
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
        <label for="opt-textlog">텍스트 기록 표시</label>
        <input type="checkbox" id="opt-textlog" />
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
    this.bind('opt-textlog', 'textLog')

    const volume = this.dialog.querySelector<HTMLInputElement>('#opt-volume')!
    volume.addEventListener('change', () => {
      this.store.set('volume', Number(volume.value) / 100)
    })

    this.dialog.querySelector('#opt-close')!.addEventListener('click', () => {
      this.close()
    })
    // ESC(cancel) 등 브라우저가 닫는 경로도 같은 정리 루틴을 타게 한다
    this.dialog.addEventListener('close', () => this.afterClose())

    this.applyGlobal()
  }

  private bind(id: string, key: 'captions' | 'lowStim' | 'textLarge' | 'textLog'): void {
    const input = this.dialog.querySelector<HTMLInputElement>(`#${id}`)!
    input.addEventListener('change', () => {
      this.store.set(key, input.checked)
      this.applyGlobal()
    })
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  close(): void {
    if (this.dialog.open) this.dialog.close()
    this.afterClose()
  }

  /** 닫힘 정리 — 어떤 경로로 닫혀도 1회만 실행 */
  private afterClose(): void {
    if (this.closed) return
    this.closed = true
    this.applyGlobal()
    // 옵션이 열려 있는 동안 화면이 바뀌었을 수 있다(전투 종료 등)
    if (this.prevFocus instanceof HTMLElement && this.prevFocus.isConnected) {
      this.prevFocus.focus()
    }
    this.hooks.onClose?.()
  }

  private closed = true

  open(): void {
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    const o = this.store.options
    this.dialog.querySelector<HTMLInputElement>('#opt-captions')!.checked = o.captions
    this.dialog.querySelector<HTMLInputElement>('#opt-lowstim')!.checked = o.lowStim
    this.dialog.querySelector<HTMLInputElement>('#opt-textlarge')!.checked = o.textLarge
    this.dialog.querySelector<HTMLInputElement>('#opt-textlog')!.checked = o.textLog
    this.dialog.querySelector<HTMLInputElement>('#opt-volume')!.value = String(
      Math.round(o.volume * 100),
    )
    this.dialog.showModal()
  }

  /** 문서 전역에 반영되는 옵션: 글씨 크기·저자극 팔레트, 자막·텍스트 기록 표시 */
  private applyGlobal(): void {
    const o = this.store.options
    document.documentElement.classList.toggle('text-large', o.textLarge)
    document.documentElement.classList.toggle('low-stim', o.lowStim)
    document.querySelector<HTMLElement>('#captions')!.style.visibility = o.captions
      ? 'visible'
      : 'hidden'
    document.querySelector<HTMLElement>('#text-log')!.hidden = !o.textLog
  }
}
