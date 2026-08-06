import {
  hostOnly,
  isEnvelope,
  isProposal,
  type Envelope,
  type NetCommand,
  type Seat,
} from './protocol'

/**
 * 호스트 시퀀서 락스텝의 순서 담당.
 *
 * - 게스트: 명령을 제안(propose)으로 보낸다. 직접 적용하지 않는다.
 * - 호스트: 제안을 받아 전역 번호(seq)를 붙여 확정(apply)으로 되돌린다.
 *   자기 명령도 같은 길을 지난다 — 호스트와 게스트가 다른 순서로 적용되는 일이
 *   구조적으로 불가능해진다.
 * - 전원: 확정 명령을 번호 순서대로만 적용한다. 지난 번호는 버리고, 건너뛴 번호는
 *   버퍼에 두고 구멍이 메워지기를 기다린다. 오래 안 메워지면 onGap이 불려
 *   세션이 동기화를 요청한다.
 *
 * 채널·시계는 주입받는다 — 이 파일은 순수 로직이라 node 테스트가 그대로 돈다.
 */
/**
 * 미래 봉투를 쥐고 기다리는 창의 크기. 이보다 먼 번호는 순서가 아니라 잡음이거나
 * 공격이다 — 무한정 쌓으면 메모리가 자란다.
 */
const BUFFER_WINDOW = 64

/** 호스트가 재전송용으로 들고 있는 봉투 수. 잃은 사람이 여기까지는 따라잡는다 */
const RESEND_HISTORY = 256

export class Sequencer {
  /** 마지막으로 적용한 확정 번호 */
  private lastSeq: number
  /** 호스트 전용: 다음에 발급할 번호 */
  private nextSeq: number
  /** 순서보다 일찍 도착한 확정 명령 */
  private buffered = new Map<number, Envelope>()
  /** 호스트 전용: 재전송 제안 무시용 nonce 창 */
  private seenNonces: string[] = []
  /** 호스트 전용: 좌석별 최근 제안 시각 — 폭주 방지 */
  private recent = new Map<Seat, number[]>()
  /**
   * 호스트 전용: 발급한 봉투의 최근 기록. 봉투를 잃은 화면이 이 기록에서 따라잡는다 —
   * 스냅샷 재동기화와 달리 전투 중에도 쓸 수 있는 유일한 복구 수단이다.
   */
  private history: Envelope[] = []

  constructor(
    private opts: {
      isHost: () => boolean
      mySeat: () => Seat
      /** 확정 명령 하나를 게임에 적용한다 */
      apply: (env: Envelope) => void
      /** 채널로 내보낸다 */
      send: (event: 'propose' | 'apply', payload: unknown) => void
      /** 구멍이 생겼다 — 세션이 동기화 요청을 판단한다 */
      onGap?: () => void
      /**
       * 적용이 던졌다. 번호는 이미 소비됐으므로 이 화면의 세계는 갈렸다 —
       * 세션이 강제 재동기화를 걸어야 한다. 조용히 지나가면 안 되는 유일한 자리다.
       */
      onApplyError?: (env: Envelope, err: unknown) => void
      now?: () => number
      /** 좌석당 초당 제안 상한 */
      rateLimit?: number
    },
    startSeq = 0,
  ) {
    this.lastSeq = startSeq
    this.nextSeq = startSeq + 1
  }

  get appliedSeq(): number {
    return this.lastSeq
  }

  /** 합류·재동기화 후 기준 번호를 다시 잡는다 */
  reset(seq: number): void {
    this.lastSeq = seq
    this.nextSeq = seq + 1
    this.buffered.clear()
  }

  /**
   * 호스트: haveSeq 다음 번호부터의 봉투들. 기록에 남아 있지 않으면 null —
   * 그때는 스냅샷 재동기화 말고는 길이 없다.
   */
  since(haveSeq: number): Envelope[] | null {
    if (!this.opts.isHost()) return null
    if (haveSeq >= this.lastSeq) return []
    const oldest = this.history[0]
    if (!oldest || oldest.seq > haveSeq + 1) return null
    return this.history.filter((e) => e.seq > haveSeq)
  }

