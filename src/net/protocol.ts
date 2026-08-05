import type { Dir, EquipSlot, PlayerAction, SaveSnapshot, UpgradeStat } from '../core/types'

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
  | { kind: 'setTrait'; traitId: string } // 방장 전용 (특성은 0번 자리의 것)
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

/** 합류·재접속·어긋남 복구 — 순간의 세계 전체 */
export interface SyncPayload {
  v: 1
  seq: number
  snapshot: SaveSnapshot
  seats: { seat: Seat; userId: string; nickname: string; controller: 'human' | 'npc' }[]
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
    cmd.kind === 'setTrait' ||
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

/** 초대 코드 — 헷갈리는 글자(0/O, 1/I/L)를 뺀 32자, 8자리(40비트) */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export function makePartyCode(randomValues: (len: number) => Uint8Array): string {
  const bytes = randomValues(8)
  let code = ''
  for (let i = 0; i < 8; i++) code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return code
}

export function isPartyCode(v: string): boolean {
  return v.length === 8 && [...v].every((ch) => CODE_ALPHABET.includes(ch))
}
