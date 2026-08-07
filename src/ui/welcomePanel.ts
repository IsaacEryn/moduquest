import type { OptionsStore, Theme } from './optionsStore'
import { THEMES } from './optionsStore'

/**
 * 첫 실행의 환영 설정 — "모험을 몸에 맞게".
 *
 * 이 게임의 존재 이유가 접근성인데, 편의 옵션이 옵션 창 안에 숨어 있으면
 * 정작 필요한 사람이 첫 화면부터 안 맞는 화면을 견디게 된다. 그래서 처음
 * 한 번, 게임에 들어가기 전에 핵심 네 가지만 묻는다. 전부 옵션 창의 것과
 * 같은 저장소를 조작한다 — 여기서 고른 것이 곧 설정이다.
 */
export class WelcomePanel {
  private dialog: HTMLDialogElement
  private closed = true
  /** 이번 열림이 끝나면 갈 곳 — 새 모험 흐름이 파티 짜기로 이어 준다 */
  private onDone: (() => void) | null = null

  constructor(
    private store: OptionsStore,
    private hooks: {
      announce: (text: string) => void
      onClose?: () => void
    },
  ) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options welcome'
    this.dialog.setAttribute('aria-labelledby', 'welcome-title')
    this.dialog.innerHTML = `
      <h2 id="welcome-title">모험을 몸에 맞게</h2>
      <p class="intro">시작하기 전에 화면과 소리를 맞춰 두자.
        전부 나중에 옵션에서 언제든 바꿀 수 있다.</p>
      <fieldset class="opt-theme">
        <legend>화면 테마</legend>
        <div class="opt-theme-choices">
          <span><input type="radio" name="welcome-theme" id="welcome-theme-system" value="system" /><label for="welcome-theme-system">기기 설정 따르기</label></span>
          <span><input type="radio" name="welcome-theme" id="welcome-theme-dark" value="dark" /><label for="welcome-theme-dark">어둡게</label></span>
          <span><input type="radio" name="welcome-theme" id="welcome-theme-light" value="light" /><label for="welcome-theme-light">밝게</label></span>
          <span><input type="radio" name="welcome-theme" id="welcome-theme-contrast" value="contrast" /><label for="welcome-theme-contrast">고대비</label></span>
        </div>
      </fieldset>
      <div class="row">
        <label for="welcome-textlarge">큰 글씨</label>
        <input type="checkbox" id="welcome-textlarge" />
      </div>
      <div class="row">
        <label for="welcome-captions">자막 표시</label>
        <input type="checkbox" id="welcome-captions" />
      </div>
      <div class="row">
        <label for="welcome-lowstim">저자극 모드 (움직임 줄이기)</label>
        <input type="checkbox" id="welcome-lowstim" />
      </div>
      <div class="slot-actions">
        <button type="button" id="welcome-start">이대로 시작하기</button>
      </div>
    `
    document.body.append(this.dialog)

    for (const t of THEMES) {
      const radio = this.dialog.querySelector<HTMLInputElement>(`#welcome-theme-${t}`)!
      radio.addEventListener('change', () => {
        if (radio.checked) this.store.set('theme', t as Theme)
      })
    }
    const bind = (id: string, key: 'textLarge' | 'captions' | 'lowStim') => {
      const input = this.dialog.querySelector<HTMLInputElement>(`#${id}`)!
      input.addEventListener('change', () => {
        this.store.set(key, input.checked)
        // 옵션 패널의 전역 반영과 같은 것 — 큰 글씨는 즉시 보여야 판단할 수 있다
        document.documentElement.classList.toggle('text-large', this.store.options.textLarge)
        document.documentElement.classList.toggle('low-stim', this.store.options.lowStim)
      })
    }
    bind('welcome-textlarge', 'textLarge')
    bind('welcome-captions', 'captions')
    bind('welcome-lowstim', 'lowStim')

    this.dialog.querySelector('#welcome-start')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  /**
   * first: 첫 방문 인사인지, 새 모험을 시작하는 길인지 — 문구만 다르고 몸은 같다.
   * 새 모험마다 다시 묻는 이유: 같은 기기를 여러 사람이 쓰는 자리(시연·교실)에서
   * 다음 사람이 이전 사람의 화면을 물려받지 않게 하기 위해서다.
   */
  open(first = true, onDone?: () => void): void {
    this.closed = false
    this.onDone = onDone ?? null
    const o = this.store.options
    this.dialog.querySelector<HTMLInputElement>(`#welcome-theme-${o.theme}`)!.checked = true
    this.dialog.querySelector<HTMLInputElement>('#welcome-textlarge')!.checked = o.textLarge
    this.dialog.querySelector<HTMLInputElement>('#welcome-captions')!.checked = o.captions
    this.dialog.querySelector<HTMLInputElement>('#welcome-lowstim')!.checked = o.lowStim
    this.dialog.showModal()
    this.hooks.announce(
      first
        ? '처음 오셨다. 화면과 소리를 몸에 맞게 바꿀 수 있다 — 전부 나중에 옵션에서도 된다.'
        : '새 모험을 시작하기 전에 화면과 소리를 확인하자 — 전부 나중에 옵션에서도 바꿀 수 있다.',
    )
  }

  close(): void {
    if (this.dialog.open) this.dialog.close()
    this.afterClose()
  }

  private afterClose(): void {
    if (this.closed) return
    this.closed = true
    this.hooks.onClose?.()
    const done = this.onDone
    this.onDone = null
    done?.()
  }
}
