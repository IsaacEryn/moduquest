import type { Dir, EquipSlot, PlayerAction, UpgradeStat } from '../core/types'

/**
 * 함께 하기의 언어. 화면들이 주고받는 것은 상태가 아니라 **명령**이다 —
 * 코어가 결정적이라 같은 명령 열을 재생하면 모든 화면이 같은 세계에 도달한다.
 *
 * 여기 적힌 것 말고는 오가지 않고, 받은 것은 반드시 타입 가드를 통과해야 한다.
 * 통과하지 못한 페이로드는 조용히 버린다 — 원격 데이터는 신뢰하지 않는다.
 */

export type Seat = 0 | 1 | 2

export type NetCommand =
  | { kind: 'move'; dir: Dir }
  | { kind: 'advanceDialogue' }
  | { kind: 'playerAction'; action: PlayerAction }
  | { kind: 'useItemInField'; itemId: string; targetId: string }
  | { kind: 'equip'; memberId: string; itemId: string }
  | { kind: 'unequip'; memberId: string; slot: EquipSlot }
  | { kind: 'buy'; itemId: string }
  | { kind: 'sell'; itemId: string }
  | { kind: 'dismantle'; itemId: string }
  | { kind: 'upgrade'; memberId: string; stat: UpgradeStat }
  // 자기 자리의 특성만 바꾼다 — 누구인지는 봉투(Envelope.seat)가 이미 말한다
  | { kind: 'setTrait'; traitId: string }
  // 내 가방에서 동료에게 건넨다. 보내는 자리도 봉투가 말한다
  | { kind: 'giveItem'; itemId: string; toSeat: Seat }
  | { kind: 'startStage'; index: number } // 방장 전용
  | { kind: 'nextStage' } // 방장 전용
  | { kind: 'restartStage' } // 방장 전용
  | { kind: 'token'; toSeat: Seat } // 길잡이 넘기기 — 쥔 사람·방장만
  | { kind: 'seatControl'; seat: Seat; controller: 'human' | 'npc' } // 호스트 전용
  | { kind: 'tick' } // 호스트 전용 — 턴 타이머 만료
  | { kind: 'endSession' } // 호스트 전용

/** 게스트 → 호스트: 아직 순서가 없는 제안 */
export interface Proposal {
  v: 1
  seat: Seat
  /** 재전송 dedupe용 — 값 자체에 의미는 없다 */
  nonce: string
  cmd: NetCommand
}

/** 호스트 → 전원: 전역 순서가 붙은 확정 명령. 호스트 자신도 이 길로만 적용한다 */
export interface Envelope {
  v: 1
  seq: number
  seat: Seat
  cmd: NetCommand
}

/** 자리 하나의 사실 — 누가 앉아 있고 지금 사람인가 */
export interface SeatInfo {
  seat: Seat
  userId: string
  nickname: string
  controller: 'human' | 'npc'
  /**
   * 그 자리 사람이 고른 직업. 아직 안 골랐으면 없다.
   *
   * 특성도 가방도 자리마다 갈라 놓고 직업만 방장이 정해 주고 있었다 —
   * 무엇으로 싸울지는 그 사람이 그 판을 어떻게 겪을지를 정하는 첫 선택이라,
   * 남이 대신 고를 자리가 아니다.
   */
  job?: string
  /**
   * 이 자리 사람이 준비를 마쳤는가. 방장은 전원이 이것을 올린 뒤에야 출발한다.
   *
   * 고르는 중인 사람을 두고 떠나지 않으려고 둔 문인데, 문에는 늘 열쇠가 있어야
   * 한다 — 자리를 비운 사람(controller가 npc가 된 자리)은 기다림에서 빼야
   * 연결이 끊긴 동료 하나 때문에 남은 사람들이 영영 못 나가는 일이 없다.
   */
  ready?: boolean
}