  /** 내 명령 — 게스트는 제안으로 보내고, 호스트는 바로 확정 발급한다 */
  propose(cmd: NetCommand): void {
    const seat = this.opts.mySeat()
    if (this.opts.isHost()) {
      this.issue(seat, cmd)
    } else {
      const nonce = `${seat}-${this.lastSeq}-${Math.floor((this.opts.now?.() ?? 0) % 1e7)}-${this.counter++}`
      this.opts.send('propose', { v: 1, seat, nonce, cmd })
    }
  }

  private counter = 0

  /** 호스트: 게스트의 제안 수신 — 검증을 통과한 것만 확정으로 */
  onPropose(raw: unknown, fromSeat: Seat | null): void {
    if (!this.opts.isHost()) return
    if (!isProposal(raw)) return
    // 좌석이 확인된 발신자의, 자기 좌석 명령만 받는다 — 참가 승인 없는 자의 제안은 버린다
    if (fromSeat === null || raw.seat !== fromSeat) return
    // 방장 전용 명령은 방장 자리에서만
    if (hostOnly(raw.cmd) && raw.seat !== 0) return
    // 재전송 무시
    if (this.seenNonces.includes(raw.nonce)) return
    this.seenNonces.push(raw.nonce)
    if (this.seenNonces.length > 64) this.seenNonces.shift()
    // 폭주 방지 — 좌석당 초당 상한.
    // 5였을 때는 방향키를 누르고 있기만 해도(키 리피트) 정상 조작이 말없이 잘렸다.
    // 사람 손이 넘길 수 없는 선까지 올려, 잘리는 것이 실수가 아니라 폭주이게 한다
    const now = this.opts.now?.() ?? 0
    const limit = this.opts.rateLimit ?? 20
    const times = (this.recent.get(raw.seat) ?? []).filter((t) => now - t < 1000)
    if (times.length >= limit) return
    times.push(now)
    this.recent.set(raw.seat, times)

    this.issue(raw.seat, raw.cmd)
  }

  /** 호스트: 번호를 붙여 전원에게 확정 발송 + 자신도 같은 경로로 적용 */
  private issue(seat: Seat, cmd: NetCommand): void {
    const env: Envelope = { v: 1, seq: this.nextSeq++, seat, cmd }
    this.history.push(env)
    if (this.history.length > RESEND_HISTORY) this.history.shift()
    this.opts.send('apply', env)
    this.onApply(env)
  }

  /** 전원: 확정 명령 수신 — 번호 순서만 지키면 세계가 갈리지 않는다 */
  onApply(raw: unknown): void {
    if (!isEnvelope(raw)) return
    if (raw.seq <= this.lastSeq) return // 이미 지난 것
    if (raw.seq > this.lastSeq + 1) {
      // 구멍 — 먼저 온 것을 쥐고 기다린다. 창 밖의 먼 번호는 순서가 아니라 잡음이다
      if (raw.seq <= this.lastSeq + BUFFER_WINDOW) this.buffered.set(raw.seq, raw)
      this.opts.onGap?.()
      return
    }
    this.applyNow(raw)
    // 구멍이 메워졌으면 이어서 소화한다
    let next = this.buffered.get(this.lastSeq + 1)
    while (next) {
      this.buffered.delete(next.seq)
      this.applyNow(next)
      next = this.buffered.get(this.lastSeq + 1)
    }
  }

  get hasGap(): boolean {
    return this.buffered.size > 0
  }

  /**
   * 번호를 소비하고 적용한다. 적용이 던져도 번호는 되돌리지 않는다 —
   * 되돌리면 반쯤 적용된 명령을 한 번 더 적용하게 되고, 그건 갈린 세계보다 나쁘다.
   * 대신 갈렸다는 사실을 반드시 위로 알린다. 조용히 지나가는 것만은 막아야 한다.
   */
  private applyNow(env: Envelope): void {
    this.lastSeq = env.seq
    try {
      this.opts.apply(env)
    } catch (err) {
      this.opts.onApplyError?.(env, err)
    }
  }
}
