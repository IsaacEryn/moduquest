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

      <details open>
        <summary>조작</summary>
      <ul>
        <li>이동: 화살표 키 또는 W·A·S·D, 화면의 방향 버튼,
          그리고 지도 위에서 가고 싶은 쪽으로 손가락 쓸기</li>
        <li>둘러보기: R 키 — 지금 위치와 주변을 말해 준다. 전투 중에는 전황 요약</li>
        <li>옵션: ESC 키 — 열려 있는 동안 게임은 멈춘다</li>
        <li>메뉴 이동: Tab 키와 Enter. 대상 선택은 ESC로 취소</li>
      </ul>

      </details>
      <details>
        <summary>이 게임에는 무작위가 없다</summary>
      <p>주사위 대신 셀 수 있는 규칙을 쓴다. 같은 상황에서는 언제나 같은 일이 일어난다.</p>
      <ul>
        <li>피해 = 공격력 × 기술 배율 − 상대 방어력. 아무리 낮아도 1은 들어간다.
          관통이 붙은 기술은 방어력을 그만큼 무시한다</li>
        <li>흘리기: 특성에 따라 정해진 N번째 피격은 피해가 0이다. 확률 회피가 아니라
          세는 규칙이라, 언제 흘릴지 미리 알 수 있다</li>
        <li>마력: 기술마다 정해진 마력을 쓴다. 전투를 시작하면 가득 차고, 라운드가
          끝날 때마다 직업별로 정해진 양이 돌아온다. 몇 라운드 뒤에 무엇을 쓸 수 있는지
          셀 수 있다</li>
        <li>서는 줄: 직업마다 서는 자리가 정해져 있다. 전사 · 도적 · 궁수 · 마법사 · 힐러
          순으로 앞에 서고, <strong>앞줄이 쓰러지면 다음 사람이 앞에 선다</strong>.
          파티에 전사가 있으면 도발을 쓰지 않아도 전사가 앞이다</li>
        <li>적이 노리는 사람: 하급 몹은 앞줄에 선 사람을 친다. 중급은 체력이 가장 많이
          닳은 사람을, 상급과 보스는 방어가 가장 얇은 사람을 노린다.
          <strong>전사의 도발은 이 모든 규칙을 덮어쓴다</strong> — 도발이 걸린 동안에는
          누구를 노리던 적이든 전사에게 간다</li>
        <li>아이템: 같은 몹을 잡을 때마다 정해진 순서로 나온다 — 슬라임은 세 번째마다
          작은 물약. 보물상자의 내용도 고정이다</li>
        <li>보스 보상: 처음 잡으면 정해진 것을 반드시 준다. 다시 잡으면 순환 목록을
          타는데, 그 목록에는 좋은 장비 칸이 더 많다 — 확률이 아니라 칸의 수다</li>
        <li>물약: 체력 물약은 어디서나, 마력 물약과 스태미나 물약(기술 대기 즉시 감소)은
          전투에서만 쓴다. 효과가 하나도 들지 않으면 아이템도 턴도 쓰이지 않는다</li>
        <li>값: 마을의 가격과 분해 산출, 강화 비용도 전부 고정이다. 아래 마을 항목에
          그대로 적어 두었다</li>
        <li>경험치: 몹마다 정해진 값. 레벨은 파티가 함께 오르고 최고 8레벨까지 간다.
          3레벨이 되면 직업마다 두 번째 기술이 열리고, 4·6레벨에 더 좋은 장비를
          입을 수 있다. 다 싸우며 걸으면 마지막 싸움에서 최고 레벨에 닿는다</li>
      </ul>

      </details>
      <details>
        <summary>길</summary>
      <ul>
        <li>스테이지는 여러 구역으로 나뉜다. 문을 밟으면 다음 구역으로 건너가고,
          어디로 왔는지 소리로 알려 준다</li>
        <li>둘러보기(R)는 문이 어디에 있는지 언제나 알려 준다. 어두운 굴에서도 마찬가지다 —
          어느 길이 있는지조차 모르면 고르는 것이 아니라 헤매는 것이 된다</li>
        <li>울림 탑에는 갈림길이 있다. <strong>좁은 틈</strong>은 종지기에게 곧장 가고,
          <strong>넓은 길</strong>은 돌아가지만 보물이 있다. 어느 쪽으로 가도 이길 수 있다</li>
        <li><strong>지나온 길</strong>이 바닥에 점으로 남고, 둘러보기는 아직 가 보지 않은
          쪽을 알려 준다. 어디를 이미 지났는지 외우는 것은 재미가 아니라 부담이라
          기본으로 켜 두었다. 옵션에서 끌 수 있다</li>
        <li>지도 모양은 저장 자리마다, 다시 시작할 때마다 달라진다.
          <strong>무작위가 아니라 순서다</strong> — 같은 기록을 불러오면 언제나 같은 지도다</li>
      </ul>

      </details>
      <details>
        <summary>장비</summary>
      <ul>
        <li>무기·갑옷·신발·장갑 네 자리에 입는다. 상태창에서 입고 벗고, 능력치의
          출처("기본 + 장비 + 동료")를 그대로 보여준다</li>
        <li>직업마다 <strong>전용 무기</strong>가 있다. 궁수는 활, 도적은 단검,
          전사는 곤봉과 도끼, 마법사와 힐러는 지팡이 — 공용 검보다 그 직업에게 세지만
          대신 성격이 뚜렷하다. 도끼는 무거워 속도가 깎이고, 지팡이와 로브는 몸을
          막기보다 마력을 키운다. 검·갑옷·신발처럼 모두가 쓰는 장비도 그대로 있다</li>
        <li>1등급 전용 장비는 마을 상점에 있고, 2등급은 보물상자와 보스가 준다.
          누구 것인지는 입으려 할 때 "궁수 전용이다"처럼 그대로 알려 준다</li>
        <li>등급이 높은 장비에는 최소 레벨이 있다 — 정련은 3레벨, 울림은 4레벨부터</li>
        <li>세트는 넷이다. 공용 <strong>울림 세트</strong> 말고도 직업군마다 제 세트가
          있다 — 마법사·힐러의 <strong>술사의 울림</strong>(마력), 궁수·도적의
          <strong>사냥꾼의 울림</strong>(공격·속도), 전사의 <strong>수호의 울림</strong>(체력·방어).
          같은 세트 2점을 입으면 보너스가 붙으므로, 제 옷을 입으려고 세트를 버릴 일이 없다</li>
        <li>깃발·등불 같은 장비는 든 사람이 아니라 <strong>곁의 동료</strong>를
          강하게 한다 — 함께 걷는 것이 수치가 되는 장비다</li>
      </ul>

      </details>
      <details>
        <summary>마을</summary>
      <p>쉼터에 서 있을 때와 스테이지를 마친 뒤에 들를 수 있다. 값에도 확률이 없다 —
        아래 수가 곧 게임 안의 수다.</p>
      <ul>
        <li><strong>동전</strong>은 싸워서 번다. 이기면 그 싸움의 경험치와 같은 수가 들어온다</li>
        <li>상점에서는 물약 넷과 1등급 장비 넷을 판다. 정련·울림 장비는 팔지 않는다 —
          좋은 장비는 싸워서 얻는 것이다</li>
        <li>되파는 값은 물약 4냥, 장비는 등급에 따라 일반 6냥·정련 15냥·울림 30냥</li>
        <li><strong>분해</strong>하면 동전 대신 강화 재료가 나온다. 일반 1개, 정련 2개,
          울림 4개. 남는 장비를 팔지 분해할지가 곧 선택이다</li>
        <li><strong>성장 강화</strong>는 한 사람의 능력치를 영구히 올린다. 1단계 30냥과
          재료 2개, 2단계 60냥과 재료 4개, 3단계 100냥과 재료 7개. 한 능력치당 3단계까지다.
          체력은 단계마다 5, 공격·방어·속도는 1씩 오른다</li>
        <li>종의 조각처럼 다시 구할 수 없는 물건과, 곁의 동료를 강하게 하는 깃발·등불은
          팔지도 분해하지도 못한다</li>
      </ul>

      </details>
      <details>
        <summary>특성과 저장</summary>
      <ul>
        <li>특성은 이득과 대가가 한 묶음이다. 준비하는 자리(타이틀·쉼터)에서만 바꿀 수 있다</li>
        <li>저장은 필드에서 자동으로 된다. 저장 버튼은 없다. 마을에서 사고팔거나 강화한
          것도 그 자리에서 기록된다</li>
      </ul>

      </details>
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