/**
 * 게스트 → 방장: 내 자리의 직업을 이것으로 하겠다.
 *
 * 출발 전 로비에서만 오간다. 아직 세계가 서기 전이라 시퀀서를 지나지 않고,
 * 방장이 받아 명부에 적은 뒤 전원에게 다시 알린다 — 명부의 주인이 하나여야
 * 출발할 때 무엇으로 시작할지가 갈리지 않는다.
 *
 * 어느 자리인지는 여기 적지 않는다. 봉투가 나르는 발신자로 방장이 판정한다 —
 * 자리를 페이로드에 적게 두면 남의 자리 직업을 바꾸는 길이 열린다.
 */
export interface JobPickPayload {
  v: 1
  userId: string
  job: string
}

/**
 * 게스트 → 방장: 나는 준비를 마쳤다(또는 다시 고르겠다).
 *
 * 직업 고르기와 같은 길을 지난다 — 출발 전 로비에서만, 자리는 봉투가 판정한다.
 */
export interface ReadyPayload {
  v: 1
  userId: string
  ready: boolean
}

/** 로비·이탈·합류 때 호스트가 알리는 자리 배치 */
export interface SeatsPayload {
  v: 1
  seats: SeatInfo[]
  moveTokenSeat: Seat
  started: boolean
  /**
   * 방장이 컴퓨터에게 맡기기로 한 자리. 코드를 알아도 이 자리에는 들어오지 못한다 —
   * 둘이서만 걷기로 했으면 그 결정이 문이 되어야 한다.
   */
  closedSeats?: Seat[]
}

/**
 * 모험의 출발점. 상태를 옮기는 게 아니라 **출발 조건**을 옮긴다 —
 * 전원이 같은 조건에서 같은 명령을 재생하면 같은 세계가 된다.
 */
export type SeedPayload =
  | {
      v: 1
      kind: 'new'
      jobs: string[]
      /** 자리마다의 특성. 파티 배열과 같은 순서 */
      traitIds: string[]
      layoutKey: number
      seats: SeatInfo[]
    }
  // 스냅샷은 sanitizeSnapshot이 최종 판정
  | { v: 1; kind: 'restore'; snapshot: unknown; seats: SeatInfo[] }

/** 합류·재접속·어긋남 복구 — 순간의 세계 전체 */
export interface SyncPayload {
  v: 1
  seq: number
  snapshot: unknown // 받는 쪽에서 sanitizeSnapshot 필수
  seats: SeatInfo[]
  moveTokenSeat: Seat
  layoutKey: number
}

export interface SyncRequest {
  v: 1
  userId: string
  haveSeq: number
}

export interface ChecksumPayload {
  v: 1
  seq: number
  hash: number
}

// --- 발신자 표식 ---

/**
 * 모든 브로드캐스트는 보낸 사람의 userId를 달고 다닌다. 받는 쪽은 이 값이
 * 모험단 명부에 있는 사람인지, 그 사건을 낼 자격이 있는 자리인지를 본다.
 *
 * **이것은 서명이 아니다.** Supabase Broadcast는 발신자를 서버가 찍어 주지 않으므로,
 * 같은 채널에 들어온 사람은 남의 userId를 적을 수 있다. 그래서 이 검사가 막는 것은
 * 명부 밖 사람(자리를 못 받은 참가자, 이미 나간 사람)과 자리 착각이지, 초대한 사람의
 * 악의는 아니다. 신뢰 경계는 "코드를 알려준 사람들"이고, 그 바깥은 채널 인가(RLS)가 맡는다.
 * 진짜 자리별 인증은 서버 권위(엣지 함수 중계)가 생겨야 성립한다.
 */
export function senderOf(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null
  const from = (v as { from?: unknown }).from
  return typeof from === 'string' && from.length > 0 && from.length <= 64 ? from : null
}

// --- 런타임 타입 가드 — 원격에서 온 것은 전부 여기를 지나야 한다 ---

const DIRS = new Set(['north', 'south', 'east', 'west'])
const SLOTS = new Set(['weapon', 'armor', 'shoes', 'gloves'])
const STATS = new Set(['hp', 'atk', 'def', 'spd'])
const MAX_ID = 40

const isSeat = (v: unknown): v is Seat => v === 0 || v === 1 || v === 2
const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID
const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

