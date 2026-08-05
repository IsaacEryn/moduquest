import type { TurnScheduler } from '../core/game'

/**
 * 함께 하기의 턴 타이머. 시계는 호스트 하나뿐이다.
 *
 * 솔로에서는 setTimeout이 만료되는 순간 다음 턴이 진행되지만, 화면마다 시계가
 * 다르면 원격 명령과 타이머 만료의 순서가 화면마다 갈린다. 그래서 호스트만 실제
 * 타이머를 돌리고, 만료를 tick 명령으로 시퀀서에 넣는다. 모든 화면(호스트 포함)은
 * tick이 확정 순서로 도착했을 때에야 보류해 둔 콜백을 실행한다.
 *
 * 예약은 코어에서 언제나 하나뿐이라(단일 turnTimer) tick과 콜백은 1:1로 맞는다.
 * tick이 왔는데 보류가 없으면(직전 명령이 타이머를 지웠다) 무시한다 — 이 판단도
 * 결정적이라 모든 화면이 같다.
 */
export class NetScheduler implements TurnScheduler {
  private pending: (() => void) | null = null
  private realHandle: unknown = null

  constructor(
    private opts: {
      isHost: () => boolean
      /** 실제 타이머 — 호스트에서만 쓰인다 */
      realSchedule: (fn: () => void, delayMs: number) => unknown
      realCancel: (handle: unknown) => void
      /** 만료를 시퀀서에 알린다(tick 명령 발급) */
      sendTick: () => void
    },
  ) {}

  schedule(fn: () => void, delayMs: number): unknown {
    this.pending = fn
    if (this.opts.isHost()) {
      this.realHandle = this.opts.realSchedule(() => {
        this.realHandle = null
        // 직접 실행하지 않는다 — 호스트도 확정 순서를 지나야 게스트와 같은 길을 걷는다
        this.opts.sendTick()
      }, delayMs)
    }
    return {}
  }

  cancel(_handle: unknown): void {
    this.pending = null
    if (this.realHandle !== null) {
      this.opts.realCancel(this.realHandle)
      this.realHandle = null
    }
  }

  /** tick 명령이 확정 순서로 도착했다 — 보류 콜백을 실행한다 */
  runTick(): void {
    const fn = this.pending
    this.pending = null
    fn?.()
  }
}
