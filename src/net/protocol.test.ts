import { describe, expect, it } from 'vitest'
import { NetScheduler } from './netScheduler'
import {
  hostOnly,
  isEnvelope,
  isNetCommand,
  isPartyCode,
  isProposal,
  makePartyCode,
  type Envelope,
  type NetCommand,
  type Seat,
} from './protocol'
import { Sequencer } from './sequencer'

/** 인메모리 채널 — 두세 개의 시퀀서를 전선 없이 잇는다 */
function makeParty(guestCount = 2) {
  const applied: Envelope[][] = [] // 화면별 적용 기록
  const sequencers: Sequencer[] = []
  const gaps: number[] = []
  let clock = 0
  const now = () => clock
  const advance = (ms: number) => (clock += ms)

  // 전송: propose는 호스트에게만, apply는 호스트를 제외한 전원에게
  const send = (from: number) => (event: 'propose' | 'apply', payload: unknown) => {
    if (event === 'propose') {
      sequencers[0].onPropose(payload, from as Seat)
    } else {
      sequencers.forEach((s, i) => {
        if (i !== 0) s.onApply(payload)
      })
    }
  }

  for (let seat = 0; seat <= guestCount; seat++) {
    applied.push([])
    sequencers.push(
      new Sequencer({
        isHost: () => seat === 0,
        mySeat: () => seat as Seat,
        apply: (env) => applied[seat].push(env),
        send: send(seat),
        onGap: () => gaps.push(seat),
        now,
      }),
    )
  }
  return { sequencers, applied, gaps, advance, now }
}

const MOVE: NetCommand = { kind: 'move', dir: 'east' }
const DEFEND: NetCommand = { kind: 'playerAction', action: { kind: 'defend' } }

describe('시퀀서 — 모두가 같은 순서를 걷는다', () => {
  it('호스트와 게스트의 명령이 전원에게 같은 순서로 적용된다', () => {
    const { sequencers, applied } = makeParty()
    sequencers[0].propose(MOVE) // 호스트
    sequencers[1].propose(DEFEND) // 게스트 → 제안 → 호스트가 확정
    sequencers[2].propose(MOVE)
    const orders = applied.map((list) => list.map((e) => `${e.seq}:${e.seat}:${e.cmd.kind}`))
    expect(orders[0]).toEqual(['1:0:move', '2:1:playerAction', '3:2:move'])
    expect(orders[1]).toEqual(orders[0])
    expect(orders[2]).toEqual(orders[0])
  })

  it('역순 도착은 버퍼에 쥐었다가 구멍이 메워지면 이어서 적용한다', () => {
    const { applied } = makeParty(0)
    const late: Envelope = { v: 1, seq: 1, seat: 0, cmd: MOVE }
    const early: Envelope = { v: 1, seq: 2, seat: 0, cmd: DEFEND }
    const guest = new Sequencer({
      isHost: () => false,
      mySeat: () => 1,
      apply: (env) => applied[0].push(env),
      send: () => {},
    })
    guest.onApply(early) // 2번이 먼저 왔다
    expect(applied[0]).toHaveLength(0)
    expect(guest.hasGap).toBe(true)
    guest.onApply(late) // 1번이 오면 1→2 순서로
    expect(applied[0].map((e) => e.seq)).toEqual([1, 2])
    expect(guest.hasGap).toBe(false)
  })

  it('이미 지난 번호는 다시 적용하지 않는다', () => {
    const { sequencers, applied } = makeParty(1)
    sequencers[0].propose(MOVE)
    const replay: Envelope = { v: 1, seq: 1, seat: 0, cmd: MOVE }
    sequencers[1].onApply(replay)
    sequencers[1].onApply(replay)
    expect(applied[1]).toHaveLength(1)
  })

  it('같은 nonce의 제안 재전송은 한 번만 확정된다', () => {
    const { sequencers, applied } = makeParty()
    const proposal = { v: 1, seat: 1, nonce: 'abc', cmd: MOVE }
    sequencers[0].onPropose(proposal, 1)
    sequencers[0].onPropose(proposal, 1)
    expect(applied[0]).toHaveLength(1)
  })

  it('구멍이 생기면 onGap이 불린다', () => {
    const { gaps } = makeParty(0)
    const guest = new Sequencer({
      isHost: () => false,
      mySeat: () => 1,
      apply: () => {},
      send: () => {},
      onGap: () => gaps.push(1),
    })
    guest.onApply({ v: 1, seq: 5, seat: 0, cmd: MOVE })
    expect(gaps).toEqual([1])
  })

  it('재동기화 후 reset하면 그 번호부터 다시 잇는다', () => {
    const applied: number[] = []
    const guest = new Sequencer({
      isHost: () => false,
      mySeat: () => 1,
      apply: (env) => applied.push(env.seq),
      send: () => {},
    })
    guest.onApply({ v: 1, seq: 9, seat: 0, cmd: MOVE }) // 구멍 — 버퍼
    guest.reset(8) // 호스트 스냅샷이 seq 8 시점
    guest.onApply({ v: 1, seq: 9, seat: 0, cmd: MOVE })
    expect(applied).toEqual([9])
  })
})

