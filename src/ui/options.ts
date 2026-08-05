import type { OptionsStore } from './optionsStore'

/** 접근성·소리 옵션 패널. <dialog>라 포커스 트랩과 ESC 닫기는 브라우저가 처리한다. */
export class OptionsPanel {
  private dialog: HTMLDialogElement
  private prevFocus: Element | null = null

  constructor(
    private store: OptionsStore,
    private hooks: {
      onOpen?: () => void
      onClose?: () => void
      /** 지금 나갈 수 있는 상황인지(타이틀에서는 나갈 곳이 없다) */
      canExit?: () => boolean
      /** 타이틀로 나가기 — 확인을 거친 뒤에만 불린다 */
      onExit?: () => void
      announce?: (text: string) => void
    } = {},
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
        <label for="opt-trail">지나온 길 표시</label>
        <input type="checkbox" id="opt-trail" />
      </div>
      <div class="row">
        <label for="opt-music">배경음악</label>
        <input type="checkbox" id="opt-music" />
      </div>
      <div class="row">
        <label for="opt-volume">소리 크기</label>
        <input type="range" id="opt-volume" min="0" max="100" step="10" />
      </div>
      <div class="slot-actions">
        <button type="button" id="opt-close">닫기</button>
        <button type="button" id="opt-exit" hidden>타이틀로 나가기</button>
      </div>
      <p class="slot-confirm" id="opt-exit-confirm" hidden></p>
    `
    this.dialog.setAttribute('aria-labelledby', 'options-title')
    document.body.append(this.dialog)

    this.bind('opt-captions', 'captions')
    this.bind('opt-lowstim', 'lowStim')
    this.bind('opt-textlarge', 'textLarge')
    this.bind('opt-textlog', 'textLog')
    this.bind('opt-trail', 'trail')
    this.bind('opt-music', 'music')

    const volume = this.dialog.querySelector<HTMLInputElement>('#opt-volume')!
    volume.addEventListener('change', () => {
      this.store.set('volume', Number(volume.value) / 100)
    })

    this.dialog.querySelector('#opt-close')!.addEventListener('click', () => {
      this.close()
    })

    // 나가기는 한 번 되묻는다 — 진행 중인 판을 실수로 접지 않도록.
    // 저장은 필드에서 자동으로 되므로 이어서 하기로 돌아올 수 있다는 사실을 함께 알린다
    const exitBtn = this.dialog.querySelector<HTMLButtonElement>('#opt-exit')!
    const confirm = this.dialog.querySelector<HTMLElement>('#opt-exit-confirm')!
    exitBtn.addEventListener('click', () => {
      if (!this.confirmingExit) {
        this.confirmingExit = true
        const text = '타이틀로 나갈까? 지금까지의 진행은 저장 자리에 남는다.'
        confirm.textContent = text
        confirm.hidden = false
        exitBtn.textContent = '정말 나가기'
        this.hooks.announce?.(text)
        return
      }
      this.close()
      this.hooks.onExit?.()
    })
    // ESC(cancel) 등 브라우저가 닫는 경로도 같은 정리 루틴을 타게 한다
    this.dialog.addEventListener('close', () => this.afterClose())

    this.applyGlobal()
  }

  private bind(
    id: string,
    key: 'captions' | 'lowStim' | 'textLarge' | 'textLog' | 'trail' | 'music',
  ): void {
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
  private confirmingExit = false

  open(): void {
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement

    // 열 때마다 확인 단계를 처음으로 되돌린다 — 닫았다 열면 다시 묻는 것이 안전하다
    this.confirmingExit = false
    const exitBtn = this.dialog.querySelector<HTMLButtonElement>('#opt-exit')!
    const confirm = this.dialog.querySelector<HTMLElement>('#opt-exit-confirm')!
    exitBtn.textContent = '타이틀로 나가기'
    exitBtn.hidden = !(this.hooks.canExit?.() ?? false)
    confirm.hidden = true
    confirm.textContent = ''
    const o = this.store.options
    this.dialog.querySelector<HTMLInputElement>('#opt-captions')!.checked = o.captions
    this.dialog.querySelector<HTMLInputElement>('#opt-lowstim')!.checked = o.lowStim
    this.dialog.querySelector<HTMLInputElement>('#opt-textlarge')!.checked = o.textLarge
    this.dialog.querySelector<HTMLInputElement>('#opt-textlog')!.checked = o.textLog
    this.dialog.querySelector<HTMLInputElement>('#opt-trail')!.checked = o.trail
    this.dialog.querySelector<HTMLInputElement>('#opt-music')!.checked = o.music
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
