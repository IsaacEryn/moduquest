import type { EventBus, Listener } from '../core/events'
import type { Game, TurnScheduler } from '../core/game'
import { sanitizeSnapshot } from '../core/save'
import type { GameData } from '../core/types'
import { applyEnvelope } from './apply'
import { openSupabaseChannel, type OpenChannel, type PartyChannel } from './channel'
import { worldChecksum } from './checksum'
import { NetScheduler } from './netScheduler'
import {
  isChecksum,
  isPartyCode,
  isSeatsPayload,
  isSeedPayload,
  isSyncPayload,
  isSyncRequest,
  makePartyCode,
  senderOf,
  type NetCommand,
  type Seat,
  type SeatInfo,
  type SeedPayload,
  type SyncPayload,
} from './protocol'
import { Sequencer } from './sequencer'

/** 낭독·화면·저장을 세션 바깥(main)이 잇는 갈고리 */
export interface SessionHooks {
  announce(text: string): void
  alert(text: string): void
  /** 로비 화면 갱신 — 자리 배치가 바뀔 때마다 */
  onRosterChanged(): void
  /** 모험이 실제로 출발했다 — 로비를 닫는 시점 */
  onStarted(): void
  /** 세션이 끝났다 — 타이틀 복귀와 뒷정리는 main의 몫 */
  onEnded(reason: string): void
  /** 게스트가 출발 조건에서 받은 지도 순환 번호 */
  setLayoutKey(key: number | null): void
  /** 호스트의 지도 순환 번호 — 저장 자리 번호가 근거다 */
  getLayoutKey(): number
  /** 턴 타이머를 네트워크 시계로 갈아끼우고 되돌린다 */
  installScheduler(s: TurnScheduler): void
  restoreScheduler(): void
}

/** 구멍이 이만큼 지나도 안 메워지면 동기화를 청한다 */
const GAP_SYNC_MS = 3000
/** 참가 코드에 응답이 없으면 포기하는 시간 */
const JOIN_TIMEOUT_MS = 8000
/** 동기화 요청 재시도 상한 — 이만큼 청해도 안 오면 사용자에게 알린다 */
const GAP_RETRY_MAX = 4

/**
 * 함께 하기 한 판의 수명. 채널 하나, 자리 셋.
 *
 * 호스트가 순서(시퀀서)와 자리(로스터)의 권위다. 상태는 오가지 않고 명령만
 * 오간다 — 출발 조건(seed)을 맞춘 뒤 같은 명령 열을 재생하면 모든 화면이
 * 같은 세계다. 어긋나면(체크섬 불일치·순서 구멍) 호스트의 스냅샷으로 돌아온다.
 */
export class PartySession {
  readonly code: string
  readonly isHost: boolean
  readonly userId: string
  readonly nickname: string

  seats: SeatInfo[] = []
  mySeat: Seat = 0
  started = false
  private ended = false

  private sequencer: Sequencer
  private scheduler: NetScheduler
  private channel: PartyChannel
  private gapTimer: ReturnType<typeof setTimeout> | null = null
  /** 동기화를 몇 번 청했는가 — 한 번 보내고 마는 대신 물러서며 다시 청한다 */
  private gapTries = 0
  /** 재접속·늦은 합류 대기열 — 필드로 돌아오는 순간 스냅샷을 보낸다 */
  private pendingSync = false
  /** 버스 구독을 끊는 손잡이 — 세션은 수명이 있으므로 반드시 반납한다 */
  private unsubscribeBus: () => void

  private constructor(
    private game: Game,
    private data: GameData,
    private bus: EventBus,
    private hooks: SessionHooks,
    opts: {
      code: string
      isHost: boolean
      userId: string
      nickname: string
      openChannel: OpenChannel
    },
  ) {
    this.code = opts.code
    this.isHost = opts.isHost
    this.userId = opts.userId
    this.nickname = opts.nickname

    this.scheduler = new NetScheduler({
      isHost: () => this.isHost,
      realSchedule: (fn, ms) => setTimeout(fn, ms),
      realCancel: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      sendTick: () => this.sequencer.propose({ kind: 'tick' }),
    })
    this.sequencer = new Sequencer({
      isHost: () => this.isHost,
      mySeat: () => this.mySeat,
      apply: (env) => {
        applyEnvelope(this.game, this.scheduler, env, () =>
          this.end('방장이 모험을 마쳤다. 마지막 모습 그대로 저장돼 있다.'),
        )
        // 필드로 돌아온 순간이 밀린 동기화를 보낼 자리다
        if (this.isHost && this.pendingSync && this.game.canSave) this.flushSync()
      },
      send: (event, payload) => this.broadcast(event, payload),
      onGap: () => this.armGapTimer(),
      onApplyError: (env, err) => this.onApplyFailed(env.seq, err),
      now: () => Date.now(),
    })

    this.channel = opts.openChannel(`party:${this.code}`, this.userId)

    // 게임 상태가 매듭지어지는 순간마다 어긋남을 검사한다
    this.unsubscribeBus = this.bus.on(this.onGameEvent)
  }