describe('시퀀서 — 부정한 것은 조용히 버린다', () => {
  it('좌석이 확인되지 않은 발신자의 제안은 버린다', () => {
    const { sequencers, applied } = makeParty()
    sequencers[0].onPropose({ v: 1, seat: 1, nonce: 'x', cmd: MOVE }, null)
    expect(applied[0]).toHaveLength(0)
  })

  it('남의 좌석 번호를 단 제안은 버린다', () => {
    const { sequencers, applied } = makeParty()
    // 2번 자리 사람이 1번 좌석을 사칭
    sequencers[0].onPropose({ v: 1, seat: 1, nonce: 'x', cmd: MOVE }, 2)
    expect(applied[0]).toHaveLength(0)
  })

  it('게스트의 방장 전용 명령은 버린다', () => {
    const { sequencers, applied } = makeParty()
    sequencers[0].onPropose({ v: 1, seat: 1, nonce: 'x', cmd: { kind: 'nextStage' } }, 1)
    sequencers[0].onPropose({ v: 1, seat: 1, nonce: 'y', cmd: { kind: 'tick' } }, 1)
    sequencers[0].onPropose(
      { v: 1, seat: 1, nonce: 'z', cmd: { kind: 'seatControl', seat: 0, controller: 'npc' } },
      1,
    )
    expect(applied[0]).toHaveLength(0)
  })

  it('모양이 어긋난 페이로드는 버린다', () => {
    const { sequencers, applied } = makeParty()
    const junk = [
      null,
      42,
      'hello',
      {},
      { v: 2, seat: 1, nonce: 'x', cmd: MOVE }, // 버전 불일치
      { v: 1, seat: 9, nonce: 'x', cmd: MOVE }, // 없는 좌석
      { v: 1, seat: 1, nonce: 'x', cmd: { kind: 'hack' } }, // 없는 명령
      { v: 1, seat: 1, nonce: 'x', cmd: { kind: 'move', dir: 'up' } }, // 없는 방향
      { v: 1, seat: 1, nonce: 'x'.repeat(99), cmd: MOVE }, // 과대 nonce
      { v: 1, seat: 1, nonce: 'x', cmd: { kind: 'buy', itemId: 'a'.repeat(99) } }, // 과대 id
    ]
    for (const p of junk) sequencers[0].onPropose(p, 1)
    for (const p of junk) sequencers[1].onApply(p)
    expect(applied.flat()).toHaveLength(0)
  })

  it('한 좌석의 폭주는 초당 상한에서 잘린다', () => {
    const { sequencers, applied, advance } = makeParty()
    for (let i = 0; i < 20; i++) {
      sequencers[0].onPropose({ v: 1, seat: 1, nonce: `n${i}`, cmd: MOVE }, 1)
    }
    expect(applied[0]).toHaveLength(5) // 기본 상한 5건
    advance(1100) // 1초가 지나면 다시 받는다
    sequencers[0].onPropose({ v: 1, seat: 1, nonce: 'later', cmd: MOVE }, 1)
    expect(applied[0]).toHaveLength(6)
  })
})

