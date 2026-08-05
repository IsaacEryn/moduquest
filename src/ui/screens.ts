import type { EventBus, GameMode } from '../core/events'
import type { Game } from '../core/game'
import { SPRITES, drawSprite } from '../render/sprites'
import { josa } from './announcer'
import type { BattleUI } from './battleUI'

/** #ui 영역의 화면 전환: 타이틀·대화·필드·전투·클리어 */
export class Screens {
  private ui = document.querySelector<HTMLDivElement>('#ui')!
  private dialogueLine: HTMLParagraphElement | null = null
  private dialoguePortrait: HTMLDivElement | null = null

  /** 타이틀에 "이어서 하기"를 보일지 — 저장된 기록이 있을 때만 */
  hasSaves = false
  /** 필드 화면이 살아 있는 동안 구역 변경을 반영하는 갱신자 */
  private onAreaChanged: (() => void) | null = null
  /** 마을 버튼을 지금 자리에 맞게 여닫는 갱신자 */
  private onTownAvailability: (() => void) | null = null

  constructor(
    private game: Game,
    bus: EventBus,
    private battleUI: BattleUI,
    private openOptions: () => void,
    private openTraits: () => void,
    private openSlots: (mode: 'new' | 'continue') => void,
    private openStages: () => void,
    private openBag: () => void,
    private openHelp: () => void,
    private openStatus: () => void,
    private openTown: () => void,
    private hud: { el: HTMLElement; refresh: () => void },
    private getLowStim: () => boolean,
  ) {
    bus.on((e) => {
      // 저자극을 켜고 끄면 타이틀 스프라이트의 색이 함께 바뀌어야 한다
      if (e.type === 'optionsChanged' && this.game.mode === 'title') this.render('title')
      if (e.type === 'areaChanged') this.onAreaChanged?.()
      // 쉼터에 서야 마을에 들를 수 있다 — 걸을 때마다 버튼이 규칙을 그대로 보인다
      if (e.type === 'moved' || e.type === 'checkpoint' || e.type === 'areaChanged') {
        this.onTownAvailability?.()
      }
      if (e.type === 'mode') this.render(e.mode)
      if (e.type === 'dialogue' && this.dialogueLine) {
        this.dialogueLine.innerHTML = ''
        const speaker = document.createElement('span')
        speaker.className = 'speaker'
        speaker.textContent = e.line.speaker
        this.dialogueLine.append(speaker, e.line.text)
        this.updatePortrait(e.line.speaker)
      }
    })
  }

  showTitle(): void {
    this.render('title')
  }

  private clear(): void {
    this.battleUI.unmount()
    this.onAreaChanged = null
    this.dialogueLine = null
    this.dialoguePortrait = null
    this.ui.replaceChildren()
  }