  private onGameEvent: Listener = (e) => {
    if (this.ended || !this.started) return
    // 매듭이 지어지는 순간마다 견준다. 전투 시작도 매듭이다 —
    // 전투가 갈린 채로 여러 턴을 가면 되돌릴 것이 그만큼 커진다
    if (
      e.type === 'battleStart' ||
      e.type === 'battleEnd' ||
      e.type === 'areaChanged' ||
      e.type === 'stageStart'
    ) {
      this.exchangeChecksum()
      if (this.isHost && this.pendingSync && this.game.canSave) this.flushSync()
    }
  }

  // --- 만들기와 참가 ---

  static async host(
    game: Game,
    data: GameData,
    bus: EventBus,
    hooks: SessionHooks,
    me: { userId: string; nickname: string },
    openChannel: OpenChannel = openSupabaseChannel,
  ): Promise<PartySession> {
    const code = makePartyCode((len) => crypto.getRandomValues(new Uint8Array(len)))
    const s = new PartySession(game, data, bus, hooks, {
      code,
      isHost: true,
      openChannel,
      ...me,
    })
    s.seats = [{ seat: 0, userId: me.userId, nickname: me.nickname, controller: 'human' }]
    s.game.localSeat = 0
    await s.subscribe()
    return s
  }

  static async join(
    code: string,
    game: Game,
    data: GameData,
    bus: EventBus,
    hooks: SessionHooks,
    me: { userId: string; nickname: string },
    openChannel: OpenChannel = openSupabaseChannel,
  ): Promise<PartySession> {
    const normalized = code.trim().toUpperCase()
    if (!isPartyCode(normalized)) throw new Error('초대 코드는 8글자다. 다시 확인하자.')
    const s = new PartySession(game, data, bus, hooks, {
      code: normalized,
      isHost: false,
      openChannel,
      ...me,
    })
    // 기다림을 먼저 걸어 둔다 — 구독이 끝나기 전에 자리가 배정되면
    // (호스트가 가깝거나 시험이 즉시 답하면) 깨울 손잡이가 없어 8초를 헛기다린다
    const seated = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // 조용히 정리한다 — 여기서 leave()를 부르면 "나왔다" 낭독이
        // "코드를 다시 확인하자" 안내와 겹쳐 나간다
        s.teardown()
        reject(new Error('그 코드의 모험단을 찾지 못했다. 코드를 다시 확인하자.'))
      }, JOIN_TIMEOUT_MS)
      s.onSeated = () => {
        clearTimeout(timer)
        s.onSeated = null
        resolve()
      }
    })
    await s.subscribe()
    await seated
    return s
  }

  /** 참가 완료 신호 — join()의 대기를 깨운다 */
  private onSeated: (() => void) | null = null

  private async subscribe(): Promise<void> {
    // 호스트 권위 사건은 0번 자리에서 온 것만, 나머지는 명부에 있는 사람 것만 받는다
    this.channel.onBroadcast('propose', (p) => this.receivePropose(p))
    this.channel.onBroadcast('apply', (p) => {
      if (this.fromHost(p)) this.sequencer.onApply(p)
    })
    this.channel.onBroadcast('seats', (p) => {
      if (this.fromHost(p)) this.receiveSeats(p)
    })
    this.channel.onBroadcast('seed', (p) => {
      if (this.fromHost(p)) this.receiveSeed(p)
    })
    this.channel.onBroadcast('sync', (p) => {
      if (this.fromHost(p)) this.receiveSync(p)
    })
    this.channel.onBroadcast('sync_req', (p) => {
      if (this.seatOfSender(p) !== null) this.receiveSyncReq(p)
    })
    this.channel.onBroadcast('checksum', (p) => this.receiveChecksum(p, this.seatOfSender(p)))
    this.channel.onPresence('join', (key) => this.presenceJoined(key))
    this.channel.onPresence('leave', (key) => this.presenceLeft(key))

    await this.channel.subscribe()
    this.channel.track({ nickname: this.nickname })
  }

  // --- 발신자 검사 ---
  //
  // Supabase Broadcast는 발신자를 서버가 찍어 주지 않는다. 그래서 여기서 하는 일은
  // "명부에 있는, 지금 채널에 있는 사람인가"를 보는 것이지 서명 검증이 아니다.
  // 막을 수 있는 것: 자리를 못 받은 참가자, 이미 나간 사람, 자리 착각.
  // 막을 수 없는 것: 초대받은 사람이 다른 자리 사람의 userId를 적는 일 —
  // 그건 서버 권위(엣지 함수 중계)가 생겨야 닫힌다. senderOf의 주석에 적어 두었다.

  /** 지금 채널에 실재하는 사람인가 — 나간 사람의 뒤늦은 메시지를 막는다 */
  private isPresent(userId: string): boolean {
    return userId === this.userId || this.channel.presenceOf(userId) !== null
  }

  /** 보낸 사람이 앉은 자리. 명부 밖이면 null — 좌석은 주장이 아니라 명부가 정한다 */
  private seatOfSender(raw: unknown): Seat | null {
    const from = senderOf(raw)
    if (from === null || from === this.userId || !this.isPresent(from)) return null
    return this.seats.find((s) => s.userId === from)?.seat ?? null
  }

  /** 호스트 권위 사건인가 — 0번 자리에 앉은 사람이 보낸 것만 */
  private fromHost(raw: unknown): boolean {
    if (this.isHost || this.ended) return false
    const from = senderOf(raw)
    if (from === null || !this.isPresent(from)) return false
    const known = this.seats.find((s) => s.seat === 0)
    if (known) return known.userId === from
    // 아직 명부가 없다 — 스스로 0번 자리라고 밝히는 메시지(seats·seed·sync)만 받는다.
    // 명부를 갖기 전에도 아무나 방장 행세를 하지는 못한다
    const claimed = (raw as { seats?: SeatInfo[] }).seats?.find((s) => s.seat === 0)
    return claimed?.userId === from
  }

  private broadcast(event: string, payload: unknown): void {
    if (this.ended) return
    // 모든 메시지에 보낸 사람을 적는다 — 받는 쪽 검사의 근거다
    this.channel.send(event, { ...(payload as object), from: this.userId })
  }

  // --- 자리 관리 (호스트 권위) ---

  private presenceJoined(userId: string): void {
    if (!this.isHost || this.ended || userId === this.userId) return
    const existing = this.seats.find((s) => s.userId === userId)
    if (existing) {
      // 재접속 — 같은 자리로 돌아온다. 필드에 닿는 순간 스냅샷을 보낸다
      this.refreshNickname(existing)
      existing.controller = 'human'
      if (this.started) {
        this.sequencer.propose({ kind: 'seatControl', seat: existing.seat, controller: 'human' })
        this.pendingSync = true
        if (this.game.canSave) this.flushSync()
      }
      this.shareSeats()
      this.hooks.onRosterChanged()
      return
    }
    const taken = new Set(this.seats.map((s) => s.seat))
    const free = ([1, 2] as Seat[]).find((n) => !taken.has(n))
    if (free === undefined) {
      this.shareSeats() // 자리가 없다 — 로스터에 없음을 보고 참가자가 스스로 안다
      return
    }
    const seat: SeatInfo = { seat: free, userId, nickname: '', controller: 'human' }
    this.seats.push(seat)
    this.refreshNickname(seat)
    if (this.started) {
      this.pendingSync = true
      if (this.game.canSave) this.flushSync()
    }
    this.shareSeats()
    this.hooks.onRosterChanged()
  }

  /** presence의 닉네임을 로스터에 옮겨 적는다 */
  private refreshNickname(seat: SeatInfo): void {
    const entry = this.channel.presenceOf(seat.userId)
    if (entry && typeof entry.nickname === 'string') {
      seat.nickname = entry.nickname.slice(0, 12)
    }
  }

  private presenceLeft(userId: string): void {
    if (this.ended) return
    if (!this.isHost) {
      // 방장이 떠나면 모험은 여기서 매듭짓는다
      const hostSeat = this.seats.find((s) => s.seat === 0)
      if (hostSeat && hostSeat.userId === userId) {
        this.end('방장의 연결이 끊겼다. 모험은 여기까지 — 마지막 모습은 저장돼 있다.')
      }
      return
    }
    const seat = this.seats.find((s) => s.userId === userId)
    if (!seat) return
    if (!this.started) {
      // 로비에서는 자리를 비운다
      this.seats = this.seats.filter((s) => s !== seat)
      this.shareSeats()
      this.hooks.onRosterChanged()
      return
    }
    // 모험 중에는 자리를 남기고 동료 AI가 이어받는다 — 재접속하면 돌아온다
    if (this.game.moveTokenSeat === seat.seat) {
      this.sequencer.propose({ kind: 'token', toSeat: 0 })
    }
    seat.controller = 'npc'
    this.sequencer.propose({ kind: 'seatControl', seat: seat.seat, controller: 'npc' })
    this.shareSeats()
  }

  private shareSeats(): void {
    if (!this.isHost) return
    this.broadcast('seats', {
      v: 1,
      seats: this.seats,
      moveTokenSeat: this.game.moveTokenSeat as Seat,
      started: this.started,
    })
  }

  private receiveSeats(raw: unknown): void {
    if (this.isHost || !isSeatsPayload(raw)) return
    this.seats = raw.seats
    const mine = raw.seats.find((s) => s.userId === this.userId)
    if (!mine) {
      if (this.onSeated) return // 아직 자리를 기다리는 중 — 만석이면 타임아웃이 알린다
      this.end('자리가 정리되어 모험단에서 나왔다.')
      return
    }
    this.mySeat = mine.seat
    this.game.localSeat = mine.seat
    this.onSeated?.()
    this.hooks.onRosterChanged()
  }

  // --- 출발 (호스트) ---

  /** 새 모험 — 출발 조건만 나누고 각자 재생한다 */
  startNew(jobs: string[]): void {
    if (!this.isHost || this.started) return
    const seed: SeedPayload = {
      v: 1,
      kind: 'new',
      jobs,
      traitId: this.game.currentTraitId,
      layoutKey: this.layoutKey(),
      seats: this.seats,
    }
    this.broadcast('seed', seed)
    this.applySeed(seed)
  }

  /** 저장된 기록에서 — 스냅샷이 곧 출발 조건이다 */
  startRestore(snapshot: unknown): void {
    if (!this.isHost || this.started) return
    const seed: SeedPayload = { v: 1, kind: 'restore', snapshot, seats: this.seats }
    this.broadcast('seed', seed)
    this.applySeed(seed)
  }

  private layoutKey(): number {
    // 호스트의 저장 자리 번호가 지도 순환을 정한다 — 게스트도 같은 값을 받는다
    return this.hooks.getLayoutKey()
  }

  private receiveSeed(raw: unknown): void {
    if (this.isHost || this.ended || !isSeedPayload(raw)) return
    this.applySeed(raw)
  }

  private applySeed(seed: SeedPayload): void {
    // 자리 배치는 출발 조건이 정한다 — 각자의 명부를 근거로 삼으면 화면마다
    // 사람 자리가 갈리고, isPlayer는 체크섬에도 없어서 그 어긋남은 탐지되지 않는다
    this.seats = seed.seats
    const mine = seed.seats.find((s) => s.userId === this.userId)
    if (mine) {
      this.mySeat = mine.seat
      this.game.localSeat = mine.seat
    }
    for (const s of this.seats) this.game.setSeatController(s.seat, s.controller)
    if (seed.kind === 'restore') {
      const snap = sanitizeSnapshot(seed.snapshot, this.data)
      if (!snap) {
        if (!this.isHost) this.end('출발 조건을 읽지 못했다. 다시 참가해 보자.')
        return
      }
      this.hooks.setLayoutKey(snap.layoutKey)
      this.game.restore(snap)
    } else {
      this.hooks.setLayoutKey(seed.layoutKey)
      this.game.setTrait(seed.traitId)
      this.game.setParty(seed.jobs)
      this.game.start()
    }
    this.started = true
    this.sequencer.reset(0)
    this.hooks.installScheduler(this.scheduler)
    if (this.isHost) this.shareSeats()
    this.hooks.onStarted()
    this.hooks.announce(
      `함께 하는 모험이 시작됐다. ${this.seats.length}명이 같은 세계를 걷는다.`,
    )
  }

  // --- 명령 (락스텝) ---

  /** 지금까지 적용한 확정 번호 — 두 화면이 같은 지점에 있는지 보는 창 */
  get appliedSeq(): number {
    return this.sequencer.appliedSeq
  }

  /** UI의 변이 호출이 이 문으로 들어온다 — gamePort가 잇는다 */
  propose(cmd: NetCommand): void {
    if (this.ended || !this.started) return
    this.sequencer.propose(cmd)
  }

  private receivePropose(raw: unknown): void {
    if (!this.isHost || this.ended) return
    // 자리는 보낸 사람이 정하는 것이 아니라 명부가 정한다. 예전에는 페이로드가
    // 주장한 좌석이 "사람이 앉은 자리"이기만 하면 통과해서, 2번 자리 사람이
    // 1번 좌석을 적어 보내면 그 사람의 조작권을 가져갈 수 있었다
    const seat = this.seatOfSender(raw)
    if (seat === null) return
    const info = this.seats.find((s) => s.seat === seat)
    if (info?.controller !== 'human') return
    this.sequencer.onPropose(raw, seat)
  }

  // --- 어긋남 감지와 복구 ---

  /** 지금 이 화면의 세계를 한 수로 — 저장에 담기지 않는 것까지 포함한다 */
  private worldHash(): number {
    return worldChecksum(this.game.snapshot(), this.game.liveFingerprint())
  }

  private exchangeChecksum(): void {
    // 전투 중에도 견준다. 저장은 못 해도 어긋남은 알아야 한다 —
    // 전투가 갈린 채로 계속 가는 것이 이 게임에서 가장 나쁜 어긋남이다
    if (!this.isHost) {
      this.broadcast('checksum', { v: 1, seq: this.sequencer.appliedSeq, hash: this.worldHash() })
    }
  }

  /**
   * 같은 순간의 세계끼리만 비교한다. 예전에는 게스트가 seq 100에서 낸 해시를
   * 호스트가 받는 시점(이미 103쯤)의 자기 해시와 견줘서, 멀쩡한 파티가 걸음
   * 한 번 차이로 어긋났다고 판정되고 전원이 되돌려지는 일이 상시 일어났다.
   */
  private receiveChecksum(raw: unknown, from: Seat | null): void {
    if (!this.isHost || this.ended || from === null || !isChecksum(raw)) return
    if (raw.seq !== this.sequencer.appliedSeq) return // 다른 순간이라 비교할 수 없다
    if (this.worldHash() === raw.hash) return
    // 세계가 갈렸다 — 호스트의 스냅샷이 기준이다.
    // 전투 중이면 지금은 되돌릴 수 없으니 필드로 나오는 첫 순간에 맞춘다
    if (this.game.canSave) this.flushSync()
    else this.pendingSync = true
  }

  /**
   * 구멍을 메워 달라고 청한다. 한 번 보내고 마는 대신 물러서며 다시 청한다 —
   * 예전에는 그 한 번이 유실되면(트래픽이 멈추면 재무장도 안 된다) 영영 멈춰 있었다.
   */
  private armGapTimer(): void {
    if (this.gapTimer !== null || this.isHost || this.ended) return
    const wait = GAP_SYNC_MS * 2 ** Math.min(this.gapTries, 3)
    this.gapTimer = setTimeout(() => {
      this.gapTimer = null
      if (!this.sequencer.hasGap || this.ended) {
        this.gapTries = 0
        return
      }
      this.gapTries += 1
      this.broadcast('sync_req', {
        v: 1,
        userId: this.userId,
        haveSeq: this.sequencer.appliedSeq,
      })
      if (this.gapTries >= GAP_RETRY_MAX) {
        // 조용한 정지가 최악이다 — 기다리는 이유를 말해 준다
        this.hooks.alert('함께 하기 연결이 불안정하다. 세계를 다시 맞추는 중이다.')
      }
      this.armGapTimer()
    }, wait)
  }

  /**
   * 봉투를 잃은 화면에 잃은 것만 되쏜다. 스냅샷 재동기화와 달리 전투 중에도 되므로,
   * 전투에서 어긋나면 양쪽이 영원히 기다리던 길이 여기서 막힌다.
   */
  private receiveSyncReq(raw: unknown): void {
    if (!this.isHost || this.ended || !isSyncRequest(raw)) return
    const missing = this.sequencer.since(raw.haveSeq)
    if (missing !== null) {
      for (const env of missing) this.broadcast('apply', env)
      return
    }
    // 기록에도 없을 만큼 뒤처졌다 — 그때는 세계 전체를 보내는 수밖에 없다
    if (this.game.canSave) this.flushSync()
    else this.pendingSync = true
  }

  /**
   * 확정 명령의 적용이 던졌다. 번호는 이미 소비됐으니 이 화면은 갈렸다 —
   * 조용히 진행하면 아무도 모르는 채로 다른 세계를 걷게 된다.
   */
  private onApplyFailed(seq: number, err: unknown): void {
    console.error('확정 명령 적용 실패:', seq, err)
    if (this.ended) return
    if (this.isHost) {
      // 호스트가 기준이므로 되돌릴 곳이 없다. 사실만 알린다
      this.hooks.alert('명령을 적용하지 못했다. 화면이 어긋났을 수 있다.')
      return
    }
    this.hooks.alert('세계가 어긋났다. 방장의 기준으로 다시 맞추는 중이다.')
    this.broadcast('sync_req', { v: 1, userId: this.userId, haveSeq: -1 })
  }

  /**
   * 호스트의 지금 세계를 전원 기준으로 — 필드에서만 가능하다.
   *
   * 같은 지점에서 두 번 보내지 않는다. 되돌리기는 그 자체로 stageStart를 일으키고,
   * 그러면 받은 화면이 다시 체크섬을 보낸다 — 한쪽이 영영 일치하지 않으면
   * 그 왕복이 끝나지 않는 고리가 된다. 지점당 한 번이면 고리가 닫힌다.
   */
  private lastSyncSeq: number | null = null

  private flushSync(): void {
    if (!this.isHost || !this.game.canSave) return
    if (this.lastSyncSeq === this.sequencer.appliedSeq) return
    this.lastSyncSeq = this.sequencer.appliedSeq
    this.pendingSync = false
    const payload: SyncPayload = {
      v: 1,
      seq: this.sequencer.appliedSeq,
      snapshot: this.game.snapshot(),
      seats: this.seats,
      moveTokenSeat: this.game.moveTokenSeat as Seat,
      layoutKey: this.layoutKey(),
    }
    this.broadcast('sync', payload)
  }

  private receiveSync(raw: unknown): void {
    if (this.isHost || this.ended || !isSyncPayload(raw)) return
    const snap = sanitizeSnapshot(raw.snapshot, this.data)
    if (!snap) return
    this.seats = raw.seats
    const mine = raw.seats.find((s) => s.userId === this.userId)
    if (mine) {
      this.mySeat = mine.seat
      this.game.localSeat = mine.seat
    }
    this.hooks.setLayoutKey(raw.layoutKey)
    for (const s of raw.seats) this.game.setSeatController(s.seat, s.controller)
    this.game.restore(snap)
    this.game.moveTokenSeat = raw.moveTokenSeat
    this.sequencer.reset(raw.seq)
    this.gapTries = 0
    if (this.gapTimer !== null) {
      clearTimeout(this.gapTimer)
      this.gapTimer = null
    }
    if (!this.started) {
      // 진행 중인 모험에 합류했다 — 로비를 닫고 세계로
      this.started = true
      this.hooks.installScheduler(this.scheduler)
      this.hooks.onStarted()
    }
    this.hooks.announce('세계를 방장의 기준으로 다시 맞췄다.')
  }

  // --- 끝 ---

  /** 방장이 모험을 마친다 — 전원이 같은 마지막 상태로 저장하고 흩어진다 */
  finish(): void {
    if (!this.isHost) return
    if (this.started) {
      this.propose({ kind: 'endSession' })
    }
    // endSession 적용이 자기 자신도 end()로 이끈다. 시작 전이면 바로 끝낸다
    if (!this.started) this.end('모험단을 닫았다.')
  }

  /** 조용히 자리를 뜬다 — 남은 사람들에게는 presence가 알린다 */
  leave(): void {
    this.end(this.started ? '모험단에서 나왔다. 내 기록은 저장돼 있다.' : '모험단에서 나왔다.')
  }

  private end(reason: string): void {
    if (this.ended) return
    this.teardown()
    this.hooks.restoreScheduler()
    this.hooks.setLayoutKey(null)
    this.hooks.onEnded(reason)
  }

  /**
   * 남긴 것을 전부 거둔다 — 채널·타이머·버스 구독. 낭독은 하지 않으므로
   * 참가 실패처럼 "끝났다고 말할 것이 없는" 자리에서도 쓸 수 있다.
   */
  private teardown(): void {
    if (this.ended) return
    this.ended = true
    if (this.gapTimer !== null) clearTimeout(this.gapTimer)
    this.gapTimer = null
    // 호스트의 실제 타이머가 살아 있으면 세션이 끝난 뒤에도 한 번 더 진행된다
    this.scheduler.cancel(null)
    this.unsubscribeBus()
    this.channel.close()
  }
}