function isPlayerAction(v: unknown): v is PlayerAction {
  if (!v || typeof v !== 'object') return false
  const a = v as Record<string, unknown>
  switch (a.kind) {
    case 'attack':
      return isId(a.targetId)
    case 'skill':
      return isInt(a.skillIndex, 0, 9) && (a.targetId === undefined || isId(a.targetId))
    case 'item':
      return isId(a.itemId) && isId(a.targetId)
    case 'defend':
      return true
    default:
      return false
  }
}

export function isNetCommand(v: unknown): v is NetCommand {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  switch (c.kind) {
    case 'move':
      return DIRS.has(c.dir as string)
    case 'advanceDialogue':
    case 'nextStage':
    case 'restartStage':
    case 'tick':
    case 'endSession':
      return true
    case 'playerAction':
      return isPlayerAction(c.action)
    case 'useItemInField':
      return isId(c.itemId) && isId(c.targetId)
    case 'equip':
      return isId(c.memberId) && isId(c.itemId)
    case 'unequip':
      return isId(c.memberId) && SLOTS.has(c.slot as string)
    case 'buy':
    case 'sell':
    case 'dismantle':
      return isId(c.itemId)
    case 'upgrade':
      return isId(c.memberId) && STATS.has(c.stat as string)
    case 'setTrait':
      return isId(c.traitId)
    case 'giveItem':
      return isId(c.itemId) && isSeat(c.toSeat)
    case 'startStage':
      return isInt(c.index, 0, 9)
    case 'token':
      return isSeat(c.toSeat)
    case 'seatControl':
      return isSeat(c.seat) && (c.controller === 'human' || c.controller === 'npc')
    default:
      return false
  }
}

/** 방장(0번 자리)만 낼 수 있는 명령 — 호스트가 제안 단계에서 거른다 */
export function hostOnly(cmd: NetCommand): boolean {
  return (
    cmd.kind === 'startStage' ||
    cmd.kind === 'nextStage' ||
    cmd.kind === 'restartStage' ||
    cmd.kind === 'seatControl' ||
    cmd.kind === 'tick' ||
    cmd.kind === 'endSession'
  )
}

export function isProposal(v: unknown): v is Proposal {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return (
    p.v === 1 &&
    isSeat(p.seat) &&
    typeof p.nonce === 'string' &&
    p.nonce.length <= 32 &&
    isNetCommand(p.cmd)
  )
}

export function isEnvelope(v: unknown): v is Envelope {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return (
    e.v === 1 &&
    isInt(e.seq, 0, Number.MAX_SAFE_INTEGER) &&
    isSeat(e.seat) &&
    isNetCommand(e.cmd)
  )
}

function isSeatInfo(v: unknown): v is SeatInfo {
  if (!v || typeof v !== 'object') return false
  const s = v as Record<string, unknown>
  return (
    isSeat(s.seat) &&
    typeof s.userId === 'string' &&
    s.userId.length <= 64 &&
    typeof s.nickname === 'string' &&
    s.nickname.length <= 12 &&
    (s.controller === 'human' || s.controller === 'npc') &&
    // 직업은 아직 안 골랐을 수 있다. 실재하는 이름인지는 게임 데이터가 판정하므로
    // 여기서는 길이만 본다 — 없는 직업으로 출발하려 들면 코어가 받지 않는다
    (s.job === undefined || (typeof s.job === 'string' && s.job.length <= 32)) &&
    (s.ready === undefined || typeof s.ready === 'boolean')
  )
}

/** 자리 목록의 상식 — 한 자리에 한 사람, 한 사람이 두 자리에 앉지 않는다 */
function seatsAreDistinct(seats: SeatInfo[]): boolean {
  return (
    new Set(seats.map((s) => s.seat)).size === seats.length &&
    new Set(seats.map((s) => s.userId)).size === seats.length
  )
}

export function isSeatsPayload(v: unknown): v is SeatsPayload {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return (
    p.v === 1 &&
    Array.isArray(p.seats) &&
    p.seats.length <= 3 &&
    p.seats.every(isSeatInfo) &&
    seatsAreDistinct(p.seats) &&
    isSeat(p.moveTokenSeat) &&
    typeof p.started === 'boolean' &&
    // 옛 화면이 보낸 명부에는 이 항목이 없다 — 없으면 아무 자리도 닫지 않은 것
    (p.closedSeats === undefined ||
      (Array.isArray(p.closedSeats) && p.closedSeats.length <= 3 && p.closedSeats.every(isSeat)))
  )
}

