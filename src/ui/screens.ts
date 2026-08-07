import type { EventBus, GameMode } from '../core/events'
import type { Game } from '../core/game'
import { SPRITES, drawSprite, type SpriteMode } from '../render/sprites'
import { josa } from './announcer'
import type { BattleUI } from './battleUI'
import { memberLabel } from './memberLabel'

/** #ui 영역의 화면 전환: 타이틀·대화·필드·전투·클리어 */
export class Screens {
  private ui = document.querySelector<HTMLDivElement>('#ui')!
  private dialogueLine: HTMLParagraphElement | null = null
  /** 대사 넘김 버튼 — 마지막 줄에서는 무엇이 기다리는지 이름을 바꿔 말한다 */
  private dialogueNext: HTMLButtonElement | null = null
  private dialoguePortrait: HTMLDivElement | null = null

  /** 필드 화면이 살아 있는 동안 구역 변경을 반영하는 갱신자 */
  private onAreaChanged: (() => void) | null = null
  /** 마을 버튼을 지금 자리에 맞게 여닫는 갱신자 */
  private onTownAvailability: (() => void) | null = null
  /** 길잡이 줄 갱신자 — 자리·토큰이 바뀔 때만 산다 */
  private onSeatsChanged: (() => void) | null = null

  constructor(
    private game: Game,
    bus: EventBus,
    private battleUI: BattleUI,
    private openOptions: () => void,
    private openTraits: () => void,
    private openSingle: () => void,
    private openStages: () => void,
    private openBag: () => void,
    private openHelp: () => void,
    private openStatus: () => void,
    private openTown: () => void,
    private hud: { el: HTMLElement; refresh: () => void },
    private getSpriteMode: () => SpriteMode,
    private openCoop: () => void,
  ) {
    bus.on((e) => {
      // 저자극을 켜고 끄면 타이틀 스프라이트의 색이 함께 바뀌어야 한다
      if (e.type === 'optionsChanged' && this.game.mode === 'title') this.render('title')
      if (e.type === 'areaChanged') this.onAreaChanged?.()
      // 쉼터에 서야 마을에 들를 수 있다 — 걸을 때마다 버튼이 규칙을 그대로 보인다
      if (e.type === 'moved' || e.type === 'checkpoint' || e.type === 'areaChanged') {
        this.onTownAvailability?.()
      }
      if (e.type === 'seatControlChanged' || e.type === 'moveTokenChanged') {
        this.onSeatsChanged?.()
      }
      if (e.type === 'mode') this.render(e.mode)
      if (e.type === 'dialogue' && this.dialogueLine) {
        this.dialogueLine.innerHTML = ''
        const speaker = document.createElement('span')
        speaker.className = 'speaker'
        speaker.textContent = e.line.speaker
        this.dialogueLine.append(speaker, e.line.text)
        // 마지막 줄인지는 이벤트가 이미 알고 있다. 끝까지 "다음"이라고만 하면
        // 다음 줄이 있는 줄 알고 눌렀다가 화면이 통째로 바뀐다 — 예측 가능성의 문제다
        if (this.dialogueNext) this.dialogueNext.textContent = e.last ? '계속하기' : '다음'
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
    this.onSeatsChanged = null
    this.dialogueLine = null
    this.dialogueNext = null
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

  /**
   * 타이틀 — 게임에 들어가는 문은 둘이고, 그 둘만 크게 선다.
   *
   * 예전에는 버튼 여섯이 같은 무게로 한 줄에 늘어서 있었다. 앞의 둘(새로 시작·이어서
   * 하기)이 한 묶음이고 셋째(함께 하기)가 다른 모드라는 사실을 화면이 말해 주지 않았고,
   * "혼자 하기"라는 이름 자체가 없어서 그 반대편만 이름을 가진 꼴이었다.
   *
   * 설명은 버튼 **안**에 둔다. 밖에 두면 읽기 순서상 버튼 뒤에 도착해서, 무엇을
   * 고르는지 모른 채 먼저 버튼을 만난다. 안에 두면 그 자체가 버튼의 이름이 된다.
   */
  private renderTitle(): void {
    const s = document.createElement('section')
    s.className = 'panel title-screen'
    s.innerHTML = `
      <div class="title-art" aria-hidden="true"></div>
      <h2>모두의 원정대</h2>
      <p>서로 다른 방식으로 감각하는 동료들이 한 파티로 떠나는 모험</p>
      <div class="title-doors"></div>
      <div class="actions"></div>
    `
    // 키비주얼 — 게임 안 스프라이트가 곧 얼굴이다. 다섯 직업이 나란히 선다
    const art = s.querySelector('.title-art')!
    const mode = this.getSpriteMode()
    for (const key of ['warrior', 'rogue', 'archer', 'mage', 'healer']) {
      const def = SPRITES[key]
      if (def) art.append(drawSprite(def, 4, mode))
    }

    const doors = s.querySelector('.title-doors')!
    const door = (name: string, desc: string, onClick: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'door'
      const t = document.createElement('span')
      t.className = 'door-name'
      t.textContent = name
      const d = document.createElement('span')
      d.className = 'door-desc'
      d.textContent = desc
      b.append(t, d)
      b.addEventListener('click', onClick)
      doors.append(b)
      return b
    }
    const single = door(
      '싱글 플레이',
      '가입 없이 바로 시작한다. 기록은 이 기기에만 남는다.',
      () => this.openSingle(),
    )
    door(
      '멀티 플레이',
      '로그인하면 기록이 계정에 남아 다른 기기에서도 이어서 할 수 있다. 친구와 함께도, 혼자서도.',
      () => this.openCoop(),
    )

    // 게임에 들어가는 일이 아닌 것들은 아래 한 줄로 — 문과 같은 무게로 서지 않는다
    const actions = s.querySelector('.actions')!
    const minor = (label: string, onClick: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'alt-action'
      b.textContent = label
      b.addEventListener('click', onClick)
      actions.append(b)
    }
    minor('특성 고르기', () => this.openTraits())
    minor('도움말', () => this.openHelp())
    minor('옵션', () => this.openOptions())

    this.ui.append(s)
    single.focus()
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
    this.dialogueNext = next
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
    if (def) box.append(drawSprite(def, 4, this.getSpriteMode()))
  }

  private renderField(): void {
    // 패널 자체가 조작 영역이다 — 빈 상자에 포커스 링이 그려지지 않도록,
    // 목표 문구와 방향 버튼이 있는 이 섹션이 포커스를 받는다
    const s = document.createElement('section')
    s.className = 'panel'
    s.id = 'field-region'
    s.tabIndex = 0
    // role=application은 값을 치르고 얻는 것이다. 브라우즈 모드가 방향키를 가로채면
    // 이동이 아예 막히므로 붙였지만, 대신 이 영역 안에서 헤딩 이동·요소 목록 같은
    // 표준 탐색이 함께 막힌다(마을·상태·가방 버튼까지). 지금은 이동을 지키는 쪽을
    // 골랐고, 좁힐 수 있는지는 NVDA·센스리더 실기 확인이 끝나야 판단할 수 있다 —
    // 코드만 보고 떼면 방향키를 잃는 사용자가 생긴다.
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

    // 길잡이 — 함께 하기에서만 나타난다. 파티는 한 몸으로 움직이므로
    // 이동과 대화 넘김은 길잡이 한 사람의 몫이고, 여기서 넘겨준다
    const tokenBox = document.createElement('p')
    tokenBox.className = 'token-line'
    const refreshToken = () => {
      const humanSeats = [0, 1, 2].filter((n) => this.game.seatControllerOf(n) === 'human')
      if (humanSeats.length <= 1) {
        tokenBox.hidden = true
        tokenBox.replaceChildren()
        return
      }
      tokenBox.hidden = false
      tokenBox.replaceChildren()
      const holder = this.game.party[this.game.moveTokenSeat]
      const mineToken = this.game.moveTokenSeat === this.game.localSeat
      const label = document.createElement('span')
      label.textContent = mineToken
        ? '길잡이: 나 — 넘겨주기: '
        : `길잡이: ${holder?.name ?? ''} `
      tokenBox.append(label)
      // 넘길 수 있는 사람: 지금 쥔 사람과 방장(0번 자리)
      const canPass = mineToken || this.game.localSeat === 0
      if (!canPass) return
      for (const n of humanSeats) {
        if (n === this.game.moveTokenSeat) continue
        const b = document.createElement('button')
        b.type = 'button'
        const name = this.game.party[n]?.name ?? `${n + 1}번`
        b.textContent = n === this.game.localSeat ? `${name} (나)` : name
        b.addEventListener('click', () => this.game.passMoveToken(n))
        tokenBox.append(b)
      }
    }
    refreshToken()
    this.onSeatsChanged = () => {
      if (tokenBox.isConnected) refreshToken()
    }
    s.append(tokenBox)

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
      const names = this.game.party.map((c) => memberLabel(this.game, c, ''))
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
