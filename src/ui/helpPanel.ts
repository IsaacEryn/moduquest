/**
 * 도움말 — 조작법과 게임의 결정적 규칙.
 * 이 게임에는 무작위가 없다. 규칙을 숨기면 정보 격차지만 밝히면 전략이 된다 —
 * 그래서 도움말이 곧 게임 디자인 문서다.
 */
export class HelpPanel {
  private dialog: HTMLDialogElement
  private prevFocus: Element | null = null
  private closed = true

  constructor(private hooks: { onOpen?: () => void; onClose?: () => void }) {
    this.dialog = document.createElement('dialog')
    this.dialog.className = 'options help'
    this.dialog.setAttribute('aria-labelledby', 'help-title')
    this.dialog.innerHTML = `
      <h2 id="help-title">도움말</h2>

      <h3>조작</h3>
      <ul>
        <li>이동: 화살표 키 또는 W·A·S·D, 화면의 방향 버튼</li>
        <li>둘러보기: R 키 — 지금 위치와 주변을 말해 준다. 전투 중에는 전황 요약</li>
        <li>옵션: ESC 키 — 열려 있는 동안 게임은 멈춘다</li>
        <li>메뉴 이동: Tab 키와 Enter. 대상 선택은 ESC로 취소</li>
      </ul>

      <h3>이 게임에는 무작위가 없다</h3>
      <p>주사위 대신 셀 수 있는 규칙을 쓴다. 같은 상황에서는 언제나 같은 일이 일어난다.</p>
      <ul>
        <li>피해 = 공격력 × 기술 배율 − 상대 방어력. 아무리 낮아도 1은 들어간다.
          관통이 붙은 기술은 방어력을 그만큼 무시한다</li>
        <li>흘리기: 특성에 따라 정해진 N번째 피격은 피해가 0이다. 확률 회피가 아니라
          세는 규칙이라, 언제 흘릴지 미리 알 수 있다</li>
        <li>마력: 기술마다 정해진 마력을 쓴다. 전투를 시작하면 가득 차고, 라운드가
          끝날 때마다 직업별로 정해진 양이 돌아온다. 몇 라운드 뒤에 무엇을 쓸 수 있는지
          셀 수 있다</li>
        <li>적이 노리는 사람: 하급 몹은 앞에 선 사람을 친다. 중급은 체력이 가장 많이
          닳은 사람을, 상급과 보스는 방어가 가장 얇은 사람을 노린다.
          <strong>전사의 도발은 이 모든 규칙을 덮어쓴다</strong> — 도발이 걸린 동안에는
          누구를 노리던 적이든 전사에게 간다</li>
        <li>아이템: 같은 몹을 잡을 때마다 정해진 순서로 나온다 — 슬라임은 세 번째마다
          작은 물약. 보스는 정해진 것을 반드시 준다. 보물상자의 내용도 고정이다</li>
        <li>경험치: 몹마다 정해진 값. 레벨은 파티가 함께 오르고, 3레벨이 되면
          직업마다 두 번째 기술이 열린다</li>
      </ul>

      <h3>특성과 저장</h3>
      <ul>
        <li>특성은 이득과 대가가 한 묶음이다. 준비하는 자리(타이틀·쉼터)에서만 바꿀 수 있다</li>
        <li>저장은 필드에서 자동으로 된다. 저장 버튼은 없다</li>
      </ul>

      <div class="slot-actions">
        <button type="button" id="help-close">닫기</button>
      </div>
    `
    document.body.append(this.dialog)
    this.dialog.querySelector('#help-close')!.addEventListener('click', () => this.close())
    this.dialog.addEventListener('close', () => this.afterClose())
  }

  get isOpen(): boolean {
    return this.dialog.open
  }

  open(): void {
    this.closed = false
    this.hooks.onOpen?.()
    this.prevFocus = document.activeElement
    this.dialog.showModal()
    this.dialog.querySelector<HTMLElement>('#help-close')?.focus()
  }

  close(): void {
    if (this.dialog.open) this.dialog.close()
    this.afterClose()
  }

  private afterClose(): void {
    if (this.closed) return
    this.closed = true
    if (this.prevFocus instanceof HTMLElement && this.prevFocus.isConnected) {
      this.prevFocus.focus()
    }
    this.hooks.onClose?.()
  }
}