/** 준비 신호 — 직업 고르기와 같은 규칙으로 본다 */
export function isReadyPick(v: unknown): v is ReadyPayload {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return (
    p.v === 1 && typeof p.userId === 'string' && p.userId.length <= 64 && typeof p.ready === 'boolean'
  )
}

/** 게스트가 고른 직업 — 자리는 봉투가 나르므로 여기서는 이름만 본다 */
export function isJobPick(v: unknown): v is JobPickPayload {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return (
    p.v === 1 &&
    typeof p.userId === 'string' &&
    p.userId.length <= 64 &&
    typeof p.job === 'string' &&
    p.job.length > 0 &&
    p.job.length <= 32
  )
}

export function isSeedPayload(v: unknown): v is SeedPayload {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  if (p.v !== 1) return false
  // 자리 배치를 출발 조건에 함께 싣는다 — 각 화면이 저마다의 명부로 파티를 만들면
  // 사람 자리와 AI 자리가 갈려 첫 전투부터 다른 세계가 된다
  if (!Array.isArray(p.seats) || p.seats.length > 3) return false
  if (!p.seats.every(isSeatInfo) || !seatsAreDistinct(p.seats)) return false
  if (p.kind === 'new') {
    return (
      Array.isArray(p.jobs) &&
      p.jobs.length === 3 &&
      p.jobs.every((j) => isId(j)) &&
      Array.isArray(p.traitIds) &&
      p.traitIds.every(isId) &&
      isInt(p.layoutKey, 0, 99)
    )
  }
  if (p.kind === 'restore') return p.snapshot !== undefined && p.snapshot !== null
  return false
}

export function isSyncPayload(v: unknown): v is SyncPayload {
  if (!v || typeof v !== 'object') return false
  const p = v as Record<string, unknown>
  return (
    p.v === 1 &&
    isInt(p.seq, 0, Number.MAX_SAFE_INTEGER) &&
    p.snapshot !== undefined &&
    p.snapshot !== null &&
    Array.isArray(p.seats) &&
    p.seats.length <= 3 &&
    p.seats.every(isSeatInfo) &&
    seatsAreDistinct(p.seats) &&
    isSeat(p.moveTokenSeat) &&
    isInt(p.layoutKey, 0, 99)
  )
}

export function isSyncRequest(v: unknown): v is SyncRequest {
  if (!v || typeof v !== 'object') return false
  const r = v as Record<string, unknown>
  return r.v === 1 && typeof r.userId === 'string' && isInt(r.haveSeq, -1, Number.MAX_SAFE_INTEGER)
}

export function isChecksum(v: unknown): v is ChecksumPayload {
  if (!v || typeof v !== 'object') return false
  const c = v as Record<string, unknown>
  return c.v === 1 && isInt(c.seq, 0, Number.MAX_SAFE_INTEGER) && isInt(c.hash, 0, 0xffffffff)
}

/** 초대 코드 — 헷갈리는 글자(0/O, 1/I/L)를 뺀 31자, 8자리(약 39.6비트) */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * 나머지 연산만 쓰면 256이 31로 나누어떨어지지 않아 앞 여덟 글자가 12.5% 더 자주
 * 나온다. 남는 구간(248 이상)의 바이트는 버리고 다시 뽑는다 — 코드의 엔트로피를
 * 광고한 만큼 실제로 갖게 하는 값싼 방법이다.
 */
export function makePartyCode(randomValues: (len: number) => Uint8Array): string {
  const n = CODE_ALPHABET.length
  const limit = 256 - (256 % n)
  let code = ''
  while (code.length < 8) {
    for (const b of randomValues(8)) {
      if (b >= limit) continue
      code += CODE_ALPHABET[b % n]
      if (code.length === 8) break
    }
  }
  return code
}

export function isPartyCode(v: string): boolean {
  return v.length === 8 && [...v].every((ch) => CODE_ALPHABET.includes(ch))
}
