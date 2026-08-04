import type { EventBus, GameMode } from '../core/events'
import type { Game } from '../core/game'
import type { BattleUI } from './battleUI'

/** #ui 영역의 화면 전환: 타이틀·대화·필드·전투·클리어 */
export class Screens {
  private ui = document.querySelector<HTMLDivElement>('#ui')!
  private dialogueLine: HTMLParagraphElement | null = null

  constructor(
    private game: Game,
    bus: EventBus,
    private battleUI: BattleUI,
    private openOptions: () => void,
  ) {
    bus.on((e) => {
      if (e.type === 'mode') this.render(e.mode)
      if (e.type === 'dialogue' && this.dialogueLine) {
        this.dialogueLine.innerHTML = ''
        const speaker = document.createElement('span')
        speaker.className = 'speaker'
        speaker.textContent = e.line.speaker
        this.dialogueLine.append(speaker, e.line.text)
      }
    })
  }

  showTitle(): void {
    this.render('title')
  }

  private clear(): void {
    this.battleUI.unmount()
    this.dialogueLine = null
    this.ui.replaceChildren()
  }

  private render(mode: GameMode): void {
    this.clear()
    switch (mode) {
      case 'title':
        this.renderTitle()
        break
      case 'dialogue':
        this.renderDialogue()
        break
      case 'field':
        this.renderField()
        break
      case 'battle':
        this.battleUI.mount(this.ui)
        break
      case 'clear':
        this.renderClear()
        break
    }
  }

  private renderTitle(): void {
    const s = document.createElement('section')
    s.className = 'panel title-screen'
    s.innerHTML = `
      <h2>모두의 원정대</h2>
      <p>서로 다른 방식으로 감각하는 동료들이 한 파티로 떠나는 모험</p>
      <div class="actions"></div>
    `
    const actions = s.querySelector('.actions')!
    const start = document.createElement('button')
    start.type = 'button'
    start.textContent = '모험 시작'
    start.addEventListener('click', () => this.game.start())
    const opts = document.createElement('button')
    opts.type = 'button'
    opts.textContent = '옵션'
    opts.addEventListener('click', () => this.openOptions())
    actions.append(start, opts)
    this.ui.append(s)
    start.focus()
  }

  private renderDialogue(): void {
    const s = document.createElement('section')
    s.className = 'panel dialogue'
    s.setAttribute('aria-label', '대화')
    const line = document.createElement('p')
    line.className = 'line'
    const next = document.createElement('button')
    next.type = 'button'
    next.textContent = '다음'
    next.addEventListener('click', () => this.game.advanceDialogue())
    s.append(line, next)
    this.ui.append(s)
    this.dialogueLine = line
    next.focus()
  }

  private renderField(): void {
    const s = document.createElement('section')
    s.className = 'panel'
    s.id = 'field-region'
    s.tabIndex = 0
    s.setAttribute('role', 'application')
    s.setAttribute(
      'aria-label',
      '게임 필드. 화살표 키로 이동, R 키로 주변 확인, ESC 키로 옵션.',
    )
    const p = document.createElement('p')
    p.textContent = `목표: ${this.game.stage.objective} — 이동: 화살표 키 · 주변 확인: R`
    s.append(p)
    this.ui.append(s)
    s.focus()
  }

  private renderClear(): void {
    const s = document.createElement('section')
    s.className = 'panel title-screen'
    s.innerHTML = `
      <h2>스테이지 클리어!</h2>
      <p></p>
      <div class="actions"></div>
    `
    s.querySelector('p')!.textContent = this.game.stage.clearMessage
    const again = document.createElement('button')
    again.type = 'button'
    again.textContent = '처음부터 다시'
    again.addEventListener('click', () => window.location.reload())
    s.querySelector('.actions')!.append(again)
    this.ui.append(s)
    again.focus()
  }
}
