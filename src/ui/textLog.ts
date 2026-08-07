const MAX_LINES = 150
/** 이만큼 안이면 "바닥을 보고 있다"고 본다 */
const BOTTOM_SLACK = 24

/**
 * 게임에서 일어나는 모든 일을 글로 쌓는 기록 창 — 옛 통신망 텍스트 게임처럼
 * 화면 없이 글만 읽어도 게임을 따라갈 수 있다. 시각장애 여부와 무관하게
 * 누구나 쓰는 기능이라 기본으로 켜 둔다.
 *
 * 스크롤에는 규칙이 하나 있다: **바닥을 보고 있던 사람은 계속 바닥에 둔다.**
 * 위로 올려 읽는 중이면 건드리지 않는다. 이 창만 보고 게임을 따라가는 사람에게
 * 스크롤이 바닥에서 떨어지는 것은 게임이 멈춘 것과 같기 때문이다.
 *
 * 새 줄이 쌓일 때뿐 아니라 **창 크기가 바뀔 때도** 지켜야 한다. 모드가 바뀌면
 * 이 창의 높이가 통째로 달라지는데(필드에서는 지도 높이를 따르고 클리어 화면에서는
 * 접힌다), 그러면 남아 있던 scrollTop이 더는 바닥이 아니게 된다. 실제로 스테이지를
 * 마치고 다음 스테이지로 넘어가면 그 뒤로 기록이 따라 내려가지 않았다.
 */
export class TextLog {
  private el = document.querySelector<HTMLElement>('#text-log')!
  private placeholder: HTMLElement | null = null
  /** 바닥에 붙어 있어야 하는가 — 사용자가 스크롤을 만질 때마다 갱신된다 */
  private stick = true

  constructor() {
    // 빈 창이 왜 있는지 첫 화면에서 알 수 있게. 낭독 채널에는 넣지 않는다
    this.placeholder = document.createElement('p')
    this.placeholder.textContent = '여기에 이야기가 기록된다.'
    this.el.append(this.placeholder)

    // 사람이 스크롤을 옮기면 그 뜻을 기억한다. 위로 올렸으면 따라다니지 않는다
    this.el.addEventListener('scroll', () => {
      this.stick = this.isAtBottom()
    })

    // 창 높이가 바뀌는 순간을 잡는다. 레이아웃이 다시 잡힌 뒤에 불리므로
    // 이 시점의 scrollHeight는 새 높이를 반영한다 — 프레임을 세는 것보다 정확하다
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => {
        if (this.stick) this.toBottom()
      }).observe(this.el)
    }
  }

  private isAtBottom(): boolean {
    return this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < BOTTOM_SLACK
  }

  private toBottom(): void {
    this.el.scrollTop = this.el.scrollHeight
  }

  add(text: string): void {
    if (this.placeholder) {
      this.placeholder.remove()
      this.placeholder = null
    }
    const p = document.createElement('p')
    p.textContent = text
    this.el.append(p)
    while (this.el.children.length > MAX_LINES) {
      this.el.firstChild?.remove()
    }
    if (this.stick) this.toBottom()
  }

  /**
   * 스크롤을 바닥으로 되돌리고, 다시 따라다니게 한다.
   * 화면이 통째로 바뀌는 순간(모드 전환)에 부른다 — 그때는 읽던 자리를 지키는 것보다
   * 지금 일어나는 일을 보여 주는 편이 맞다.
   */
  scrollToBottom(): void {
    this.stick = true
    this.toBottom()
  }

  setVisible(visible: boolean): void {
    const wasHidden = this.el.hidden
    this.el.hidden = !visible
    // 숨은 동안에는 높이가 0이라 따라 내려갈 수 없었다 — 다시 보일 때 맞춰 준다
    if (wasHidden && visible) this.scrollToBottom()
  }
}
