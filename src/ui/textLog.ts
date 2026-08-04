const MAX_LINES = 150

/**
 * 게임에서 일어나는 모든 일을 글로 쌓는 기록 창 — 옛 통신망 텍스트 게임처럼
 * 화면 없이 글만 읽어도 게임을 따라갈 수 있다. 시각장애 여부와 무관하게
 * 누구나 쓰는 기능이라 기본으로 켜 둔다.
 */
export class TextLog {
  private el = document.querySelector<HTMLElement>('#text-log')!

  add(text: string): void {
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
