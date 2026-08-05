const MAX_LINES = 150

/**
 * 게임에서 일어나는 모든 일을 글로 쌓는 기록 창 — 옛 통신망 텍스트 게임처럼
 * 화면 없이 글만 읽어도 게임을 따라갈 수 있다. 시각장애 여부와 무관하게
 * 누구나 쓰는 기능이라 기본으로 켜 둔다.
 */
export class TextLog {
  private el = document.querySelector<HTMLElement>('#text-log')!
  private placeholder: HTMLElement | null = null

  constructor() {
    // 빈 창이 왜 있는지 첫 화면에서 알 수 있게. 낭독 채널에는 넣지 않는다
    this.placeholder = document.createElement('p')
    this.placeholder.textContent = '여기에 이야기가 기록된다.'
    this.el.append(this.placeholder)
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
    this.el.scrollTop = this.el.scrollHeight
  }

  setVisible(visible: boolean): void {
    this.el.hidden = !visible
  }
}