  private render(mode: GameMode): void {
    this.clear()
    this.onTownAvailability = null
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
      <div class="title-art" aria-hidden="true"></div>
      <h2>모두의 원정대</h2>
      <p>서로 다른 방식으로 감각하는 동료들이 한 파티로 떠나는 모험</p>
      <div class="actions"></div>
    `
    // 키비주얼 — 게임 안 스프라이트가 곧 얼굴이다. 다섯 직업이 나란히 선다
    const art = s.querySelector('.title-art')!
    const lowStim = this.getLowStim()
    for (const key of ['warrior', 'rogue', 'archer', 'mage', 'healer']) {
      const def = SPRITES[key]
      if (def) art.append(drawSprite(def, 4, lowStim))
    }
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
    const help = document.createElement('button')
    help.type = 'button'
    help.textContent = '도움말'
    help.addEventListener('click', () => this.openHelp())
    const opts = document.createElement('button')
    opts.type = 'button'
    opts.textContent = '옵션'
    opts.addEventListener('click', () => this.openOptions())
    if (this.hasSaves) actions.append(start, cont, traits, help, opts)
    else actions.append(start, traits, help, opts)
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
    // 말하는 사람의 얼굴 — 이름은 글이 이미 말하므로 그림은 장식이다
    const wrap = document.createElement('div')
    wrap.className = 'line-wrap'
    const portrait = document.createElement('div')
    portrait.className = 'portrait'
    portrait.setAttribute('aria-hidden', 'true')
    const line = document.createElement('p')
    line.className = 'line'
    wrap.append(portrait, line)
    const next = document.createElement('button')
    next.type = 'button'
    next.textContent = '다음'
    next.addEventListener('click', () => this.game.advanceDialogue())
    s.append(wrap, next)
    this.ui.append(s)
    this.dialogueLine = line
    this.dialoguePortrait = portrait
    next.focus()
  }

  /** 화자 이름 → 스프라이트. 파티원은 이름이 곧 직업명이고, 그 밖은 여기 적는다 */
  private spriteOfSpeaker(speaker: string): string | null {
    const member = this.game.party.find((c) => c.name === speaker)
    if (member) return member.sprite ?? member.id
    return { 종지기: 'keeper' }[speaker] ?? null
  }

  private updatePortrait(speaker: string): void {
    const box = this.dialoguePortrait
    if (!box) return
    const key = this.spriteOfSpeaker(speaker)
    if (box.dataset.speaker === key) return
    box.replaceChildren()
    box.dataset.speaker = key ?? ''
    const def = key ? SPRITES[key] : undefined
    if (def) box.append(drawSprite(def, 4, this.getLowStim()))
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
    // 스테이지 번호·레벨·지갑은 HUD 칩이 상시로 보여준다 — 문장에는 목표만 남긴다
    s.prepend(this.hud.el)
    this.hud.refresh()

    const objective = s.querySelector('.objective')!
    const describe = () => {
      const title = this.game.stage.title
      const where = this.game.field.where
      // 구역이 하나뿐인 스테이지는 제목과 구역명이 같다 — 같은 말을 두 번 하지 않는다
      const place = where.includes(title) ? where : `${title} — ${where}`
      return `${place}. 목표: ${this.game.stage.objective}`
    }
    objective.textContent = describe()
    // 구역을 넘으면 여기 적힌 곳도 따라 바뀌어야 한다
    this.onAreaChanged = () => {
      if (objective.isConnected) objective.textContent = describe()
    }

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

    const townBtn = document.createElement('button')
    townBtn.type = 'button'
    townBtn.addEventListener('click', () => this.openTown())
    // 못 들르는 이유를 버튼이 직접 말한다 — 눌러 봐야 아는 규칙은 규칙이 아니다
    const refreshTown = () => {
      const can = this.game.canVisitTown()
      townBtn.textContent = can.ok ? '마을' : `마을 (${can.reason})`
      townBtn.disabled = !can.ok
    }
    refreshTown()
    this.onTownAvailability = () => {
      if (townBtn.isConnected) refreshTown()
    }

    const statusBtn = document.createElement('button')
    statusBtn.type = 'button'
    statusBtn.textContent = '상태'
    statusBtn.addEventListener('click', () => this.openStatus())
    const bagBtn = document.createElement('button')
    bagBtn.type = 'button'
    bagBtn.textContent = '가방'
    bagBtn.addEventListener('click', () => this.openBag())
    const stageBtn = document.createElement('button')
    stageBtn.type = 'button'
    stageBtn.textContent = '스테이지'
    stageBtn.addEventListener('click', () => this.openStages())
    const traitBtn = document.createElement('button')
    traitBtn.type = 'button'
    traitBtn.textContent = '특성'
    traitBtn.addEventListener('click', () => this.openTraits())
    const helpBtn = document.createElement('button')
    helpBtn.type = 'button'
    helpBtn.textContent = '도움말'
    helpBtn.addEventListener('click', () => this.openHelp())
    const optBtn = document.createElement('button')
    optBtn.type = 'button'
    optBtn.textContent = '옵션'
    optBtn.addEventListener('click', () => this.openOptions())
    s.querySelector('.secondary')!.append(
      statusBtn,
      bagBtn,
      townBtn,
      stageBtn,
      traitBtn,
      helpBtn,
      optBtn,
    )
    this.ui.append(s)
    s.focus()
  }

  private renderClear(): void {
    const ending = !this.game.hasNextStage
    const s = document.createElement('section')
    s.className = 'panel title-screen'
    s.innerHTML = `
      <h2></h2>
      <p class="clear-message"></p>
      <div class="actions"></div>
    `
    s.querySelector('h2')!.textContent = ending ? '모험을 마쳤다' : '스테이지 클리어!'
    s.querySelector('.clear-message')!.textContent = this.game.stage.clearMessage
    const actions = s.querySelector('.actions')!

    if (ending) {
      // 엔딩 — 함께 걸어온 길의 요약. 문장은 전부 데이터에서 조립한다
      const summary = document.createElement('p')
      const names = this.game.party.map((c) => (c.isPlayer ? `${c.name}(나)` : c.name))
      summary.textContent =
        `${names.join(', ')} — 세 곳을 함께 걸어 파티는 ${this.game.partyLevel}레벨이 되었다.`
      const keepsakes = this.game.inventoryList.filter((i) => i.kind === 'keepsake')
      const lines = [summary]
      for (const k of keepsakes) {
        const p = document.createElement('p')
        p.textContent = `가방에는 ${josa(k.name, '이', '가')} 남았다. ${k.description}`
        lines.push(p)
      }
      const outro = document.createElement('p')
      outro.textContent = '서로 다르게 감각해도, 같은 세계를 함께 끝까지 갈 수 있다.'
      lines.push(outro)
      // 한 문장씩 떠오른다 — 저자극 모드에서는 킬스위치가 꺼서 전부 즉시 보인다
      lines.forEach((p, i) => {
        p.classList.add('reveal')
        p.style.setProperty('--i', String(i))
      })
      s.querySelector('.clear-message')!.after(...lines)
    }

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
    // 다음 스테이지로 떠나기 전이 장비를 정리하고 강화할 자리다
    mk('마을에 들르기', () => this.openTown())
    mk('타이틀로', () => this.game.returnToTitle())

    this.ui.append(s)
    first.focus()
  }
}
