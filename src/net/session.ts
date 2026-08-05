import type { RealtimeChannel } from '@supabase/supabase-js'
import type { EventBus } from '../core/events'
import type { Game, TurnScheduler } from '../core/game'
import { sanitizeSnapshot } from '../core/save'
import type { GameData } from '../core/types'
import { applyEnvelope } from './apply'
import { snapshotChecksum } from './checksum'
import { NetScheduler } from './netScheduler'
import {
  isChecksum,
  isPartyCode,
  isSeatsPayload,
  isSeedPayload,
  isSyncPayload,
  isSyncRequest,
  makePartyCode,
  type NetCommand,
  type Seat,
  type SeatInfo,
  type SeedPayload,
  type SyncPayload,
} from './protocol'
import { Sequencer } from './sequencer'
import { supabase } from './supabaseClient'

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
  private channel: RealtimeChannel
  private gapTimer: number | null = null
  /** 재접속·늦은 합류 대기열 — 필드로 돌아오는 순간 스냅샷을 보낸다 */
  private pendingSync = false

  private constructor(
    private game: Game,
    private data: GameData,
    private bus: EventBus,
    private hooks: SessionHooks,
    opts: { code: string; isHost: boolean; userId: string; nickname: string },
  ) {
    this.code = opts.code
    this.isHost = opts.isHost
    this.userId = opts.userId
    this.nickname = opts.nickname

    this.scheduler = new NetScheduler({
      isHost: () => this.isHost,
      realSchedule: (fn, ms) => window.setTimeout(fn, ms),
      realCancel: (h) => window.clearTimeout(h as number),
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
      now: () => Date.now(),
    })

    this.channel = supabase().channel(`party:${this.code}`, {
      config: {
        private: true,
        broadcast: { self: false },
        presence: { key: this.userId },
      },
    })

    // 게임 상태가 매듭지어지는 순간마다 어긋남을 검사한다
    this.bus.on((e) => {
      if (this.ended || !this.started) return
      if (e.type === 'battleEnd' || e.type === 'areaChanged' || e.type === 'stageStart') {
        this.exchangeChecksum()
        if (this.isHost && this.pendingSync && this.game.canSave) this.flushSync()
      }
    })
  }

  // --- 만들기와 참가 ---

  static async host(
    game: Game,
    data: GameData,
    bus: EventBus,
    hooks: SessionHooks,
    me: { userId: string; nickname: string },
  ): Promise<PartySession> {
    const code = makePartyCode((len) => crypto.getRandomValues(new Uint8Array(len)))
    const s = new PartySession(game, data, bus, hooks, { code, isHost: true, ...me })
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
  ): Promise<PartySession> {
    const normalized = code.trim().toUpperCase()
    if (!isPartyCode(normalized)) throw new Error('초대 코드는 8글자다. 다시 확인하자.')
    const s = new PartySession(game, data, bus, hooks, {
      code: normalized,
      isHost: false,
      ...me,
    })
    await s.subscribe()
    // 호스트가 자리를 주기를 기다린다 — 응답이 없으면 그 코드의 모험단은 없다
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        s.leave()
        reject(new Error('그 코드의 모험단을 찾지 못했다. 코드를 다시 확인하자.'))
      }, JOIN_TIMEOUT_MS)
      s.onSeated = () => {
        window.clearTimeout(timer)
        s.onSeated = null
        resolve()
      }
    })
    return s
  }

  /** 참가 완료 신호 — join()의 대기를 깨운다 */
  private onSeated: (() => void) | null = null

  private async subscribe(): Promise<void> {
    this.channel
      .on('broadcast', { event: 'propose' }, ({ payload }) => this.receivePropose(payload))
      .on('broadcast', { event: 'apply' }, ({ payload }) => this.sequencer.onApply(payload))
      .on('broadcast', { event: 'seats' }, ({ payload }) => this.receiveSeats(payload))
      .on('broadcast', { event: 'seed' }, ({ payload }) => this.receiveSeed(payload))
      .on('broadcast', { event: 'sync' }, ({ payload }) => this.receiveSync(payload))
      .on('broadcast', { event: 'sync_req' }, ({ payload }) => this.receiveSyncReq(payload))
      .on('broadcast', { event: 'checksum' }, ({ payload }) => this.receiveChecksum(payload))
      .on('presence', { event: 'join' }, ({ key }) => this.presenceJoined(key))
      .on('presence', { event: 'leave' }, ({ key }) => this.presenceLeft(key))

    await new Promise<void>((resolve, reject) => {
      this.channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void this.channel.track({ nickname: this.nickname })
          resolve()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error('모험단 채널에 들어가지 못했다. 연결을 확인하자.'))
        }
      })
    })
  }

  private broadcast(event: string, payload: unknown): void {
    if (this.ended) return
    void this.channel.send({ type: 'broadcast', event, payload })
  }

  // --- 자리 관리 (호스트 권위) ---

  private presenceJoined(userId: string): void {
    if (!this.isHost || this.ended || userId === this.userId) return
    const existing = this.seats.find((s) => s.userId === userId)
    if (existing) {
      // 재접속 — 같은 자리로 돌아온다. 필드에 닿는 순간 스냅샷을 보낸다
      this.refreshNickname(existing)
      if (this.started) {
        this.pendingSync = true
        if (this.game.canSave) this.flushSync()
        this.hooks.announce(`${existing.nickname}가 다시 이었다. 자리를 돌려준다.`)
      }
      this.shareSeats()
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
    const state = this.channel.presenceState<{ nickname: string }>()
    const entry = state[seat.userId]?.[0]
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
    }
    this.broadcast('seed', seed)
    this.applySeed(seed)
  }

  /** 저장된 기록에서 — 스냅샷이 곧 출발 조건이다 */
  startRestore(snapshot: unknown): void {
    if (!this.isHost || this.started) return
    const seed: SeedPayload = { v: 1, kind: 'restore', snapshot }
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
    // 자리 조작자를 먼저 앉힌다 — 파티를 만들 때 사람 자리가 표시되어야 한다
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

  /** UI의 변이 호출이 이 문으로 들어온다 — gamePort가 잇는다 */
  propose(cmd: NetCommand): void {
    if (this.ended || !this.started) return
    this.sequencer.propose(cmd)
  }

  private receivePropose(raw: unknown): void {
    if (!this.isHost || this.ended) return
    // 주장한 좌석이 실제로 사람이 앉은 자리인지 — 로스터가 판정의 근거다
    const claimed = (raw as { seat?: unknown } | null)?.seat
    const seated = this.seats.some(
      (s) => s.seat === claimed && s.controller === 'human' && s.userId !== this.userId,
    )
    this.sequencer.onPropose(raw, seated ? (claimed as Seat) : null)
  }

  // --- 어긋남 감지와 복구 ---

  private exchangeChecksum(): void {
    if (!this.game.canSave) return
    const hash = snapshotChecksum(this.game.snapshot())
    if (!this.isHost) {
      this.broadcast('checksum', { v: 1, seq: this.sequencer.appliedSeq, hash })
    }
  }

  private receiveChecksum(raw: unknown): void {
    if (!this.isHost || this.ended || !isChecksum(raw)) return
    if (!this.game.canSave) return
    const mine = snapshotChecksum(this.game.snapshot())
    if (mine !== raw.hash) {
      // 세계가 갈렸다 — 호스트의 스냅샷이 기준이다
      this.flushSync()
    }
  }

  private armGapTimer(): void {
    if (this.gapTimer !== null || this.isHost) return
    this.gapTimer = window.setTimeout(() => {
      this.gapTimer = null
      if (this.sequencer.hasGap) {
        this.broadcast('sync_req', {
          v: 1,
          userId: this.userId,
          haveSeq: this.sequencer.appliedSeq,
        })
      }
    }, GAP_SYNC_MS)
  }

  private receiveSyncReq(raw: unknown): void {
    if (!this.isHost || this.ended || !isSyncRequest(raw)) return
    if (this.game.canSave) this.flushSync()
    else this.pendingSync = true
  }

  /** 호스트의 지금 세계를 전원 기준으로 — 필드에서만 가능하다 */
  private flushSync(): void {
    if (!this.isHost || !this.game.canSave) return
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
    this.ended = true
    if (this.gapTimer !== null) window.clearTimeout(this.gapTimer)
    void this.channel.unsubscribe()
    this.hooks.restoreScheduler()
    this.hooks.setLayoutKey(null)
    this.hooks.onEnded(reason)
  }
}