describe('네트워크 스케줄러 — 시계는 호스트 하나', () => {
  function makePair() {
    const timers = new Map<number, () => void>()
    let nextId = 1
    const ticks: string[] = []
    const host = new NetScheduler({
      isHost: () => true,
      realSchedule: (fn) => {
        const id = nextId++
        timers.set(id, fn)
        return id
      },
      realCancel: (h) => timers.delete(h as number),
      sendTick: () => ticks.push('tick'),
    })
    const guest = new NetScheduler({
      isHost: () => false,
      realSchedule: () => {
        throw new Error('게스트는 실제 타이머를 쓰지 않는다')
      },
      realCancel: () => {},
      sendTick: () => {
        throw new Error('게스트는 틱을 내지 않는다')
      },
    })
    const fireTimer = () => {
      for (const [id, fn] of [...timers]) {
        timers.delete(id)
        fn()
      }
    }
    return { host, guest, ticks, fireTimer }
  }

  it('호스트 타이머 만료는 직접 실행하지 않고 틱 명령이 된다', () => {
    const { host, ticks, fireTimer } = makePair()
    let ran = 0
    host.schedule(() => ran++, 900)
    fireTimer()
    expect(ran).toBe(0) // 아직 — 확정 순서를 기다린다
    expect(ticks).toEqual(['tick'])
    host.runTick() // tick 명령이 확정 순서로 돌아왔다
    expect(ran).toBe(1)
  })

  it('게스트는 보류했다가 틱 적용 때 실행한다', () => {
    const { guest } = makePair()
    let ran = 0
    guest.schedule(() => ran++, 900)
    expect(ran).toBe(0)
    guest.runTick()
    expect(ran).toBe(1)
  })

  it('취소된 예약의 틱은 조용히 지나간다', () => {
    const { host, guest, fireTimer, ticks } = makePair()
    let ran = 0
    const h = host.schedule(() => ran++, 900)
    host.cancel(h)
    fireTimer()
    expect(ticks).toHaveLength(0) // 실제 타이머도 지워졌다
    guest.schedule(() => ran++, 900)
    guest.cancel({})
    guest.runTick() // 늦게 도착한 틱
    expect(ran).toBe(0)
  })

  it('틱과 예약은 1:1 — 보류 없는 틱은 무시된다', () => {
    const { guest } = makePair()
    let ran = 0
    guest.runTick()
    guest.schedule(() => ran++, 900)
    guest.runTick()
    guest.runTick() // 두 번째 틱은 짝이 없다
    expect(ran).toBe(1)
  })
})

describe('프로토콜 — 언어의 울타리', () => {
  it('정상 명령은 전부 통과한다', () => {
    const good: NetCommand[] = [
      { kind: 'move', dir: 'north' },
      { kind: 'advanceDialogue' },
      { kind: 'playerAction', action: { kind: 'attack', targetId: 'slime-1' } },
      { kind: 'playerAction', action: { kind: 'skill', skillIndex: 0, targetId: 'w' } },
      { kind: 'playerAction', action: { kind: 'skill', skillIndex: 1 } },
      { kind: 'playerAction', action: { kind: 'item', itemId: 'potion', targetId: 'w' } },
      { kind: 'useItemInField', itemId: 'potion', targetId: 'warrior' },
      { kind: 'equip', memberId: 'warrior', itemId: 'wood_sword' },
      { kind: 'unequip', memberId: 'warrior', slot: 'weapon' },
      { kind: 'buy', itemId: 'potion' },
      { kind: 'sell', itemId: 'wood_sword' },
      { kind: 'dismantle', itemId: 'wood_sword' },
      { kind: 'upgrade', memberId: 'warrior', stat: 'hp' },
      { kind: 'setTrait', traitId: 'low-vision' },
      { kind: 'startStage', index: 0 },
      { kind: 'nextStage' },
      { kind: 'restartStage' },
      { kind: 'token', toSeat: 2 },
      { kind: 'seatControl', seat: 1, controller: 'npc' },
      { kind: 'tick' },
      { kind: 'endSession' },
    ]
    for (const cmd of good) expect(isNetCommand(cmd), cmd.kind).toBe(true)
  })

  it('방장 전용 판정이 명령 전체를 덮는다', () => {
    expect(hostOnly({ kind: 'nextStage' })).toBe(true)
    expect(hostOnly({ kind: 'tick' })).toBe(true)
    expect(hostOnly({ kind: 'move', dir: 'east' })).toBe(false)
    expect(hostOnly({ kind: 'token', toSeat: 1 })).toBe(false) // 토큰 규칙은 코어가 본다
  })

  it('봉투와 제안의 가드가 경계값을 지킨다', () => {
    expect(isEnvelope({ v: 1, seq: 0, seat: 0, cmd: MOVE })).toBe(true)
    expect(isEnvelope({ v: 1, seq: -1, seat: 0, cmd: MOVE })).toBe(false)
    expect(isEnvelope({ v: 1, seq: 1.5, seat: 0, cmd: MOVE })).toBe(false)
    expect(isProposal({ v: 1, seat: 2, nonce: '', cmd: MOVE })).toBe(true)
  })

  it('초대 코드는 8자리, 헷갈리는 글자가 없다', () => {
    const fake = (len: number) => new Uint8Array(len).map((_, i) => (i * 37 + 11) % 256)
    const code = makePartyCode(fake)
    expect(code).toHaveLength(8)
    expect(isPartyCode(code)).toBe(true)
    for (const bad of ['ABC', 'ABCDEFG0', 'ABCDEFGO', 'abcdefgh', 'ABCDEFG1']) {
      expect(isPartyCode(bad), bad).toBe(false)
    }
  })
})
