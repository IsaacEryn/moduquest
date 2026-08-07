/**
 * 편의 옵션을 알려주는 한 번짜리 팁.
 *
 * 옵션이 옵션 창 안에만 있으면 정작 필요한 사람이 못 찾는다. 그렇다고
 * 자꾸 말을 걸면 그게 또 부담이다 — 그래서 규칙이 좁다: 팁마다 평생 한 번,
 * 한 세션(페이지 열림)에 최대 한 개, 소리는 없다(저자극 원칙).
 */

const KEY = 'moduquest-tips'

/** 본 팁·세션 규칙의 순수 판정부 — 시험이 이 클래스만 본다 */
export class TipKeeper {
  private shownThisSession = false

  constructor(private seen: Set<string>) {}

  /** 지금 이 팁을 보여줘도 되는가. 된다면 즉시 소비된 것으로 기록한다 */
  take(id: string): boolean {
    if (this.shownThisSession) return false
    if (this.seen.has(id)) return false
    this.seen.add(id)
    this.shownThisSession = true
    return true
  }

  get seenIds(): string[] {
    return [...this.seen]
  }
}

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return new Set(parsed.filter((v) => typeof v === 'string'))
    }
  } catch {
    // 깨진 값은 처음부터
  }
  return new Set()
}

/** 환영 설정을 봤는지도 같은 저장소를 쓴다 */
export const WELCOME_ID = 'welcome'

export function hasSeenTip(id: string): boolean {
  return loadSeen().has(id)
}

export function markTipSeen(id: string): void {
  const seen = loadSeen()
  seen.add(id)
  localStorage.setItem(KEY, JSON.stringify([...seen]))
}

/**
 * 게임 화면에 팁 줄을 하나 띄운다 — 화면과 낭독이 같은 문장을 말한다.
 * 잠시 뒤 스스로 걷힌다.
 */
export class Tips {
  private keeper = new TipKeeper(loadSeen())

  constructor(private announce: (text: string) => void) {}

  show(id: string, text: string): void {
    if (!this.keeper.take(id)) return
    localStorage.setItem(KEY, JSON.stringify(this.keeper.seenIds))

    const line = document.createElement('p')
    line.className = 'tip-line'
    line.textContent = text
    document.getElementById('app')?.append(line)
    this.announce(text)
    setTimeout(() => line.remove(), 9000)
  }
}
