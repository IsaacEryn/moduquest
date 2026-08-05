import type { EventBus, GameMode } from '../core/events'
import type { Game } from '../core/game'
import type { BattleUI } from './battleUI'

/** #ui 영역의 화면 전환: 타이틀·대화·필드·전투·클리어 */
export class Screens {
  private ui = document.querySelector<HTMLDivElement>('#ui')!
  private dialogueLine: HTMLParagraphElement | null = null

  /** 타이틀에 "이어서 하기"를 보일지 — 저장된 기록이 있을 때만 */
  hasSaves = false

  constructor(
    private game: Game,
    bus: EventBus,
    private battleUI: BattleUI,
    private openOptions: () => void,
    private openTraits: () => void,
    private openSlots: (mode: 'new' | 'continue') => void,
    private openStages: () => void,
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
    start.textContent = '새로 시작'
    start.addEventListener('click', () => this.openSlots('new'))
    const cont = document.createElement('button')
    cont.type = 'button'
    cont.textContent = '이어서 하기'
    cont.addEventListener('click', () => this.openSlots('continue'))
    const traits = document.createElement('button')
    traits.type = 'button'
    traits.textContent = '특성 고르기'
    traits.addEventListener('click', () => this.openTraits())
    const opts = document.createElement('button')
    opts.type = 'button'
    opts.textContent = '옵션'
    opts.addEventListener('click', () => this.openOptions())
    if (this.hasSaves) actions.append(start, cont, traits, opts)
    else actions.append(start, traits, opts)
    this.ui.append(s)
    // 이어서 할 게 있으면 그쪽이 첫 포커스다
    ;(this.hasSaves ? cont : start).focus()
  }

  private renderDialogue(): void {
    const s = document.createElement('section')
    s.className = 'panel dialogue'
    s.setAttribute('aria-label', '대화')
    const h = document.createElement('h2')
    h.className = 'visually-hidden'
    h.textContent = '대화'
    s.append(h)
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
    // 패널 자체가 조작 영역이다 — 빈 상자에 포커스 링이 그려지지 않도록,
    // 목표 문구와 방향 버튼이 있는 이 섹션이 포커스를 받는다
    const s = document.createElement('section')
    s.className = 'panel'
    s.id = 'field-region'
    s.tabIndex = 0
    s.setAttribute('role', 'application')
    s.setAttribute(
      'aria-label',
      '게임 필드. 화살표 키로 이동, R 키로 주변 확인, ESC 키로 옵션. 아래 방향 버튼으로도 같은 조작을 할 수 있다.',
    )
    s.innerHTML = `
      <h2 class="visually-hidden">필드</h2>
      <p class="objective"></p>
      <div class="pad" role="group" aria-label="이동 조작"></div>
      <div class="secondary"></div>
    `
    s.querySelector('.objective')!.textContent =
      `스테이지 ${this.game.currentStageIndex + 1} / ${this.game.stageCount}. ` +
      `${this.game.stage.title}. 목표: ${this.game.stage.objective} ` +
      `화살표 키나 아래 버튼으로 움직인다.`

    // 화면 방향 버튼 — 키보드가 없는 환경(터치·스위치·마우스 전용)을 위한 같은 조작
    const pad = s.querySelector<HTMLElement>('.pad')!
    const padButton = (label: string, aria: string, cls: string, onPress: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = cls
      b.textContent = label
      b.setAttribute('aria-label', aria)
      b.addEventListener('click', onPress)
      pad.append(b)
    }
    padButton('↑', '북쪽으로 이동', 'up', () => this.game.moveField('north'))
    padButton('←', '서쪽으로 이동', 'left', () => this.game.moveField('west'))
    padButton('둘러보기', '주변 확인', 'look', () => this.game.fieldSummary())
    padButton('→', '동쪽으로 이동', 'right', () => this.game.moveField('east'))
    padButton('↓', '남쪽으로 이동', 'down', () => this.game.moveField('south'))

    const stageBtn = document.createElement('button')
    stageBtn.type = 'button'
    stageBtn.textContent = '스테이지'
    stageBtn.addEventListener('click', () => this.openStages())
    const traitBtn = document.createElement('button')
    traitBtn.type = 'button'
    traitBtn.textContent = '특성'
    traitBtn.addEventListener('click', () => this.openTraits())
    const optBtn = document.createElement('button')
    optBtn.type = 'button'
    optBtn.textContent = '옵션'
    optBtn.addEventListener('click', () => this.openOptions())
    s.querySelector('.secondary')!.append(stageBtn, traitBtn, optBtn)
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
    const actions = s.querySelector('.actions')!
    const mk = (label: string, onClick: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.addEventListener('click', onClick)
      actions.append(b)
      return b
    }

    let first: HTMLButtonElement
    if (this.game.hasNextStage) {
      first = mk('다음 스테이지로', () => this.game.nextStage())
      mk('이 스테이지 다시', () => this.game.restartStage())
    } else {
      first = mk('처음부터 다시', () => this.game.startStage(0))
      mk('이 스테이지 다시', () => this.game.restartStage())
    }
    mk('타이틀로', () => this.game.returnToTitle())

    this.ui.append(s)
    first.focus()
  }
}
